use serde_json::{json, Value};

use crate::automation::core::capabilities::{
    self, NativeCapability, TestControlCapability, WaitCapability, WebviewCapability,
};
use crate::automation::core::errors::AutomationErrorCode;
use crate::automation::core::models::{
    AutomationEnvelope, MockFileDialogRequest, NativeActionRequest, ResetRequest, WaitRequest,
    WebviewEventRequest,
};
use serde::Serialize;

#[derive(serde::Deserialize)]
struct WebviewEvalRequest {
    script: String,
}

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
pub struct RouteStateSnapshot {
    pub platform: String,
    pub app_ready: bool,
    pub webview_ready: bool,
    pub sidecar_ready: bool,
    pub window: Value,
    pub webview: Value,
    pub sidecar: Value,
}

pub trait AutomationRouterBackend: Send + Sync {
    fn webview_capability(&self) -> Option<&dyn WebviewCapability> {
        None
    }

    fn native_capability(&self) -> Option<&dyn NativeCapability> {
        None
    }

    fn test_control_capability(&self) -> Option<&dyn TestControlCapability> {
        None
    }

    fn wait_capability(&self) -> Option<&dyn WaitCapability> {
        None
    }
}

#[derive(Debug, Clone)]
pub enum RouterResponseBody {
    Json(Value),
    Binary {
        content_type: &'static str,
        data: Vec<u8>,
    },
}

#[derive(Debug, Clone)]
pub struct RouterResponse {
    pub status: u16,
    pub body: RouterResponseBody,
}

impl RouterResponse {
    pub fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            body: RouterResponseBody::Json(body),
        }
    }

    pub fn binary(status: u16, content_type: &'static str, data: Vec<u8>) -> Self {
        Self {
            status,
            body: RouterResponseBody::Binary { content_type, data },
        }
    }
}

pub fn route_request(
    method: &str,
    path: &str,
    authorization: Option<&str>,
    body: &[u8],
    token: &str,
    state: &RouteStateSnapshot,
    backend: &dyn AutomationRouterBackend,
) -> RouterResponse {
    let expected = format!("Bearer {token}");
    if authorization != Some(expected.as_str()) {
        return RouterResponse::json(401, json!({"error": "unauthorized"}));
    }

    match (method, path) {
        ("GET", "/health") => RouterResponse::json(
            200,
            json!(HealthResponse {
                ok: true,
                platform: state.platform.clone(),
                app_ready: state.app_ready,
                webview_ready: state.webview_ready,
                sidecar_ready: state.sidecar_ready,
            }),
        ),
        ("GET", "/state") => RouterResponse::json(
            200,
            json!(StateResponse {
                window: state.window.clone(),
                webview: state.webview.clone(),
                sidecar: state.sidecar.clone(),
            }),
        ),
        ("POST", "/webview/eval") => {
            let request = match serde_json::from_slice::<WebviewEvalRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse::json(400, json!({ "error": "invalid_json" }))
                }
            };
            if request.script.trim().is_empty() {
                return RouterResponse::json(400, json!({ "error": "missing_script" }));
            }
            let Some(capability) = backend.webview_capability() else {
                return capability_unavailable_response(AutomationErrorCode::WebviewUnavailable);
            };
            RouterResponse::json(
                200,
                json!(capabilities::evaluate_webview(capability, &request.script)),
            )
        }
        ("POST", "/webview/event") => {
            let request = match serde_json::from_slice::<WebviewEventRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse::json(400, json!({ "error": "invalid_json" }))
                }
            };
            let Some(capability) = backend.webview_capability() else {
                return capability_unavailable_response(AutomationErrorCode::WebviewUnavailable);
            };
            RouterResponse::json(
                200,
                json!(capabilities::dispatch_webview_event(capability, &request)),
            )
        }
        ("POST", "/native/invoke") => {
            let request = match serde_json::from_slice::<NativeActionRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse::json(400, json!({ "error": "invalid_json" }))
                }
            };
            let Some(capability) = backend.native_capability() else {
                return capability_unavailable_response(AutomationErrorCode::NativeUnavailable);
            };
            RouterResponse::json(
                200,
                json!(capabilities::invoke_native(capability, &request)),
            )
        }
        ("POST", "/native/screenshot") => {
            let Some(capability) = backend.native_capability() else {
                return capability_unavailable_response(AutomationErrorCode::NativeUnavailable);
            };
            match capabilities::capture_screenshot(capability) {
                Ok(png_bytes) => RouterResponse::binary(200, "image/png", png_bytes),
                Err(error) => RouterResponse::json(
                    200,
                    json!(AutomationEnvelope::<Value>::failure(error)),
                ),
            }
        }
        ("POST", "/test/reset") => {
            let request = match serde_json::from_slice::<ResetRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse::json(400, json!({ "error": "invalid_json" }))
                }
            };
            let Some(capability) = backend.test_control_capability() else {
                return capability_unavailable_response(AutomationErrorCode::ResetFailed);
            };
            RouterResponse::json(
                200,
                json!(capabilities::reset_test_control(
                    capability,
                    &request.scopes
                )),
            )
        }
        ("POST", "/test/mock-file-dialog") => {
            let request = match serde_json::from_slice::<MockFileDialogRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse::json(400, json!({ "error": "invalid_json" }))
                }
            };
            let Some(capability) = backend.test_control_capability() else {
                return capability_unavailable_response(AutomationErrorCode::ResetFailed);
            };
            RouterResponse::json(
                200,
                json!(capabilities::mock_file_dialog(capability, &request.path)),
            )
        }
        ("POST", "/wait") => {
            let request = match serde_json::from_slice::<WaitRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse::json(400, json!({ "error": "invalid_json" }))
                }
            };
            let Some(capability) = backend.wait_capability() else {
                return capability_unavailable_response(AutomationErrorCode::UnsupportedCondition);
            };
            RouterResponse::json(
                200,
                json!(capabilities::wait_for_condition(capability, &request)),
            )
        }
        _ => RouterResponse::json(404, json!({"error": "not_found"})),
    }
}

fn capability_unavailable_response(error: AutomationErrorCode) -> RouterResponse {
    RouterResponse::json(200, json!(AutomationEnvelope::<Value>::failure(error)))
}

#[cfg(test)]
mod tests {
    use super::{route_request, AutomationRouterBackend, RouteStateSnapshot};
    use crate::automation::core::capabilities::{
        NativeCapability, TestControlCapability, WaitCapability, WebviewCapability,
    };
    use crate::automation::core::errors::AutomationErrorCode;
    use crate::automation::core::models::ResetScope;
    use serde_json::json;
    use serde_json::Value;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MockRouterBackend {
        events: Mutex<Vec<String>>,
        native_actions: Mutex<Vec<String>>,
        reset_scopes: Mutex<Vec<Vec<ResetScope>>>,
        wait_conditions: Mutex<Vec<Value>>,
        timeout_next_wait: Mutex<bool>,
    }

    impl AutomationRouterBackend for MockRouterBackend {
        fn webview_capability(&self) -> Option<&dyn WebviewCapability> {
            Some(self)
        }

        fn native_capability(&self) -> Option<&dyn NativeCapability> {
            Some(self)
        }

        fn test_control_capability(&self) -> Option<&dyn TestControlCapability> {
            Some(self)
        }

        fn wait_capability(&self) -> Option<&dyn WaitCapability> {
            Some(self)
        }
    }

    impl WebviewCapability for MockRouterBackend {
        fn eval(&self, script: &str) -> Result<Value, AutomationErrorCode> {
            Ok(json!({ "script": script, "evaluated": true }))
        }

        fn dispatch_event(
            &self,
            name: &str,
            payload: Option<&Value>,
        ) -> Result<Value, AutomationErrorCode> {
            self.events
                .lock()
                .expect("lock should succeed")
                .push(name.to_string());
            Ok(json!({ "name": name, "payload": payload.cloned() }))
        }

        fn snapshot(&self) -> Result<Value, AutomationErrorCode> {
            Ok(json!({ "snapshot": true }))
        }
    }

    impl NativeCapability for MockRouterBackend {
        fn invoke(&self, action: &str, args: Option<&Value>) -> Result<Value, AutomationErrorCode> {
            self.native_actions
                .lock()
                .expect("lock should succeed")
                .push(action.to_string());
            match action {
                "window.focus" => Ok(json!({ "focused": true, "args": args.cloned() })),
                "window.reload" => Ok(json!({ "reloaded": true })),
                "sidecar.status" => Ok(json!({ "running": true })),
                _ => Err(AutomationErrorCode::UnsupportedAction),
            }
        }

        fn screenshot(&self) -> Result<Vec<u8>, AutomationErrorCode> {
            // Return a minimal valid PNG for testing
            Ok(vec![
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            ])
        }
    }

    impl TestControlCapability for MockRouterBackend {
        fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode> {
            self.reset_scopes
                .lock()
                .expect("lock should succeed")
                .push(scopes.to_vec());
            Ok(json!({ "resetScopes": scopes }))
        }

        fn mock_file_dialog(&self, path: &str) -> Result<Value, AutomationErrorCode> {
            Ok(json!({ "mocked": true, "path": path }))
        }
    }

    impl WaitCapability for MockRouterBackend {
        fn wait_for(
            &self,
            condition: &crate::automation::core::models::WaitCondition,
            _timeout_ms: u64,
            _interval_ms: u64,
        ) -> Result<Value, AutomationErrorCode> {
            self.wait_conditions
                .lock()
                .expect("lock should succeed")
                .push(json!(condition));
            let mut timeout_next_wait = self.timeout_next_wait.lock().expect("lock should succeed");
            if *timeout_next_wait {
                *timeout_next_wait = false;
                return Err(AutomationErrorCode::Timeout);
            }

            Ok(json!({ "condition": condition, "ok": true }))
        }
    }

    /// Extract JSON body from a RouterResponse, panicking if it's binary.
    fn json_body(response: &super::RouterResponse) -> &Value {
        match &response.body {
            super::RouterResponseBody::Json(value) => value,
            super::RouterResponseBody::Binary { .. } => {
                panic!("expected JSON response, got binary")
            }
        }
    }

    fn sample_state() -> RouteStateSnapshot {
        RouteStateSnapshot {
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
    fn route_request_dispatches_webview_event() {
        let backend = MockRouterBackend::default();
        let response = route_request(
            "POST",
            "/webview/event",
            Some("Bearer test-token"),
            br#"{"name":"automation:seed-session","payload":{"agentId":"claude"}}"#,
            "test-token",
            &sample_state(),
            &backend,
        );

        assert_eq!(response.status, 200);
        assert_eq!(
            *json_body(&response),
            json!({
                "ok": true,
                "result": {
                    "name": "automation:seed-session",
                    "payload": { "agentId": "claude" }
                },
                "error": null
            })
        );
        assert_eq!(
            backend
                .events
                .lock()
                .expect("lock should succeed")
                .as_slice(),
            &["automation:seed-session".to_string()]
        );
    }

    #[test]
    fn route_request_dispatches_supported_and_unsupported_native_actions() {
        let backend = MockRouterBackend::default();

        let supported = route_request(
            "POST",
            "/native/invoke",
            Some("Bearer test-token"),
            br#"{"action":"window.focus","args":{"label":"main"}}"#,
            "test-token",
            &sample_state(),
            &backend,
        );
        assert_eq!(supported.status, 200);
        assert_eq!(json_body(&supported)["ok"], json!(true));
        assert_eq!(json_body(&supported)["error"], json!(null));

        let unsupported = route_request(
            "POST",
            "/native/invoke",
            Some("Bearer test-token"),
            br#"{"action":"sidecar.restart"}"#,
            "test-token",
            &sample_state(),
            &backend,
        );
        assert_eq!(unsupported.status, 200);
        assert_eq!(json_body(&unsupported)["ok"], json!(false));
        assert_eq!(json_body(&unsupported)["error"], json!("unsupported_action"));
    }

    #[test]
    fn route_request_dispatches_reset_scopes() {
        let backend = MockRouterBackend::default();
        let response = route_request(
            "POST",
            "/test/reset",
            Some("Bearer test-token"),
            br#"{"scopes":["web-storage","sidecar"]}"#,
            "test-token",
            &sample_state(),
            &backend,
        );

        assert_eq!(response.status, 200);
        assert_eq!(json_body(&response)["ok"], json!(true));
        assert_eq!(
            backend
                .reset_scopes
                .lock()
                .expect("lock should succeed")
                .as_slice(),
            &[vec![ResetScope::WebStorage, ResetScope::Sidecar]]
        );
    }

    #[test]
    fn route_request_dispatches_wait_success_and_timeout() {
        let backend = MockRouterBackend::default();
        let success = route_request(
            "POST",
            "/wait",
            Some("Bearer test-token"),
            br#"{"timeoutMs":5000,"intervalMs":100,"condition":{"kind":"webview.eval","script":"window.__ready === true"}}"#,
            "test-token",
            &sample_state(),
            &backend,
        );

        assert_eq!(success.status, 200);
        assert_eq!(json_body(&success)["ok"], json!(true));

        *backend
            .timeout_next_wait
            .lock()
            .expect("lock should succeed") = true;
        let timeout = route_request(
            "POST",
            "/wait",
            Some("Bearer test-token"),
            br#"{"timeoutMs":5000,"intervalMs":100,"condition":{"kind":"state.match","path":"webview.ready","equals":true}}"#,
            "test-token",
            &sample_state(),
            &backend,
        );

        assert_eq!(timeout.status, 200);
        assert_eq!(json_body(&timeout)["ok"], json!(false));
        assert_eq!(json_body(&timeout)["error"], json!("timeout"));
    }

    #[test]
    fn route_request_dispatches_screenshot() {
        let backend = MockRouterBackend::default();
        let response = route_request(
            "POST",
            "/native/screenshot",
            Some("Bearer test-token"),
            &[],
            "test-token",
            &sample_state(),
            &backend,
        );

        assert_eq!(response.status, 200);
        match &response.body {
            super::RouterResponseBody::Binary { content_type, data } => {
                assert_eq!(*content_type, "image/png");
                assert_eq!(&data[..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
            }
            super::RouterResponseBody::Json(_) => {
                panic!("expected binary response for screenshot");
            }
        }
    }
}
