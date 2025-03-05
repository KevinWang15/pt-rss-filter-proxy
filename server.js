import path from 'path';
import fs from 'fs';
import express from 'express';
import * as cheerio from 'cheerio';
import Queue from 'promise-queue';
import axios from 'axios';
import {HttpsProxyAgent} from 'https-proxy-agent';
import winston from 'winston';
import NodeCache from 'node-cache'; // <-- new
import config from './config.js';

// Configure Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

const app = express();

// Options
const maxConcurrentCheck = config.maxConcurrentCheck || 8;
const userAgent = config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...';
const proxyAgent = process.env.proxy ? new HttpsProxyAgent(process.env.proxy) : undefined;
const queue = new Queue(maxConcurrentCheck);

// Create axios instance
const axiosInstance = axios.create({
    headers: { 'User-Agent': userAgent },
    httpAgent: proxyAgent,
    httpsAgent: proxyAgent,
    maxRedirects: 5,
});

// =======================================================
// 1) Use node-cache to store legit torrent URLs
// =======================================================

/**
 * NodeCache constructor options:
 * - stdTTL: default time-to-live (in seconds). Here, 86400 = 24h
 * - checkperiod: how often NodeCache checks & removes expired keys
 */
const torrentCache = new NodeCache({
    stdTTL: 86400,     // 24 hours in seconds
    checkperiod: 120,  // how often to check for expired items (in seconds)
});

/**
 * Add a torrent URL to the cache. It will expire automatically after stdTTL.
 */
function addTorrentToCache(torrentUrl) {
    torrentCache.set(torrentUrl, true); // the value we store is arbitrary (just "true")
}

/**
 * Check if a torrent URL is in the cache (and not expired).
 */
function isTorrentInCache(torrentUrl) {
    return torrentCache.has(torrentUrl);
}

// Domain data, trackers, etc.
const domainData = config.domainData || {};
const trackerData = {};

// Load trackers
const trackersPath = path.join(process.cwd(), 'trackers');
fs.readdirSync(trackersPath).forEach(async (file) => {
    const tracker = await import(`./trackers/${file}`);
    trackerData[tracker.default.domain] = tracker.default;
    logger.info(`Loaded tracker: ${file} for domain: ${tracker.default.domain}`);
});

// =======================================
// Black/white-lists for detail pages
// (unchanged logic)
// =======================================
const blackListedUrl = new Map();
const whiteListedUrl = [];

// =======================================
// 2) New /proxy endpoint
// =======================================
app.get('/proxy', async (req, res) => {
    try {
        const torrentUrl = req.query.url;
        if (!torrentUrl) {
            return res.status(400).send('Missing "url" parameter.');
        }

        // Validate from the cache
        if (!isTorrentInCache(torrentUrl)) {
            logger.warn(`Attempt to proxy an unrecognized or expired torrent URL: ${torrentUrl}`);
            return res.status(403).send('Torrent URL is not in cache or has expired.');
        }

        logger.info(`Proxying torrent download for: ${torrentUrl}`);

        // Fetch the .torrent via your existing axios setup
        const response = await axiosInstance.get(torrentUrl, { responseType: 'arraybuffer' });

        // Pipe .torrent file to the user
        res.setHeader('Content-Disposition', 'attachment; filename="download.torrent"');
        res.setHeader('Content-Type', 'application/x-bittorrent');
        return res.send(response.data);

    } catch (err) {
        logger.error(`Error proxying torrent: ${err.message}`);
        return res.status(500).send('Error retrieving torrent.');
    }
});

// =======================================
// Main route: /<encoded-url>
// =======================================
app.get('/*', (req, res) => {
    const url = decodeURIComponent(req.url.substr(1));
    logger.info(`Received request for URL: ${url}`);

    const match = url.match(/https?:\/\/(.+)\//m);
    if (match !== null) {
        const domain = match[1];
        if (!domainData[domain]) {
            logger.warn(`No domain config found for: ${domain}`);
            return res.end('No domain config found');
        } else {
            logger.info(`Processing request for domain: ${domain}`);
            FilterRss(domain, url)
                .then((xml) => res.end(xml))
                .catch((err) => {
                    logger.error(`FilterRss error: ${err.message}`);
                    res.end('');
                });
        }
    } else {
        logger.warn(`Invalid URL received: ${url}`);
        res.end('Invalid URL');
    }
});

const port = config.port || 3355;
app.listen(port, function () {
    logger.info(`Server running at port ${port}`);
});

// =======================================
// FilterRss function
// =======================================
async function FilterRss(domain, url) {
    try {
        logger.info(`Fetching RSS feed from: ${url}`);
        const response = await axiosInstance.get(url);
        const body = response.data;

        // parse the original rss feed
        const $ = cheerio.load(body, { xmlMode: true });
        const channel = $('channel');

        // create a new filtered rss feed
        const filteredRss = cheerio.load('<rss version="2.0"></rss>', { xmlMode: true });
        const filteredChannel = filteredRss('rss').append('<channel></channel>').find('channel');

        // copy channel-level metadata (title, link, description, etc.)
        channel.children().not('item').each((_, el) => {
            filteredChannel.append($(el).clone());
        });

        const progress = { total: 0, finished: 0 };
        const checkingPromises = [];

        // traverse <item> in the original feed
        channel.find('item').each((_, item) => {
            const $item = $(item).clone();

            // remove namespaced sub-elements (prevent parser issues)
            $item.find('*').each((_, el) => {
                if (el.tagName.includes(':')) {
                    $(el).remove();
                }
            });

            // Grab enclosure data
            let finalDownloadUrl = null;
            const enclosure = $item.find('enclosure')[0];
            if (enclosure) {
                const dlUrl = enclosure?.attribs?.url;
                if (dlUrl) {
                    // If there's a domain-level transformer, apply it
                    finalDownloadUrl = domainData[domain].dl_url_transformer
                        ? domainData[domain].dl_url_transformer(dlUrl)
                        : dlUrl;
                }
            }

            // Next: find detail page URL for advanced checks
            const itemXml = $.html($item);
            const checkUrlMatch = itemXml.match(new RegExp(trackerData[domain].regex_check_page));
            if (checkUrlMatch) {
                let checkUrl;
                if (trackerData[domain].regex_check_page_transformer) {
                    checkUrl = trackerData[domain].regex_check_page_transformer(checkUrlMatch);
                    if (!checkUrl) return;
                } else {
                    checkUrl = checkUrlMatch[0];
                }

                // blackList / whiteList checks
                if (blackListedUrl.has(checkUrl)) {
                    logger.debug(`Skipping blacklisted URL: ${checkUrl}`);
                    return;
                }
                if (whiteListedUrl.includes(checkUrl)) {
                    logger.debug(`Including whitelisted URL: ${checkUrl}`);
                    // For whitelisted items, also apply the proxy enclosure if applicable
                    if (finalDownloadUrl) {
                        addTorrentToCache(finalDownloadUrl);

                        if (!!config.alwaysUseProxyForEnclosure) {
                            $(enclosure).attr('url', `${config.publicUrl}/proxy?url=${encodeURIComponent(finalDownloadUrl)}`);
                        }
                    }
                    filteredChannel.append($item);
                    return;
                }

                // Not blacklisted or whitelisted, do the real check
                progress.total++;
                checkingPromises.push(
                    queue.add(async () => {
                        try {
                            logger.info(`Checking URL: ${checkUrl}`);
                            const resp = await axiosInstance.get(checkUrl, {
                                headers: { 'Cookie': domainData[domain].cookie },
                            });
                            const detailHtml = resp.data;

                            if (shouldKeep(domain, checkUrl, detailHtml)) {
                                logger.info(`Keeping URL: ${checkUrl}`);
                                // transform enclosure & store in cache
                                if (finalDownloadUrl) {
                                    addTorrentToCache(finalDownloadUrl);
                                    if (!!config.alwaysUseProxyForEnclosure) {
                                        $(enclosure).attr('url', `${config.publicUrl}/proxy?url=${encodeURIComponent(finalDownloadUrl)}`);
                                    }
                                }
                                filteredChannel.append($item);
                                whiteListedUrl.push(checkUrl);
                            } else {
                                logger.info(`Blacklisting URL: ${checkUrl}`);
                                blackListedUrl.set(checkUrl, Date.now());
                                // remove from blacklist after random 10-30 min
                                setTimeout(() => {
                                    blackListedUrl.delete(checkUrl);
                                    logger.info(`Removed ${checkUrl} from blacklist for retry`);
                                }, Math.floor(Math.random() * (30 - 10 + 1) + 10) * 60 * 1000);
                            }
                        } catch (error) {
                            logger.error(`Error fetching ${checkUrl}: ${error.message}`);
                        }
                        progress.finished++;
                        logger.info(`Progress: ${progress.finished}/${progress.total}`);
                    })
                );
            } else {
                // If there's no detail page to check, you can either skip or directly keep it
                // If you want to keep *all* items that have no check page, optionally do:
                //   filteredChannel.append($item);
                //   ...
            }
        });

        await Promise.all(checkingPromises);

        // Return your new feed as XML
        return filteredRss.xml();
    } catch (error) {
        logger.error(`Error fetching ${url}: ${error.message}`);
        return '';
    }
}

/**
 * decide if we keep or skip an item based on freeleech, size, HR, etc.
 */
function shouldKeep(domain, checkUrl, htmlBody) {
    // domainData & trackerData checks here:
    if (
        domainData[domain].onlyWhenFreeLeech &&
        trackerData[domain].regex_check_page_freeleech_test &&
        !htmlBody.match(new RegExp(trackerData[domain].regex_check_page_freeleech_test))
    ) {
        logger.debug(`Skipping: ${checkUrl} Not FreeLeech`);
        return false;
    }

    if (
        domainData[domain].onlyWhenNotHr &&
        trackerData[domain].regex_check_page_hr_test &&
        htmlBody.match(new RegExp(trackerData[domain].regex_check_page_hr_test))
    ) {
        logger.debug(`Skipping: ${checkUrl} Is HR`);
        return false;
    }

    if (domainData[domain].onlyWhenFileSizeInMBLessThan) {
        const match = htmlBody.match(new RegExp(trackerData[domain].regex_size_field));
        if (match) {
            const sizeText = match[1];
            const parsedSize = parseSize(sizeText); // see parseSize function below
            if (parsedSize > domainData[domain].onlyWhenFileSizeInMBLessThan) {
                logger.debug(
                    `Skipping: ${checkUrl} Size ${parsedSize}MB exceeds limit ${domainData[domain].onlyWhenFileSizeInMBLessThan}MB`
                );
                return false;
            }
        } else {
            logger.debug(`Skipping: ${checkUrl} No size field found`);
            return false;
        }
    }

    return true;
}

/**
 * parse something like "1.2 GB", "700MB", "523 KB" into MB
 */
function parseSize(text) {
    let strippedText = text.replace(/[,\s]/g, '').toLowerCase();
    if (strippedText.endsWith('ib')) {
        strippedText = strippedText.substring(0, strippedText.length - 2) + 'b';
    }
    if (!strippedText.endsWith('b')) {
        strippedText += 'b';
    }

    const value = parseFloat(strippedText.substring(0, strippedText.length - 2));
    const unit = strippedText.substring(strippedText.length - 2);

    switch (unit) {
        case 'kb':
            return value / 1024;
        case 'mb':
            return value;
        case 'gb':
            return value * 1024;
        default:
            return 0;
    }
}

process.on('unhandledRejection', (reason, p) => {
    logger.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

export { app };
