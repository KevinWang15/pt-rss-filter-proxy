# pt-rss-filter-proxy

A proxy to filter PT rss feeds according to file size / freeleech or not.

Meant to be used in conjunction with a seedbox to build up ratio.

PRs for more trackers are welcome.

# How to use
1. Copy ```config-example``` to ```config```
2. Modify config file, fill in the blanks.
3. Run:
```
npm install
npm start
```
4. In your seedbox, prepend all URLs with ```http://IP_Address:3355/```. e.g ```https://xxx.com/torrentrss.php?https=1&rows=50&linktype=dl&passkey=xxx``` now becomes ```http://IP_Address:3355/https://xxx.com/torrentrss.php?https=1&rows=50&linktype=dl&passkey=xxx```.

# Requirement
ES6-compatible Node.js

# Supported Trackers
* HDSky
* CHDBits
* M-Team

All Trackers using NexusPHP can be adapted very easily.

More coming soon. PRs welcome.