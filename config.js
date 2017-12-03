module.exports = {
    // which port to listen on
    port: 3355,

    // use a http proxy? can be set to false or "http://127.0.0.1:1080"
    proxy: false,

    // how many concurrent http requests at most
    maxConcurrentCheck: 8,

    // user agent for tracker server requests
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.62 Safari/537.36"
};