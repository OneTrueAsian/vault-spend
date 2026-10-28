//! Loopback-only HTTP fixture for the real provider request/response adapters.
//! It is compiled only by cargo test, and never changes a production endpoint.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub struct QuoteServer {
    pub url: String,
    worker: Option<JoinHandle<String>>,
}

impl QuoteServer {
    pub fn new(status: u16, body: &str) -> Self {
        Self::response(status, body, body.len())
    }

    pub fn truncated(status: u16, body: &str) -> Self {
        Self::response(status, body, body.len() + 16)
    }

    fn response(status: u16, body: &str, advertised_length: usize) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/quote", listener.local_addr().unwrap());
        let body = body.to_owned();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(3);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "provider never requested its fixture");
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("fixture accept failed: {error}"),
                }
            };
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 1024];
            while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buf).unwrap();
                assert!(read > 0 && bytes.len() < 16_384, "incomplete fixture request");
                bytes.extend_from_slice(&buf[..read]);
            }
            let request = String::from_utf8(bytes).unwrap();
            let response = format!(
                "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                advertised_length
            );
            stream.write_all(response.as_bytes()).unwrap();
            request.lines().next().unwrap().to_owned()
        });
        Self { url, worker: Some(worker) }
    }

    pub fn finish(mut self, expected: &[(&str, &str)]) {
        let request = self.worker.take().unwrap().join().unwrap();
        let parts: Vec<_> = request.split_whitespace().collect();
        assert_eq!(parts[0], "GET");
        let url = reqwest::Url::parse(&format!("http://localhost{}", parts[1])).unwrap();
        assert_eq!(url.path(), "/quote");
        let actual: std::collections::BTreeMap<_, _> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        let expected: std::collections::BTreeMap<_, _> = expected.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        assert_eq!(actual, expected, "provider must preserve its exact query contract");
    }
}

impl Drop for QuoteServer {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().unwrap()
}
