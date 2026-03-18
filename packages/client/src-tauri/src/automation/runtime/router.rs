use serde_json::{json, Value};

use crate::automation::actions;
use crate::automation::core::capabilities::{
    self, NativeCapability, TestControlCapability, WaitCapability, WebviewCapability,
};
use crate::automation::core::models::{
    NativeActionRequest, ResetRequest, WaitRequest, WebviewEventRequest,
};
use crate::automation::server::RouteState;

pub trait AutomationRouterBackend:
    NativeCapability + WebviewCapability + TestControlCapability + WaitCapability + Send + Sync
{
}

impl<T> AutomationRouterBackend for T where
    T: NativeCapability + WebviewCapability + TestControlCapability + WaitCapability + Send + Sync
{
}

#[derive(Debug, Clone)]
pub struct RouterResponse {
    pub status: u16,
    pub body: Value,
}

pub fn route_request(
    method: &str,
    path: &str,
    authorization: Option<&str>,
    body: &[u8],
    token: &str,
    state: &RouteState,
    backend: &dyn AutomationRouterBackend,
) -> RouterResponse {
    let expected = format!("Bearer {token}");
    if authorization != Some(expected.as_str()) {
        return RouterResponse {
            status: 401,
            body: json!({"error": "unauthorized"}),
        };
    }

    match (method, path) {
        ("GET", "/health") => RouterResponse {
            status: 200,
            body: json!({
                "ok": true,
                "platform": state.platform,
                "appReady": state.app_ready,
                "webviewReady": state.webview_ready,
                "sidecarReady": state.sidecar_ready
            }),
        },
        ("GET", "/state") => RouterResponse {
            status: 200,
            body: json!({
                "window": state.window,
                "webview": state.webview,
                "sidecar": state.sidecar
            }),
        },
        ("POST", "/webview/eval") => {
            let request = match actions::parse_webview_eval_request(body) {
                Ok(request) => request,
                Err(error) => {
                    return RouterResponse {
                        status: 400,
                        body: json!({ "error": error }),
                    }
                }
            };
            RouterResponse {
                status: 200,
                body: json!(capabilities::evaluate_webview(backend, &request.script)),
            }
        }
        ("POST", "/webview/event") => {
            let request = match serde_json::from_slice::<WebviewEventRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse {
                        status: 400,
                        body: json!({ "error": "invalid_json" }),
                    }
                }
            };
            RouterResponse {
                status: 200,
                body: json!(capabilities::dispatch_webview_event(backend, &request)),
            }
        }
        ("POST", "/native/invoke") => {
            let request = match serde_json::from_slice::<NativeActionRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse {
                        status: 400,
                        body: json!({ "error": "invalid_json" }),
                    }
                }
            };
            RouterResponse {
                status: 200,
                body: json!(capabilities::invoke_native(backend, &request)),
            }
        }
        ("POST", "/test/reset") => {
            let request = match serde_json::from_slice::<ResetRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse {
                        status: 400,
                        body: json!({ "error": "invalid_json" }),
                    }
                }
            };
            RouterResponse {
                status: 200,
                body: json!(capabilities::reset_test_control(backend, &request.scopes)),
            }
        }
        ("POST", "/wait") => {
            let request = match serde_json::from_slice::<WaitRequest>(body) {
                Ok(request) => request,
                Err(_) => {
                    return RouterResponse {
                        status: 400,
                        body: json!({ "error": "invalid_json" }),
                    }
                }
            };
            RouterResponse {
                status: 200,
                body: json!(capabilities::wait_for_condition(backend, &request)),
            }
        }
        _ => RouterResponse {
            status: 404,
            body: json!({"error": "not_found"}),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::route_request;
    use crate::automation::core::capabilities::{
        NativeCapability, TestControlCapability, WaitCapability, WebviewCapability,
    };
    use crate::automation::core::errors::AutomationErrorCode;
    use crate::automation::core::models::ResetScope;
    use crate::automation::server::RouteState;
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
    }

    impl TestControlCapability for MockRouterBackend {
        fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode> {
            self.reset_scopes
                .lock()
                .expect("lock should succeed")
                .push(scopes.to_vec());
            Ok(json!({ "resetScopes": scopes }))
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
            response.body,
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
        assert_eq!(supported.body["ok"], json!(true));
        assert_eq!(supported.body["error"], json!(null));

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
        assert_eq!(unsupported.body["ok"], json!(false));
        assert_eq!(unsupported.body["error"], json!("unsupported_action"));
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
        assert_eq!(response.body["ok"], json!(true));
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
        assert_eq!(success.body["ok"], json!(true));

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
        assert_eq!(timeout.body["ok"], json!(false));
        assert_eq!(timeout.body["error"], json!("timeout"));
    }
}
