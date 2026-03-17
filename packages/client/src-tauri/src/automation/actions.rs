use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct WebviewEvalRequest {
    pub script: String,
}

#[derive(Debug, Serialize)]
pub struct WebviewEvalEnvelope {
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

pub trait WebviewEvalBackend: Send + Sync {
    fn evaluate_script(&self, script: &str) -> Result<Value, String>;
}

pub struct NoopWebviewEvalBackend;

impl WebviewEvalBackend for NoopWebviewEvalBackend {
    fn evaluate_script(&self, _script: &str) -> Result<Value, String> {
        Err("webview_eval_not_wired".to_string())
    }
}

pub fn parse_webview_eval_request(body: &[u8]) -> Result<WebviewEvalRequest, &'static str> {
    let parsed = serde_json::from_slice::<WebviewEvalRequest>(body)
        .map_err(|_| "invalid_json")?;
    if parsed.script.trim().is_empty() {
        return Err("missing_script");
    }
    Ok(parsed)
}

pub fn evaluate_webview_script(
    backend: &dyn WebviewEvalBackend,
    script: &str,
) -> WebviewEvalEnvelope {
    match backend.evaluate_script(script) {
        Ok(result) => WebviewEvalEnvelope {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => WebviewEvalEnvelope {
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

#[derive(Debug, Deserialize)]
pub struct NativeActionRequest {
    pub action: String,
    pub args: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct NativeActionEnvelope {
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

pub trait NativeActionBackend: Send + Sync {
    fn window_focus(&self) -> Result<Value, String>;
    fn window_reload(&self) -> Result<Value, String>;
    fn sidecar_status(&self) -> Result<Value, String>;
}

pub fn dispatch_native_action(
    backend: &dyn NativeActionBackend,
    action: &str,
    _args: Option<&Value>,
) -> NativeActionEnvelope {
    let result = match action {
        "window.focus" => backend.window_focus(),
        "window.reload" => backend.window_reload(),
        "sidecar.status" => backend.sidecar_status(),
        _ => Err("unsupported_action".to_string()),
    };

    match result {
        Ok(result) => NativeActionEnvelope {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => NativeActionEnvelope {
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{dispatch_native_action, NativeActionBackend};
    use serde_json::json;
    use serde_json::Value;

    #[derive(Default)]
    struct MockNativeActionBackend {
        focus_calls: usize,
        reload_calls: usize,
        status_calls: usize,
    }

    impl NativeActionBackend for std::sync::Mutex<MockNativeActionBackend> {
        fn window_focus(&self) -> Result<Value, String> {
            let mut guard = self.lock().expect("lock should succeed");
            guard.focus_calls += 1;
            Ok(json!({ "focused": true }))
        }

        fn window_reload(&self) -> Result<Value, String> {
            let mut guard = self.lock().expect("lock should succeed");
            guard.reload_calls += 1;
            Ok(json!({ "reloaded": true }))
        }

        fn sidecar_status(&self) -> Result<Value, String> {
            let mut guard = self.lock().expect("lock should succeed");
            guard.status_calls += 1;
            Ok(json!({ "running": true }))
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
        assert_eq!(response.error.as_deref(), Some("unsupported_action"));
    }
}
