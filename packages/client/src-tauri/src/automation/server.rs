use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
#[cfg(test)]
use std::net::Shutdown;
use std::sync::{mpsc, Arc, RwLock};
use std::thread;
use std::time::Duration;

#[path = "actions.rs"]
mod actions;

const REQUEST_HEAD_MAX_BYTES: usize = 8 * 1024;
const REQUEST_BODY_MAX_BYTES: usize = 64 * 1024;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub platform: String,
    pub app_ready: bool,
    pub webview_ready: bool,
    pub sidecar_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct StateResponse {
    pub window: Value,
    pub webview: Value,
    pub sidecar: Value,
}

#[derive(Debug, Clone)]
pub struct RouteState {
    pub platform: String,
    pub app_ready: bool,
    pub webview_ready: bool,
    pub sidecar_ready: bool,
    pub window: Value,
    pub webview: Value,
    pub sidecar: Value,
}

#[derive(Debug, Clone)]
struct HttpResponse {
    status: u16,
    body: Value,
}

pub struct AutomationServer {
    addr: SocketAddr,
    stop_tx: mpsc::Sender<()>,
    join_handle: Option<thread::JoinHandle<()>>,
}

impl AutomationServer {
    pub fn local_addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn shutdown(mut self) -> std::io::Result<()> {
        let _ = self.stop_tx.send(());
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
        Ok(())
    }
}

impl Drop for AutomationServer {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

pub fn start_loopback_server(
    port: u16,
    token: String,
    state: Arc<RwLock<RouteState>>,
    eval_backend: Arc<dyn actions::WebviewEvalBackend>,
) -> std::io::Result<AutomationServer> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    listener.set_nonblocking(true)?;
    let addr = listener.local_addr()?;
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let join_handle = thread::spawn(move || loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Err(error) = handle_connection(&mut stream, &token, &state, &eval_backend) {
                    let _ = write_simple_error(&mut stream, 500, &error.to_string());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break,
        }
    });

    Ok(AutomationServer {
        addr,
        stop_tx,
        join_handle: Some(join_handle),
    })
}

fn route_request(
    method: &str,
    path: &str,
    authorization: Option<&str>,
    body: &[u8],
    token: &str,
    state: &RouteState,
    eval_backend: &dyn actions::WebviewEvalBackend,
) -> HttpResponse {
    let expected = format!("Bearer {token}");
    if authorization != Some(expected.as_str()) {
        return HttpResponse {
            status: 401,
            body: json!({"error": "unauthorized"}),
        };
    }

    match (method, path) {
        ("GET", "/health") => HttpResponse {
            status: 200,
            body: json!(HealthResponse {
                ok: true,
                platform: state.platform.clone(),
                app_ready: state.app_ready,
                webview_ready: state.webview_ready,
                sidecar_ready: state.sidecar_ready,
            }),
        },
        ("GET", "/state") => HttpResponse {
            status: 200,
            body: json!(StateResponse {
                window: state.window.clone(),
                webview: state.webview.clone(),
                sidecar: state.sidecar.clone(),
            }),
        },
        ("POST", "/webview/eval") => {
            let request = match actions::parse_webview_eval_request(body) {
                Ok(request) => request,
                Err(error) => {
                    return HttpResponse {
                        status: 400,
                        body: json!({ "error": error }),
                    }
                }
            };
            HttpResponse {
                status: 200,
                body: json!(actions::evaluate_webview_script(
                    eval_backend,
                    &request.script
                )),
            }
        }
        _ => HttpResponse {
            status: 404,
            body: json!({"error": "not_found"}),
        },
    }
}

fn handle_connection(
    stream: &mut TcpStream,
    token: &str,
    state: &Arc<RwLock<RouteState>>,
    eval_backend: &Arc<dyn actions::WebviewEvalBackend>,
) -> std::io::Result<()> {
    let request = match parse_http_request(stream) {
        Ok(request) => request,
        Err(RequestParseError::Timeout) => {
            return write_simple_error(stream, 408, "request_timeout")
        }
        Err(RequestParseError::Malformed(message)) => {
            return write_simple_error(stream, 400, message)
        }
        Err(RequestParseError::Io(error)) => return Err(error),
    };
    let response = {
        let state_guard = state
            .read()
            .map_err(|_| std::io::Error::other("failed to read route state"))?;
        route_request(
            &request.method,
            &request.path,
            request.authorization.as_deref(),
            &request.body,
            token,
            &state_guard,
            eval_backend.as_ref(),
        )
    };
    write_json_response(stream, response.status, &response.body)
}

fn write_simple_error(stream: &mut TcpStream, status: u16, message: &str) -> std::io::Result<()> {
    let body = json!({ "error": message });
    write_json_response(stream, status, &body)
}

fn write_json_response(stream: &mut TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let body_bytes =
        serde_json::to_vec(body).map_err(|error| std::io::Error::other(error.to_string()))?;
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        408 => "Request Timeout",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        status_text,
        body_bytes.len()
    )?;
    stream.write_all(&body_bytes)?;
    stream.flush()?;
    Ok(())
}

#[derive(Debug)]
struct ParsedHttpRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    body: Vec<u8>,
}

enum RequestParseError {
    Timeout,
    Malformed(&'static str),
    Io(std::io::Error),
}

fn parse_http_request(stream: &mut TcpStream) -> Result<ParsedHttpRequest, RequestParseError> {
    stream
        .set_read_timeout(Some(REQUEST_READ_TIMEOUT))
        .map_err(RequestParseError::Io)?;

    let mut request_buf = Vec::<u8>::new();
    let mut read_buf = [0_u8; 1024];
    let header_end = loop {
        match stream.read(&mut read_buf) {
            Ok(0) => {
                return Err(RequestParseError::Malformed("incomplete_request"));
            }
            Ok(read_len) => {
                request_buf.extend_from_slice(&read_buf[..read_len]);
                if request_buf.len() > REQUEST_HEAD_MAX_BYTES {
                    return Err(RequestParseError::Malformed("request_head_too_large"));
                }
                if let Some(index) = find_header_end(&request_buf) {
                    break index;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
                return Err(RequestParseError::Timeout);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                return Err(RequestParseError::Timeout);
            }
            Err(error) => return Err(RequestParseError::Io(error)),
        }
    };
    let body_offset = header_end + 4;
    let head = std::str::from_utf8(&request_buf[..header_end])
        .map_err(|_| RequestParseError::Malformed("invalid_utf8"))?;

    let mut lines = head.lines();
    let request_line = lines
        .next()
        .ok_or(RequestParseError::Malformed("missing_request_line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or(RequestParseError::Malformed("missing_method"))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or(RequestParseError::Malformed("missing_path"))?
        .to_string();

    let mut headers = HashMap::<String, String>::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = match headers.get("content-length") {
        Some(raw) => raw
            .parse::<usize>()
            .map_err(|_| RequestParseError::Malformed("invalid_content_length"))?,
        None => 0,
    };
    if content_length > REQUEST_BODY_MAX_BYTES {
        return Err(RequestParseError::Malformed("request_body_too_large"));
    }

    let mut body = if body_offset < request_buf.len() {
        request_buf[body_offset..].to_vec()
    } else {
        Vec::new()
    };
    if body.len() > content_length {
        body.truncate(content_length);
    }
    while body.len() < content_length {
        match stream.read(&mut read_buf) {
            Ok(0) => return Err(RequestParseError::Malformed("incomplete_body")),
            Ok(read_len) => {
                let remaining = content_length - body.len();
                let take = remaining.min(read_len);
                body.extend_from_slice(&read_buf[..take]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
                return Err(RequestParseError::Timeout);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                return Err(RequestParseError::Timeout);
            }
            Err(error) => return Err(RequestParseError::Io(error)),
        }
    }

    Ok(ParsedHttpRequest {
        method,
        path,
        authorization: headers.get("authorization").cloned(),
        body,
    })
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4)
        .position(|window| window == b"\r\n\r\n")
}

#[cfg(test)]
fn parse_test_response(raw: &[u8]) -> (u16, Value) {
    let as_text = String::from_utf8_lossy(raw);
    let (head, body) = as_text
        .split_once("\r\n\r\n")
        .expect("response should contain header separator");
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .expect("response should include status code");
    let value = serde_json::from_str::<Value>(body).expect("body should be valid json");
    (status, value)
}

#[cfg(test)]
fn send_test_request(addr: SocketAddr, request: &str) -> Vec<u8> {
    let mut stream = TcpStream::connect(addr).expect("should connect to server");
    stream
        .write_all(request.as_bytes())
        .expect("should write request");
    stream.flush().expect("should flush request");
    stream
        .shutdown(Shutdown::Write)
        .expect("should half-close request stream");
    read_test_response_body(&mut stream)
}

#[cfg(test)]
fn send_test_request_chunks(
    addr: SocketAddr,
    chunks: &[&str],
    close_write: bool,
    read_response: bool,
) -> Vec<u8> {
    let mut stream = TcpStream::connect(addr).expect("should connect to server");
    for chunk in chunks {
        stream
            .write_all(chunk.as_bytes())
            .expect("should write request chunk");
        stream.flush().expect("should flush request chunk");
    }
    if close_write {
        stream
            .shutdown(Shutdown::Write)
            .expect("should half-close request stream");
    }
    if !read_response {
        return Vec::new();
    }
    read_test_response_body(&mut stream)
}

#[cfg(test)]
fn read_test_response_body(stream: &mut TcpStream) -> Vec<u8> {
    let mut response = Vec::<u8>::new();
    let mut buf = [0_u8; 2048];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(read_len) => response.extend_from_slice(&buf[..read_len]),
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => break,
            Err(error) => panic!("should read response: {error}"),
        }
    }
    response
}

#[cfg(test)]
struct TestWebviewEvalBackend;

#[cfg(test)]
impl actions::WebviewEvalBackend for TestWebviewEvalBackend {
    fn evaluate_script(&self, script: &str) -> Result<Value, String> {
        Ok(json!({ "echo": script }))
    }
}

#[cfg(test)]
fn test_server_with_sample_state(token: &str) -> AutomationServer {
    let state = Arc::new(RwLock::new(RouteState {
        platform: "macos".to_string(),
        app_ready: true,
        webview_ready: true,
        sidecar_ready: true,
        window: json!({ "label": "main" }),
        webview: json!({ "url": "http://127.0.0.1:19880" }),
        sidecar: json!({ "running": true }),
    }));
    start_loopback_server(0, token.to_string(), state, Arc::new(TestWebviewEvalBackend))
        .expect("server should start")
}

#[cfg(test)]
mod tests {
    use super::{
        parse_test_response, route_request, send_test_request, send_test_request_chunks,
        test_server_with_sample_state, RouteState, TestWebviewEvalBackend,
    };
    use serde_json::json;

    fn sample_state() -> RouteState {
        RouteState {
            platform: "macos".to_string(),
            app_ready: true,
            webview_ready: true,
            sidecar_ready: true,
            window: json!({ "label": "main" }),
            webview: json!({ "url": "http://127.0.0.1:19880" }),
            sidecar: json!({ "running": true }),
        }
    }

    #[test]
    fn get_health_returns_expected_shape() {
        let state = sample_state();
        let response = route_request(
            "GET",
            "/health",
            Some("Bearer test-token"),
            &[],
            "test-token",
            &state,
            &TestWebviewEvalBackend,
        );

        assert_eq!(response.status, 200);
        assert_eq!(response.body.get("ok").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(
            response.body.get("platform").and_then(|v| v.as_str()),
            Some("macos")
        );
        assert!(response.body.get("appReady").is_some());
        assert!(response.body.get("webviewReady").is_some());
        assert!(response.body.get("sidecarReady").is_some());
    }

    #[test]
    fn get_state_returns_expected_shape() {
        let state = sample_state();
        let response = route_request(
            "GET",
            "/state",
            Some("Bearer test-token"),
            &[],
            "test-token",
            &state,
            &TestWebviewEvalBackend,
        );

        assert_eq!(response.status, 200);
        assert!(response.body.get("window").is_some());
        assert!(response.body.get("webview").is_some());
        assert!(response.body.get("sidecar").is_some());
    }

    #[test]
    fn loopback_server_returns_health_for_valid_token() {
        let server = test_server_with_sample_state("test-token");
        let raw = send_test_request(
            server.local_addr(),
            "GET /health HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer test-token\r\n\r\n",
        );
        let (status, body) = parse_test_response(&raw);
        assert_eq!(status, 200);
        assert_eq!(body.get("ok").and_then(|value| value.as_bool()), Some(true));
        assert_eq!(
            body.get("platform").and_then(|value| value.as_str()),
            Some("macos")
        );
        assert!(body.get("appReady").is_some());
        assert!(body.get("webviewReady").is_some());
        assert!(body.get("sidecarReady").is_some());
        server.shutdown().expect("server should stop");
    }

    #[test]
    fn loopback_server_returns_state_for_valid_token() {
        let server = test_server_with_sample_state("test-token");
        let raw = send_test_request(
            server.local_addr(),
            "GET /state HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer test-token\r\n\r\n",
        );
        let (status, body) = parse_test_response(&raw);
        assert_eq!(status, 200);
        assert_eq!(
            body.get("window")
                .and_then(|window| window.get("label"))
                .and_then(|label| label.as_str()),
            Some("main")
        );
        assert_eq!(
            body.get("webview")
                .and_then(|webview| webview.get("url"))
                .and_then(|url| url.as_str()),
            Some("http://127.0.0.1:19880")
        );
        assert_eq!(
            body.get("sidecar")
                .and_then(|sidecar| sidecar.get("running"))
                .and_then(|running| running.as_bool()),
            Some(true)
        );
        server.shutdown().expect("server should stop");
    }

    #[test]
    fn loopback_server_rejects_invalid_token() {
        let server = test_server_with_sample_state("test-token");
        let raw = send_test_request(
            server.local_addr(),
            "GET /health HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer wrong-token\r\n\r\n",
        );
        let (status, body) = parse_test_response(&raw);
        assert_eq!(status, 401);
        assert_eq!(
            body.get("error").and_then(|value| value.as_str()),
            Some("unauthorized")
        );
        server.shutdown().expect("server should stop");
    }

    #[test]
    fn loopback_server_binds_to_loopback_only() {
        let server = test_server_with_sample_state("test-token");
        assert!(server.local_addr().ip().is_loopback());
        server.shutdown().expect("server should stop");
    }

    #[test]
    fn loopback_server_handles_fragmented_request_head() {
        let server = test_server_with_sample_state("test-token");
        let raw = send_test_request_chunks(
            server.local_addr(),
            &[
                "GET /health HTTP/1.1\r\nHost: localhost\r\nAuthoriz",
                "ation: Bearer test-token\r\n\r\n",
            ],
            true,
            true,
        );
        let (status, body) = parse_test_response(&raw);
        assert_eq!(status, 200);
        assert_eq!(body.get("ok").and_then(|value| value.as_bool()), Some(true));
        server.shutdown().expect("server should stop");
    }

    #[test]
    fn loopback_server_returns_400_for_malformed_request() {
        let server = test_server_with_sample_state("test-token");
        let raw = send_test_request(
            server.local_addr(),
            "GET_ONLY\r\nAuthorization: Bearer test-token\r\n\r\n",
        );
        let (status, body) = parse_test_response(&raw);
        assert_eq!(status, 400);
        assert_eq!(
            body.get("error").and_then(|value| value.as_str()),
            Some("missing_path")
        );
        server.shutdown().expect("server should stop");
    }

    #[test]
    fn loopback_server_returns_408_for_timeout_during_request_head() {
        let server = test_server_with_sample_state("test-token");
        let raw = send_test_request_chunks(
            server.local_addr(),
            &["GET /health HTTP/1.1\r\nHost: localhost\r\n"],
            false,
            true,
        );
        let (status, body) = parse_test_response(&raw);
        assert_eq!(status, 408);
        assert_eq!(
            body.get("error").and_then(|value| value.as_str()),
            Some("request_timeout")
        );
        server.shutdown().expect("server should stop");
    }

    #[test]
    fn webview_eval_contract() {
        let server = test_server_with_sample_state("test-token");

        let unauthorized_body = r#"{"script":"(() => 1)()"}"#;
        let unauthorized_request = format!(
            "POST /webview/eval HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            unauthorized_body.len(),
            unauthorized_body
        );
        let unauthorized_raw = send_test_request(server.local_addr(), &unauthorized_request);
        let (unauthorized_status, unauthorized_response) = parse_test_response(&unauthorized_raw);
        assert_eq!(unauthorized_status, 401);
        assert_eq!(
            unauthorized_response.get("error").and_then(|value| value.as_str()),
            Some("unauthorized")
        );

        let body = r#"{"script":"(() => ({\"value\": 2}))()"}"#;
        let expected_script = "(() => ({\"value\": 2}))()";
        let request = format!(
            "POST /webview/eval HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer test-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let raw = send_test_request(server.local_addr(), &request);
        let (status, response) = parse_test_response(&raw);
        assert_eq!(status, 200);
        assert_eq!(response.get("ok").and_then(|value| value.as_bool()), Some(true));
        assert!(response.get("error").is_some_and(|value| value.is_null()));
        assert_eq!(
            response
                .get("result")
                .and_then(|result| result.get("echo"))
                .and_then(|echo| echo.as_str()),
            Some(expected_script)
        );

        server.shutdown().expect("server should stop");
    }
}
