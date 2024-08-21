# pt-rss-filter-proxy

A proxy to filter PT rss feeds according to file size / freeleech or not.

Meant to be used in conjunction with a seedbox to build up ratio.

PRs for more trackers are welcome.

## How to use

1. Copy `config-example.js` to `config.js`
2. Modify `config.js` file, fill in the necessary configuration for each tracker/domain.
3. Run:
   ```
   npm install
   npm start
   ```
4. In your seedbox, prepend all URLs with `http://IP_Address:3355/`. For example, `https://xxx.com/torrentrss.php?https=1&rows=50&linktype=dl&passkey=xxx` now becomes `http://IP_Address:3355/https://xxx.com/torrentrss.php?https=1&rows=50&linktype=dl&passkey=xxx`.

## Configuration

The `config.js` file should export an object with the following structure:

```javascript
export default {
    port: 3355,
    maxConcurrentCheck: 8,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.62 Safari/537.36",
    domainData: {
        "example.com": {
            cookie: "xxxx",

            // only show freeleech torrents
            onlyWhenFreeLeech: true,

            // in MB, only show torrents with size less than 5000MB (0 for unlimited)
            onlyWhenFileSizeInMBLessThan: 0,
        },
        // Add more domains as needed
    }
};
```

Adjust the `domainData` object to include configurations for all the trackers you want to use.

## Requirements

ES6-compatible Node.js

## Supported Trackers

* HDSky
* CHDBits
* M-Team
* empornium
- totheglory
- HDChina
- Ourbits

All Trackers using NexusPHP can be adapted very easily.

More coming soon. PRs welcome.

## Adding New Trackers

To add support for a new tracker:

1. Add a new entry to the `domainData` object in `config.js`
2. Configure the necessary regex patterns and options for the new tracker
3. Test the configuration to ensure it works correctly

Feel free to submit a pull request with new tracker configurations!
