module.exports = {
    domain: "hdsky.me",
    regex_check_page: "https?://hdsky\\.me/details\\.php\\?id=(\\d+)",
    regex_check_page_freeleech_test: "<font\\s*.+?free.+?>\\s*免费\\s*</font>",
    regex_size_field: "大小\\s*：\\s*<\\s*/b\\s*>\\s*<\\s*/b\\s*>([\\d.]+\\s*[GMK]B)",
};