use serde_json::Value;
use std::sync::Arc;

use crate::automation::core::capabilities::WebviewCapability;
use crate::automation::core::errors::AutomationErrorCode;

use super::router::AutomationRouterBackend;

#[derive(Debug, Clone, PartialEq)]
pub enum WebviewBridgeRequest {
    Eval { script: String },
    DispatchEvent { name: String, payload: Option<Value> },
    Snapshot,
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
