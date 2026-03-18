use serde_json::Value;

use crate::automation::core::capabilities::WebviewCapability;
use crate::automation::core::errors::AutomationErrorCode;
use crate::automation::core::models::AutomationEnvelope;

use super::router::AutomationRouterBackend;

#[derive(Debug, Clone, PartialEq)]
pub enum WebviewBridgeRequest {
    Eval { script: String },
    DispatchEvent { name: String, payload: Option<Value> },
    Snapshot,
}

pub trait FrontEndBridgeTransport: Send + Sync {
    fn send(&self, request: WebviewBridgeRequest) -> AutomationEnvelope<Value>;
}

#[derive(Debug, Clone)]
pub struct DesktopWebviewBridge<T> {
    transport: T,
}

impl<T> DesktopWebviewBridge<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }
}

impl<T: FrontEndBridgeTransport> DesktopWebviewBridge<T> {
    pub fn eval_envelope(&self, script: &str) -> AutomationEnvelope<Value> {
        self.transport.send(WebviewBridgeRequest::Eval {
            script: script.to_string(),
        })
    }

    pub fn dispatch_event_envelope(
        &self,
        name: &str,
        payload: Option<&Value>,
    ) -> AutomationEnvelope<Value> {
        self.transport.send(WebviewBridgeRequest::DispatchEvent {
            name: name.to_string(),
            payload: payload.cloned(),
        })
    }

    pub fn snapshot_envelope(&self) -> AutomationEnvelope<Value> {
        self.transport.send(WebviewBridgeRequest::Snapshot)
    }

    fn envelope_to_result(envelope: AutomationEnvelope<Value>) -> Result<Value, AutomationErrorCode> {
        match (envelope.ok, envelope.result, envelope.error) {
            (true, Some(result), None) => Ok(result),
            (false, None, Some(error)) => Err(error),
            _ => Err(AutomationErrorCode::InternalError),
        }
    }
}

impl<T: FrontEndBridgeTransport> WebviewCapability for DesktopWebviewBridge<T> {
    fn eval(&self, script: &str) -> Result<Value, AutomationErrorCode> {
        Self::envelope_to_result(self.eval_envelope(script))
    }

    fn dispatch_event(
        &self,
        name: &str,
        payload: Option<&Value>,
    ) -> Result<Value, AutomationErrorCode> {
        Self::envelope_to_result(self.dispatch_event_envelope(name, payload))
    }

    fn snapshot(&self) -> Result<Value, AutomationErrorCode> {
        Self::envelope_to_result(self.snapshot_envelope())
    }
}

impl<T: FrontEndBridgeTransport> AutomationRouterBackend for DesktopWebviewBridge<T> {
    fn webview_capability(&self) -> Option<&dyn WebviewCapability> {
        Some(self)
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopFrontEndBridge;

impl FrontEndBridgeTransport for NoopFrontEndBridge {
    fn send(&self, _request: WebviewBridgeRequest) -> AutomationEnvelope<Value> {
        AutomationEnvelope::failure(AutomationErrorCode::WebviewUnavailable)
    }
}

pub fn desktop_webview_bridge() -> DesktopWebviewBridge<NoopFrontEndBridge> {
    DesktopWebviewBridge::new(NoopFrontEndBridge)
}

#[cfg(test)]
mod tests {
    use super::{
        desktop_webview_bridge, DesktopWebviewBridge, FrontEndBridgeTransport,
        WebviewBridgeRequest,
    };
    use crate::automation::core::models::AutomationEnvelope;
    use serde_json::{json, Value};
    use std::sync::Mutex;

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
        fn send(&self, request: WebviewBridgeRequest) -> AutomationEnvelope<Value> {
            let response = match &request {
                WebviewBridgeRequest::Eval { script } if script.contains("__fail") => {
                    AutomationEnvelope::failure(
                        crate::automation::core::errors::AutomationErrorCode::InternalError,
                    )
                }
                WebviewBridgeRequest::Eval { script } => {
                    AutomationEnvelope::success(json!({ "script": script, "evaluated": true }))
                }
                WebviewBridgeRequest::DispatchEvent { name, payload } => {
                    AutomationEnvelope::success(json!({
                        "name": name,
                        "payload": payload,
                        "dispatched": true
                    }))
                }
                WebviewBridgeRequest::Snapshot => {
                    AutomationEnvelope::success(json!({ "snapshot": true }))
                }
            };
            self.requests.lock().expect("lock should succeed").push(request);
            response
        }
    }

    #[test]
    fn requests_can_be_sent_to_a_mock_front_end_bridge() {
        let bridge = DesktopWebviewBridge::new(MockFrontEndBridge::default());

        let response = bridge.eval_envelope("window.__ready === true");

        assert_eq!(response.ok, true);
        assert_eq!(
            response.result,
            Some(json!({ "script": "window.__ready === true", "evaluated": true }))
        );
        assert_eq!(
            bridge
                .transport()
                .requests
                .lock()
                .expect("lock should succeed")
                .len(),
            1
        );
        assert_eq!(
            bridge
                .transport()
                .requests
                .lock()
                .expect("lock should succeed")[0]
                .clone(),
            WebviewBridgeRequest::Eval {
                script: "window.__ready === true".to_string()
            }
        );
    }

    #[test]
    fn eval_returns_structured_success_and_error_payloads() {
        let bridge = DesktopWebviewBridge::new(MockFrontEndBridge::default());

        let success = bridge.eval_envelope("window.__ready === true");
        assert_eq!(success.ok, true);
        assert_eq!(success.error, None);

        let error = bridge.eval_envelope("window.__fail === true");
        assert_eq!(error.ok, false);
        assert_eq!(error.result, None);
        assert_eq!(
            error.error,
            Some(crate::automation::core::errors::AutomationErrorCode::InternalError)
        );
    }

    #[test]
    fn event_dispatch_delegates_to_the_same_runtime_bridge() {
        let bridge = DesktopWebviewBridge::new(MockFrontEndBridge::default());

        let response = bridge.dispatch_event_envelope(
            "automation:seed-session",
            Some(&json!({"agentId": "claude"})),
        );

        assert_eq!(response.ok, true);
        assert_eq!(
            bridge
                .transport()
                .requests
                .lock()
                .expect("lock should succeed")
                .len(),
            1
        );
        assert_eq!(
            bridge
                .transport()
                .requests
                .lock()
                .expect("lock should succeed")[0]
                .clone(),
            WebviewBridgeRequest::DispatchEvent {
                name: "automation:seed-session".to_string(),
                payload: Some(json!({ "agentId": "claude" }))
            }
        );
    }

    #[test]
    fn snapshot_reads_from_the_front_end_bridge() {
        let bridge = DesktopWebviewBridge::new(MockFrontEndBridge::default());

        let response = bridge.snapshot_envelope();

        assert_eq!(response.ok, true);
        assert_eq!(response.result, Some(json!({ "snapshot": true })));
        assert_eq!(
            bridge
                .transport()
                .requests
                .lock()
                .expect("lock should succeed")
                .len(),
            1
        );
        assert_eq!(
            bridge
                .transport()
                .requests
                .lock()
                .expect("lock should succeed")[0]
                .clone(),
            WebviewBridgeRequest::Snapshot
        );
    }

    #[test]
    fn builds_a_noop_desktop_bridge_for_runtime_wiring() {
        let bridge = desktop_webview_bridge();

        let response = bridge.eval_envelope("window.__ready");

        assert_eq!(response.ok, false);
        assert_eq!(response.result, None);
        assert_eq!(
            response.error,
            Some(crate::automation::core::errors::AutomationErrorCode::WebviewUnavailable)
        );
    }
}
