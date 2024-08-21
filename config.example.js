export default {
    // which port to listen on
    port: 3355,

    // how many concurrent http requests at most
    maxConcurrentCheck: 8,

    // user agent for tracker server requests
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.62 Safari/537.36",

    domainData: {
        "chdbits.co": {
            cookie: "xxxx",

            // only show freeleech torrents
            onlyWhenFreeLeech: true,

            // in MB, only show torrents with size less than 5000MB (0 for unlimited)
            onlyWhenFileSizeInMBLessThan: 0,
        },
    }
};
