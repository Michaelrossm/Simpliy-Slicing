use super::*;
#[test] fn validates_web_urls() {
    assert_eq!(printer_url("192.168.1.20").unwrap().as_str(), "http://192.168.1.20/");
    assert!(printer_url("https://printer.local:443/").is_ok());
    assert!(printer_url("file:///secret").is_err());
    assert!(printer_url("http://user:password@example.com").is_err());
    assert!(printer_url("").is_err());
}
