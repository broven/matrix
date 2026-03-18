use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc,
    Arc,
};
use std::time::Duration;

use crate::automation::core::capabilities::WebviewCapability;
use crate::automation::core::errors::AutomationErrorCode;

use super::router::AutomationRouterBackend;

use tauri::{AppHandle, Emitter, Listener};

const RUNTIME_REQUEST_EVENT: &str = "matrix:automation:runtime-request";
const RUNTIME_RESPONSE_EVENT_PREFIX: &str = "matrix:automation:runtime-response:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WebviewBridgeRequest {
    Eval { script: String },
    DispatchEvent { name: String, payload: Option<Value> },
    Snapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBridgeRequest {
    id: u64,
    response_event: String,
    request: WebviewBridgeRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeBridgeResponse {
    id: u64,
    ok: bool,
    result: Option<Value>,
    error: Option<AutomationErrorCode>,
}

pub trait FrontEndBridgeTransport: Send + Sync {
    fn send(&self, request: WebviewBridgeRequest) -> Result<Value, AutomationErrorCode>;
}

impl<T> FrontEndBridgeTransport for Arc<T>
where
    T: FrontEndBridgeTransport + ?Sized,
{
    fn send(&self, request: WebviewBridgeRequest) -> Result<Value, AutomationErrorCode> {
        self.as_ref().send(request)
    }
}

#[derive(Debug, Clone)]
pub struct TauriEventBridgeTransport {
    app: AppHandle,
    request_timeout: Duration,
    next_request_id: Arc<AtomicU64>,
}

impl TauriEventBridgeTransport {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            request_timeout: Duration::from_secs(5),
            next_request_id: Arc::new(AtomicU64::new(1)),
        }
    }

    fn next_request_id(&self) -> u64 {
        self.next_request_id.fetch_add(1, Ordering::Relaxed)
    }

    fn response_event_name(request_id: u64) -> String {
        format!("{RUNTIME_RESPONSE_EVENT_PREFIX}{request_id}")
    }
}

impl FrontEndBridgeTransport for TauriEventBridgeTransport {
    fn send(&self, request: WebviewBridgeRequest) -> Result<Value, AutomationErrorCode> {
        let request_id = self.next_request_id();
        let response_event = Self::response_event_name(request_id);
        let (response_tx, response_rx) = mpsc::channel::<RuntimeBridgeResponse>();

        let listener_id = self.app.listen(response_event.clone(), move |event| {
            if let Ok(response) = serde_json::from_str::<RuntimeBridgeResponse>(event.payload()) {
                let _ = response_tx.send(response);
            }
        });

        let request = RuntimeBridgeRequest {
            id: request_id,
            response_event,
            request,
        };

        if let Err(error) = self.app.emit(RUNTIME_REQUEST_EVENT, request) {
            self.app.unlisten(listener_id);
            let _ = error;
            return Err(AutomationErrorCode::InternalError);
        }

        let response = match response_rx.recv_timeout(self.request_timeout) {
            Ok(response) => response,
            Err(_) => {
                self.app.unlisten(listener_id);
                return Err(AutomationErrorCode::WebviewUnavailable);
            }
        };
        self.app.unlisten(listener_id);

        if response.id != request_id {
            return Err(AutomationErrorCode::InternalError);
        }

        if response.ok {
            return Ok(response.result.unwrap_or(Value::Null));
        }

        Err(response.error.unwrap_or(AutomationErrorCode::InternalError))
    }
}

#[derive(Debug, Clone)]
pub struct DesktopWebviewBridge<T> {
    transport: T,
}

impl<T> DesktopWebviewBridge<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }
}

impl<T: FrontEndBridgeTransport> DesktopWebviewBridge<T> {
    fn send(&self, request: WebviewBridgeRequest) -> Result<Value, AutomationErrorCode> {
        self.transport.send(request)
    }
}

impl<T: FrontEndBridgeTransport> WebviewCapability for DesktopWebviewBridge<T> {
    fn eval(&self, script: &str) -> Result<Value, AutomationErrorCode> {
        self.send(WebviewBridgeRequest::Eval {
            script: script.to_string(),
        })
    }

    fn dispatch_event(
        &self,
        name: &str,
        payload: Option<&Value>,
    ) -> Result<Value, AutomationErrorCode> {
        self.send(WebviewBridgeRequest::DispatchEvent {
            name: name.to_string(),
            payload: payload.cloned(),
        })
    }

    fn snapshot(&self) -> Result<Value, AutomationErrorCode> {
        self.send(WebviewBridgeRequest::Snapshot)
    }
}

impl<T: FrontEndBridgeTransport> AutomationRouterBackend for DesktopWebviewBridge<T> {
    fn webview_capability(&self) -> Option<&dyn WebviewCapability> {
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::{DesktopWebviewBridge, FrontEndBridgeTransport, WebviewBridgeRequest};
    use crate::automation::core::capabilities::WebviewCapability;
    use crate::automation::core::errors::AutomationErrorCode;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    struct MockFrontEndBridge {
        requests: Mutex<Vec<WebviewBridgeRequest>>,
    }

    impl Default for MockFrontEndBridge {
        fn default() -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
            }
        }
    }

    impl FrontEndBridgeTransport for MockFrontEndBridge {
        fn send(&self, request: WebviewBridgeRequest) -> Result<Value, AutomationErrorCode> {
            let response = match &request {
                WebviewBridgeRequest::Eval { script } if script.contains("__fail") => {
                    Err(AutomationErrorCode::InternalError)
                }
                WebviewBridgeRequest::Eval { script } => {
                    Ok(json!({ "script": script, "evaluated": true }))
                }
                WebviewBridgeRequest::DispatchEvent { name, payload } => Ok(json!({
                    "name": name,
                    "payload": payload,
                    "dispatched": true
                })),
                WebviewBridgeRequest::Snapshot => Ok(json!({ "snapshot": true })),
            };
            self.requests.lock().expect("lock should succeed").push(request);
            response
        }
    }

    #[test]
    fn requests_can_be_sent_to_a_mock_front_end_bridge() {
        let transport = Arc::new(MockFrontEndBridge::default());
        let bridge = DesktopWebviewBridge::new(transport.clone());

        let response = bridge.eval("window.__ready === true");

        assert_eq!(
            response,
            Ok(json!({ "script": "window.__ready === true", "evaluated": true }))
        );
        assert_eq!(
            transport.requests.lock().expect("lock should succeed").len(),
            1
        );
        assert_eq!(
            transport.requests.lock().expect("lock should succeed")[0].clone(),
            WebviewBridgeRequest::Eval {
                script: "window.__ready === true".to_string()
            }
        );
    }

    #[test]
    fn eval_returns_structured_success_and_error_payloads() {
        let bridge = DesktopWebviewBridge::new(Arc::new(MockFrontEndBridge::default()));

        let success = bridge.eval("window.__ready === true");
        assert_eq!(
            success,
            Ok(json!({ "script": "window.__ready === true", "evaluated": true }))
        );

        let error = bridge.eval("window.__fail === true");
        assert_eq!(error, Err(AutomationErrorCode::InternalError));
    }

    #[test]
    fn event_dispatch_delegates_to_the_same_runtime_bridge() {
        let transport = Arc::new(MockFrontEndBridge::default());
        let bridge = DesktopWebviewBridge::new(transport.clone());

        let response = bridge.dispatch_event(
            "automation:seed-session",
            Some(&json!({"agentId": "claude"})),
        );

        assert_eq!(
            response,
            Ok(json!({
                "name": "automation:seed-session",
                "payload": { "agentId": "claude" },
                "dispatched": true
            }))
        );
        assert_eq!(
            transport.requests.lock().expect("lock should succeed")[0].clone(),
            WebviewBridgeRequest::DispatchEvent {
                name: "automation:seed-session".to_string(),
                payload: Some(json!({ "agentId": "claude" }))
            }
        );
    }

    #[test]
    fn snapshot_reads_from_the_front_end_bridge() {
        let transport = Arc::new(MockFrontEndBridge::default());
        let bridge = DesktopWebviewBridge::new(transport.clone());

        let response = bridge.snapshot();

        assert_eq!(
            response,
            Ok(json!({ "snapshot": true }))
        );
        assert_eq!(
            transport.requests.lock().expect("lock should succeed")[0].clone(),
            WebviewBridgeRequest::Snapshot
        );
    }
}
