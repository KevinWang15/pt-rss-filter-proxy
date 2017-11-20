module.exports = {
    domain: "totheglory.im",
    regex_check_page: "rssdd\\.php\\?par=([a-zA-Z0-9+/=]+)",
    regex_check_page_transformer: function (match) {
        let myregexp = /^vvv(\d+)/im;
        let match2 = myregexp.exec(new Buffer(match[1], 'base64').toString('ascii'));
        if (match2 !== null) {
            let id = match2[1];
            console.log("URL:", "https://totheglory.im/details.php?id=" + id);
            return "https://totheglory.im/details.php?id=" + id;
        } else {
            return null;
        }
    },
    regex_check_page_freeleech_test: "/pic/ico_free\\.gif",
    regex_check_page_hr_test: "/pic/hit_run\\.gif",
    regex_size_field: "尺寸.+?>([\\d.]+\\s*[GMK]B)",
};