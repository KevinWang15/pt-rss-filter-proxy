import path from 'path';
import fs from 'fs';
import express from 'express';
import * as cheerio from 'cheerio';
import Queue from 'promise-queue';
import axios from 'axios';
import {HttpsProxyAgent} from "https-proxy-agent";
import winston from 'winston';

import config from './config.js';

// Configure Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({filename: 'error.log', level: 'error'}),
        new winston.transports.File({filename: 'combined.log'}),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

const app = express();

const maxConcurrentCheck = config.maxConcurrentCheck || 8;
const userAgent = config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.62 Safari/537.36";
const queue = new Queue(maxConcurrentCheck);

const proxyAgent = process.env['proxy'] ? new HttpsProxyAgent(process.env['proxy']) : undefined;

// Create axios instance
const axiosInstance = axios.create({
    headers: {
        'User-Agent': userAgent,
    },
    httpAgent: proxyAgent,
    httpsAgent: proxyAgent,
    maxRedirects: 5,
});

// Trackers & Config
// =======================================
const domainData = config.domainData || {};

const trackerData = {};

// Tracker Loader
const trackersPath = path.join(process.cwd(), "trackers");
fs.readdirSync(trackersPath).forEach(async (file) => {
    const tracker = await import(`./trackers/${file}`);
    trackerData[tracker.default.domain] = tracker.default;
    logger.info(`Loaded tracker: ${file} for domain: ${tracker.default.domain}`);
});

// HTTP Listener
// =======================================
app.get('/*', (req, res) => {
    const url = decodeURIComponent(req.url.substr(1));
    logger.info(`Received request for URL: ${url}`);
    const match = url.match(/https?:\/\/(.+)\//m);
    if (match !== null) {
        const domain = match[1];
        if (!domainData[domain]) {
            logger.warn(`No domain config found for: ${domain}`);
            res.end("No domain config found");
        } else {
            logger.info(`Processing request for domain: ${domain}`);
            FilterRss(domain, url).then(xml => res.end(xml));
        }
    } else {
        logger.warn(`Invalid URL received: ${url}`);
        res.end("Invalid URL");
    }
});

const port = config.port || 3355;
app.listen(port, function () {
    logger.info(`Server running at port ${port}`);
});

// Get and Filter RSS Feed
// =======================================
// used for caching results
const blackListedUrl = new Map();
const whiteListedUrl = [];

async function FilterRss(domain, url) {
    try {
        logger.info(`Fetching RSS feed from: ${url}`);
        const response = await axiosInstance.get(url);
        const body = response.data;

        // parse the original rss feed
        const $ = cheerio.load(body, {xmlMode: true});
        const channel = $('channel');

        // create the new filtered rss feed
        const filteredRss = cheerio.load('<rss version="2.0"></rss>', {xmlMode: true});
        const filteredChannel = filteredRss('rss').append('<channel></channel>').find('channel');

        // copy channel metadata
        channel.children().not('item').each((_, el) => {
            filteredChannel.append($(el).clone());
        });

        const progress = {total: 0, finished: 0};
        const checkingPromises = [];

        channel.find('item').each((_, item) => {
            const $item = $(item).clone();
            const enclosure = ($item?.find('enclosure') || [])[0];
            if (enclosure) {
                const dlUrl = enclosure?.attribs?.url;
                if (dlUrl && domainData[domain].dl_url_transformer) {
                    $(enclosure).attr('url', domainData[domain].dl_url_transformer(dlUrl));
                }
            }

            const itemXml = $.html($item);

            // find url for the detail page
            const checkUrlMatch = itemXml.match(new RegExp(trackerData[domain].regex_check_page));
            if (checkUrlMatch !== null) {
                let checkUrl;
                if (trackerData[domain].regex_check_page_transformer) {
                    checkUrl = trackerData[domain].regex_check_page_transformer(checkUrlMatch);
                    if (!checkUrl) return;
                } else {
                    checkUrl = checkUrlMatch[0];
                }
                // check for cached results
                if (blackListedUrl.has(checkUrl)) {
                    logger.debug(`Skipping blacklisted URL: ${checkUrl}`);
                    return;
                }
                if (whiteListedUrl.indexOf(checkUrl) >= 0) {
                    logger.debug(`Including whitelisted URL: ${checkUrl}`);
                    filteredChannel.append($item);
                    return;
                }
                // if not cached, fetch the page and see..
                progress.total++;
                checkingPromises.push(queue.add(async () => {
                    try {
                        logger.info(`Checking URL: ${checkUrl}`);
                        const response = await axiosInstance.get(checkUrl, {
                            headers: {
                                'Cookie': domainData[domain].cookie,
                            }
                        });
                        const body = response.data;
                        if (shouldKeep(domain, checkUrl, body)) {
                            logger.info(`Keeping URL: ${checkUrl}`);
                            filteredChannel.append($item);
                            whiteListedUrl.push(checkUrl);
                        } else {
                            logger.info(`Blacklisting URL: ${checkUrl}`);
                            blackListedUrl.set(checkUrl, Date.now());
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
                }));
            }
        });

        // when all checkings are finished
        await Promise.all(checkingPromises);
        // send the filtered rss
        return filteredRss.xml();
    } catch (error) {
        logger.error(`Error fetching ${url}: ${error.message}`);
        return "";
    }
}

function shouldKeep(domain, checkUrl, htmlBody) {
    if (domainData[domain].onlyWhenFreeLeech && trackerData[domain].regex_check_page_freeleech_test && !htmlBody.match(new RegExp(trackerData[domain].regex_check_page_freeleech_test))) {
        logger.debug(`Skipping: ${checkUrl} Not FreeLeech`);
        return false;
    }

    if (domainData[domain].onlyWhenNotHr && trackerData[domain].regex_check_page_hr_test && htmlBody.match(new RegExp(trackerData[domain].regex_check_page_hr_test))) {
        logger.debug(`Skipping: ${checkUrl} Is HR`);
        return false;
    }

    if (domainData[domain].onlyWhenFileSizeInMBLessThan) {
        const match = htmlBody.match(new RegExp(trackerData[domain].regex_size_field));
        if (match !== null) {
            const size = match[1];
            const parsedSize = parseSize(size);
            if (parsedSize > domainData[domain].onlyWhenFileSizeInMBLessThan) {
                logger.debug(`Skipping: ${checkUrl} Size ${parsedSize}MB exceeds limit ${domainData[domain].onlyWhenFileSizeInMBLessThan}MB`);
                return false;
            }
        } else {
            logger.debug(`Skipping: ${checkUrl} No size field found`);
            return false;
        }
    }

    return true;
}

function parseSize(text) {
    // strip irrelevant characters
    let strippedText = text.replace(/[,\s]/g, '').toLowerCase();
    // ensure ends with "b"
    if (strippedText.endsWith("ib")) {
        strippedText = strippedText.substring(0, strippedText.length - 2) + "b";
    }

    let sizeText = strippedText.substring(strippedText.length - 1) !== 'b' ? strippedText + 'b' : strippedText;
    const value = parseFloat(sizeText.substring(0, sizeText.length - 2));
    const unit = sizeText.substring(sizeText.length - 2);
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

export {app};
