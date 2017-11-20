let express = require('express');
let config = require('./config');
let request = require('request').defaults({ 'proxy': config.proxy || null });
let fs = require('fs');
let et = require('elementtree');
let ElementTree = et.ElementTree;
let element = et.Element;
let subElement = et.SubElement;
let app = express();

let Queue = require('promise-queue');
let maxConcurrentCheck = config.maxConcurrentCheck || 8;
let queue = new Queue(maxConcurrentCheck);

// Trackers & Config Loader
// =======================================
let domainData = {};
let mapFileNameToDomain = {};

// Tracker Loader
let normalizedPath = require("path").join(__dirname, "trackers");
fs.readdirSync(normalizedPath).forEach(function (file) {
    let tracker = require("./trackers/" + file);
    domainData[tracker['domain']] = tracker;
    mapFileNameToDomain[file] = tracker['domain'];
});

// Config Loader
normalizedPath = require("path").join(__dirname, "config");
fs.readdirSync(normalizedPath).forEach(function (file) {
    let config = require("./config/" + file);
    let domain = mapFileNameToDomain[file];
    Object.assign(domainData[domain], config);
});

// HTTP Listener
// =======================================
app.get('/*', function (req, res) {
    // Find domain data associated with URL
    let url = decodeURIComponent(req.url.substr(1));
    let match = url.match(/https?:\/\/(.+)\//m);
    if (match !== null) {
        let domain = match[1];
        if (!domainData[domain]) {
            res.end("No domain config found");
        } else {
            FilterRss(url, domainData[domain]).then(xml => res.end(xml));
        }
    } else {
        res.end("Invalid URL");
    }
});
app.listen(config.port || 3355);

// Get and Filter RSS Feed
// =======================================
// used for caching results
let blackListedUrl = [];
let whiteListedUrl = [];

function FilterRss(url, domainData) {
    return new Promise((res) => {
        request(url, function (error, response, body) {
            if (error) {
                console.warn("Fetching " + url + " has failed, " + JSON.stringify(error));
                res("");
                return;
            }

            // the following commented line is for testing
            // let body = fs.readFileSync("test.xml", { encoding: "UTF8" });

            // parse the original rss feed
            let old = et.parse(body);
            let oldRoot = old.find('.');
            // create the new filtered rss feed
            let root = element(oldRoot.tag, oldRoot.attrib);
            let oldChannel = old.find('./channel');
            // copy root to new rss feed
            let channel = subElement(root, oldChannel.tag, oldChannel.attrib);

            let checkingPromises = [];
            (oldChannel.findall("./*")).forEach(child => {
                if (child.tag !== "item") {
                    // Copy all children except <item> to new the XML.
                    channel.append(child);
                } else {
                    // For <item>s, request detail page and check whether it's freeleech
                    let stringified = (new ElementTree(child).write());

                    // find url for the detail page
                    let checkUrlMatch = stringified.match(new RegExp(domainData.regex_check_page));
                    if (checkUrlMatch !== null) {
                        let checkUrl;
                        if (domainData.regex_check_page_transformer) {
                            checkUrl = domainData.regex_check_page_transformer(checkUrlMatch);
                            if (!checkUrl) return;
                        } else {
                            checkUrl = checkUrlMatch[0];
                        }
                        // check for cached results
                        if (blackListedUrl.indexOf(checkUrl) >= 0) return;
                        if (whiteListedUrl.indexOf(checkUrl) >= 0) {
                            channel.append(child);
                            return;
                        }
                        // if not cached, fetch the page and see..
                        checkingPromises.push(new Promise((check_res) => {
                            // using a promise queue so that only [maxConcurrentCheck] (=8) fetches are being made at the same time
                            queue.add(() => {
                                return new Promise((queue_res) => {
                                    // console.log("Requesting", checkUrl, "with", domainData.cookie);
                                    request({
                                        url: checkUrl,
                                        headers: {
                                            'Cookie': domainData.cookie,
                                            'Upgrade-Insecure-Requests': 1,
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
                                        },
                                    }, function (error, response, body) {
                                        if (!error) {
                                            // Got response body now, check if it should be kept
                                            if (shouldKeep(body, domainData)) {
                                                // should be kept! append <item> to filtered rss
                                                channel.append(child);
                                                whiteListedUrl.push(checkUrl);
                                            } else {
                                                // blacklist the url
                                                blackListedUrl.push(checkUrl);
                                            }
                                        } else {
                                            console.warn("Fetching " + checkUrl + " has failed, " + JSON.stringify(error));
                                        }
                                        // notify the queue to move on
                                        queue_res();
                                        // mark this checking as finished
                                        check_res();
                                    });
                                });
                            });
                        }));
                    }
                }
            });
            // when all checkings are finished
            Promise.all(checkingPromises).then(() => {
                // send the filtered rss
                res(new ElementTree(root).write());
            })
        });
    });
}

function shouldKeep(htmlBody, domainData) {
    if (domainData.onlyWhenFreeLeech && !htmlBody.match(new RegExp(domainData.regex_check_page_freeleech_test)))
        return false;

    if (domainData.onlyWhenFileSizeInMBLessThan) {
        let match = htmlBody.match(new RegExp(domainData.regex_size_field));
        if (match !== null) {
            let size = match[1];
            if (parseSize(size) > domainData.onlyWhenFileSizeInMBLessThan)
                return false;
        } else {
            // No size field found
            return false;
        }
    }

    return true;
}

function parseSize(text) {
    // strip irrelevant characters
    let strippedText = text.replace(/[,\s]/g, '').toLowerCase();
    // ensure ends with "b"
    if (strippedText.substring(strippedText.length - 1) !== 'b')
        strippedText += 'b';

    let value = strippedText.substring(0, strippedText.length - 2);
    let unit = strippedText.substring(strippedText.length - 2);
    switch (unit) {
        case 'kb':
            return value / 1024;
        case 'mb':
            return value;
        case 'gb':
            return value * 1024;
    }
}