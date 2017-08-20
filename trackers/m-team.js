module.exports = {
    domain: "tp.m-team.cc",
    regex_check_page: "https?://tp\\.m-team\\.cc/details\\.php\\?id=(\\d+)",
    regex_check_page_freeleech_test: "<font\\s*class=.free.\\s*>\\s*免費\\s*</font>",
    regex_size_field: "大小\\s*：\\s*<\\s*/b\\s*>\\s*<\\s*/b\\s*>([\\d.]+\\s*[GMK]B)",
};