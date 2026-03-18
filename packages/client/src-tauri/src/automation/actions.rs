use serde::Deserialize;
use serde_json::Value;

use super::core::capabilities::{self, NativeCapability, WebviewCapability};
use super::core::errors::AutomationErrorCode;
use super::core::models::{AutomationEnvelope, NativeActionRequest};
use super::runtime::router::AutomationRouterBackend;

#[derive(Debug, Deserialize)]
pub struct WebviewEvalRequest {
    pub script: String,
}

pub type WebviewEvalEnvelope = AutomationEnvelope<Value>;

pub trait WebviewEvalBackend: WebviewCapability + Send + Sync {}

impl<T> WebviewEvalBackend for T where T: WebviewCapability + Send + Sync {}

pub struct NoopWebviewEvalBackend;

impl WebviewCapability for NoopWebviewEvalBackend {
    fn eval(&self, _script: &str) -> Result<Value, AutomationErrorCode> {
        Err(AutomationErrorCode::WebviewUnavailable)
    }

    fn dispatch_event(
        &self,
        _name: &str,
        _payload: Option<&Value>,
    ) -> Result<Value, AutomationErrorCode> {
        Err(AutomationErrorCode::WebviewUnavailable)
    }

    fn snapshot(&self) -> Result<Value, AutomationErrorCode> {
        Err(AutomationErrorCode::WebviewUnavailable)
    }
}

impl AutomationRouterBackend for NoopWebviewEvalBackend {
    fn webview_capability(&self) -> Option<&dyn WebviewCapability> {
        Some(self)
    }
}

pub fn parse_webview_eval_request(body: &[u8]) -> Result<WebviewEvalRequest, &'static str> {
    let parsed = serde_json::from_slice::<WebviewEvalRequest>(body).map_err(|_| "invalid_json")?;
    if parsed.script.trim().is_empty() {
        return Err("missing_script");
    }
    Ok(parsed)
}

pub fn evaluate_webview_script(
    backend: &dyn WebviewEvalBackend,
    script: &str,
) -> WebviewEvalEnvelope {
    capabilities::evaluate_webview(backend, script)
}

pub type NativeActionEnvelope = AutomationEnvelope<Value>;

pub trait NativeActionBackend: NativeCapability + Send + Sync {}

impl<T> NativeActionBackend for T where T: NativeCapability + Send + Sync {}

pub fn dispatch_native_action(
    backend: &dyn NativeActionBackend,
    action: &str,
    args: Option<&Value>,
) -> NativeActionEnvelope {
    capabilities::invoke_native(
        backend,
        &NativeActionRequest {
            action: action.to_string(),
            args: args.cloned(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::dispatch_native_action;
    use crate::automation::core::capabilities::NativeCapability;
    use crate::automation::core::errors::AutomationErrorCode;
    use serde_json::json;
    use serde_json::Value;

    #[derive(Default)]
    struct MockNativeActionBackend {
        focus_calls: usize,
        reload_calls: usize,
        status_calls: usize,
    }

    impl NativeCapability for std::sync::Mutex<MockNativeActionBackend> {
        fn invoke(
            &self,
            action: &str,
            _args: Option<&Value>,
        ) -> Result<Value, AutomationErrorCode> {
            let mut guard = self.lock().expect("lock should succeed");
            match action {
                "window.focus" => {
                    guard.focus_calls += 1;
                    Ok(json!({ "focused": true }))
                }
                "window.reload" => {
                    guard.reload_calls += 1;
                    Ok(json!({ "reloaded": true }))
                }
                "sidecar.status" => {
                    guard.status_calls += 1;
                    Ok(json!({ "running": true }))
                }
                _ => Err(AutomationErrorCode::UnsupportedAction),
            }
        }
    }

    #[test]
    fn dispatch_native_action_allows_window_focus() {
        let backend = std::sync::Mutex::new(MockNativeActionBackend::default());
        let response = dispatch_native_action(&backend, "window.focus", None);
        assert_eq!(response.ok, true);
        assert_eq!(response.error, None);
        assert_eq!(response.result, Some(json!({ "focused": true })));
    }

    #[test]
    fn dispatch_native_action_allows_window_reload() {
        let backend = std::sync::Mutex::new(MockNativeActionBackend::default());
        let response = dispatch_native_action(&backend, "window.reload", None);
        assert_eq!(response.ok, true);
        assert_eq!(response.error, None);
        assert_eq!(response.result, Some(json!({ "reloaded": true })));
    }

    #[test]
    fn dispatch_native_action_allows_sidecar_status() {
        let backend = std::sync::Mutex::new(MockNativeActionBackend::default());
        let response = dispatch_native_action(&backend, "sidecar.status", None);
        assert_eq!(response.ok, true);
        assert_eq!(response.error, None);
        assert_eq!(response.result, Some(json!({ "running": true })));
    }

    #[test]
    fn dispatch_native_action_rejects_unsupported_action() {
        let backend = std::sync::Mutex::new(MockNativeActionBackend::default());
        let response = dispatch_native_action(&backend, "sidecar.restart", None);
        assert_eq!(response.ok, false);
        assert_eq!(response.result, None);
        assert_eq!(response.error, Some(AutomationErrorCode::UnsupportedAction));
    }
}
