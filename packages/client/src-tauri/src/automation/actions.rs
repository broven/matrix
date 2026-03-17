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
