use serde_json::Value;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::automation::core::capabilities::{
    NativeCapability, TestControlCapability, WaitCapability, WebviewCapability,
};
use crate::automation::core::errors::AutomationErrorCode;
use crate::automation::core::models::WaitCondition;

use super::desktop::{DesktopAutomationAdapter, DesktopSidecarFacade, DesktopWindowFacade};
use super::router::{AutomationRouterBackend, RouteStateSnapshot};
use super::webview::{DesktopWebviewBridge, FrontEndBridgeTransport};

pub struct DesktopRuntimeBackend<T, W, S> {
    webview_bridge: DesktopWebviewBridge<T>,
    desktop_adapter: DesktopAutomationAdapter<W, S>,
    route_state: Arc<RwLock<RouteStateSnapshot>>,
}

impl<T, W, S> DesktopRuntimeBackend<T, W, S> {
    pub fn new(
        webview_bridge: DesktopWebviewBridge<T>,
        desktop_adapter: DesktopAutomationAdapter<W, S>,
        route_state: Arc<RwLock<RouteStateSnapshot>>,
    ) -> Self {
        Self {
            webview_bridge,
            desktop_adapter,
            route_state,
        }
    }
}

impl<T: FrontEndBridgeTransport, W: DesktopWindowFacade, S: DesktopSidecarFacade>
    AutomationRouterBackend for DesktopRuntimeBackend<T, W, S>
{
    fn webview_capability(&self) -> Option<&dyn WebviewCapability> {
        Some(&self.webview_bridge)
    }

    fn native_capability(&self) -> Option<&dyn NativeCapability> {
        Some(&self.desktop_adapter)
    }

    fn test_control_capability(&self) -> Option<&dyn TestControlCapability> {
        Some(&self.desktop_adapter)
    }

    fn wait_capability(&self) -> Option<&dyn WaitCapability> {
        Some(self)
    }
}

impl<T: FrontEndBridgeTransport, W: DesktopWindowFacade, S: DesktopSidecarFacade> WaitCapability
    for DesktopRuntimeBackend<T, W, S>
{
    fn wait_for(
        &self,
        condition: &WaitCondition,
        timeout_ms: u64,
        interval_ms: u64,
    ) -> Result<Value, AutomationErrorCode> {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        let interval = Duration::from_millis(interval_ms);

        loop {
            match condition {
                WaitCondition::WebviewEval { script } => {
                    match self.webview_bridge.eval(script) {
                        Ok(value) => {
                            if is_truthy(&value) {
                                return Ok(value);
                            }
                        }
                        Err(AutomationErrorCode::WebviewUnavailable) => {}
                        Err(error) => return Err(error),
                    }
                }
                WaitCondition::StateMatch { path, equals } => {
                    let state = self
                        .route_state
                        .read()
                        .map_err(|_| AutomationErrorCode::InternalError)?;
                    if state_path_matches(&state, path, equals) {
                        return Ok(equals.clone());
                    }
                }
            }

            if Instant::now() >= deadline {
                return Err(AutomationErrorCode::Timeout);
            }

            thread::sleep(interval);
        }
    }
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map_or(false, |f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn state_path_matches(state: &RouteStateSnapshot, path: &str, equals: &Value) -> bool {
    let root = serde_json::json!({
        "window": state.window,
        "webview": state.webview,
        "sidecar": state.sidecar,
        "platform": state.platform,
        "appReady": state.app_ready,
        "webviewReady": state.webview_ready,
        "sidecarReady": state.sidecar_ready,
    });

    let mut current = &root;
    for segment in path.split('.') {
        match current.get(segment) {
            Some(next) => current = next,
            None => return false,
        }
    }
    current == equals
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::core::models::ResetScope;
    use crate::automation::runtime::desktop::{DesktopSidecarFacade, DesktopWindowFacade};
    use crate::automation::runtime::webview::{DesktopWebviewBridge, FrontEndBridgeTransport, WebviewBridgeRequest};
    use serde_json::json;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct CountingTransport {
        call_count: AtomicU32,
        truthy_after: u32,
    }

    impl FrontEndBridgeTransport for CountingTransport {
        fn send(&self, request: WebviewBridgeRequest) -> Result<Value, AutomationErrorCode> {
            let count = self.call_count.fetch_add(1, Ordering::Relaxed) + 1;
            match request {
                WebviewBridgeRequest::Eval { .. } => {
                    if count >= self.truthy_after {
                        Ok(json!(true))
                    } else {
                        Ok(Value::Null)
                    }
                }
                _ => Ok(Value::Null),
            }
        }
    }

    struct StubWindow;
    impl DesktopWindowFacade for StubWindow {
        fn focus(&self) -> Result<Value, AutomationErrorCode> {
            Ok(json!({"focused": true}))
        }
        fn reload(&self) -> Result<Value, AutomationErrorCode> {
            Ok(json!({"reloaded": true}))
        }
        fn state(&self) -> Value {
            json!({"label": "main", "focused": true, "visible": true})
        }
    }

    struct StubSidecar;
    impl DesktopSidecarFacade for StubSidecar {
        fn status(&self) -> Result<Value, AutomationErrorCode> {
            Ok(json!({"running": true}))
        }
        fn restart(&self) -> Result<Value, AutomationErrorCode> {
            Ok(json!({"restarted": true}))
        }
        fn state(&self) -> Value {
            json!({"running": true, "port": 19880})
        }
    }

    fn sample_route_state() -> RouteStateSnapshot {
        RouteStateSnapshot {
            platform: "macos".to_string(),
            app_ready: true,
            webview_ready: true,
            sidecar_ready: true,
            window: json!({"label": "main", "focused": true, "visible": true}),
            webview: json!({"url": "http://127.0.0.1:19880"}),
            sidecar: json!({"running": true, "port": 19880}),
        }
    }

    fn make_backend(
        truthy_after: u32,
        route_state: Arc<RwLock<RouteStateSnapshot>>,
    ) -> DesktopRuntimeBackend<Arc<CountingTransport>, StubWindow, StubSidecar> {
        let transport = Arc::new(CountingTransport {
            call_count: AtomicU32::new(0),
            truthy_after,
        });
        DesktopRuntimeBackend::new(
            DesktopWebviewBridge::new(transport),
            DesktopAutomationAdapter::new(StubWindow, StubSidecar),
            route_state,
        )
    }

    #[test]
    fn composite_backend_provides_all_capabilities() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(1, state);

        assert!(backend.webview_capability().is_some());
        assert!(backend.native_capability().is_some());
        assert!(backend.test_control_capability().is_some());
        assert!(backend.wait_capability().is_some());
    }

    #[test]
    fn webview_eval_wait_succeeds_when_truthy() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(1, state);

        let result = backend.wait_for(
            &WaitCondition::WebviewEval {
                script: "window.__ready".to_string(),
            },
            5000,
            10,
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), json!(true));
    }

    #[test]
    fn webview_eval_wait_polls_until_truthy() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(3, state);

        let result = backend.wait_for(
            &WaitCondition::WebviewEval {
                script: "window.__ready".to_string(),
            },
            5000,
            10,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn webview_eval_wait_times_out() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(u32::MAX, state);

        let result = backend.wait_for(
            &WaitCondition::WebviewEval {
                script: "window.__never".to_string(),
            },
            100,
            10,
        );
        assert_eq!(result, Err(AutomationErrorCode::Timeout));
    }

    #[test]
    fn state_match_wait_succeeds_when_path_matches() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(1, state);

        let result = backend.wait_for(
            &WaitCondition::StateMatch {
                path: "sidecar.running".to_string(),
                equals: json!(true),
            },
            5000,
            10,
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), json!(true));
    }

    #[test]
    fn state_match_wait_times_out_when_path_does_not_match() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(1, state);

        let result = backend.wait_for(
            &WaitCondition::StateMatch {
                path: "sidecar.running".to_string(),
                equals: json!(false),
            },
            100,
            10,
        );
        assert_eq!(result, Err(AutomationErrorCode::Timeout));
    }

    #[test]
    fn native_invoke_delegates_to_desktop_adapter() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(1, state);

        let native = backend.native_capability().unwrap();
        let result = native.invoke("sidecar.status", None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_reset_delegates_to_desktop_adapter() {
        let state = Arc::new(RwLock::new(sample_route_state()));
        let backend = make_backend(1, state);

        let test_control = backend.test_control_capability().unwrap();
        let result = test_control.reset(&[ResetScope::AutomationState]);
        assert!(result.is_ok());
    }

    #[test]
    fn is_truthy_checks_json_values() {
        assert!(!is_truthy(&Value::Null));
        assert!(!is_truthy(&json!(false)));
        assert!(!is_truthy(&json!(0)));
        assert!(!is_truthy(&json!("")));
        assert!(is_truthy(&json!(true)));
        assert!(is_truthy(&json!(1)));
        assert!(is_truthy(&json!("hello")));
        assert!(is_truthy(&json!([1])));
        assert!(is_truthy(&json!({"a": 1})));
    }
}
