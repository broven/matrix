use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{mpsc, Arc, RwLock};
use std::thread;
use std::time::Duration;

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
                if let Err(error) = handle_connection(&mut stream, &token, &state) {
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
    token: &str,
    state: &RouteState,
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
) -> std::io::Result<()> {
    let request = parse_request_head(stream)?;
    let response = {
        let state_guard = state
            .read()
            .map_err(|_| std::io::Error::other("failed to read route state"))?;
        route_request(
            &request.method,
            &request.path,
            request.authorization.as_deref(),
            token,
            &state_guard,
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
        401 => "Unauthorized",
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
struct ParsedRequestHead {
    method: String,
    path: String,
    authorization: Option<String>,
}

fn parse_request_head(stream: &mut TcpStream) -> std::io::Result<ParsedRequestHead> {
    let mut buf = [0_u8; 8192];
    let read_len = stream.read(&mut buf)?;
    let raw = String::from_utf8_lossy(&buf[..read_len]);
    let header_end = raw
        .find("\r\n\r\n")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid request"))?;
    let head = &raw[..header_end];

    let mut lines = head.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing method"))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing path"))?
        .to_string();

    let mut headers = HashMap::<String, String>::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    Ok(ParsedRequestHead {
        method,
        path,
        authorization: headers.get("authorization").cloned(),
    })
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
    let mut response = Vec::<u8>::new();
    stream
        .read_to_end(&mut response)
        .expect("should read response");
    response
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
    start_loopback_server(0, token.to_string(), state).expect("server should start")
}

#[cfg(test)]
mod tests {
    use super::{
        parse_test_response, route_request, send_test_request, test_server_with_sample_state,
        RouteState,
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
            "test-token",
            &state,
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
            "test-token",
            &state,
        );

        assert_eq!(response.status, 200);
        assert!(response.body.get("window").is_some());
        assert!(response.body.get("webview").is_some());
        assert!(response.body.get("sidecar").is_some());
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
}
