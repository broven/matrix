pub use super::errors::AutomationErrorCode;
pub use super::models::AutomationEnvelope;
pub type NativeActionRequest = super::models::NativeActionRequest;
pub type ResetRequest = super::models::ResetRequest;
pub type ResetScope = super::models::ResetScope;
pub type WaitCondition = super::models::WaitCondition;
pub type WaitRequest = super::models::WaitRequest;
pub type WebviewEventRequest = super::models::WebviewEventRequest;

pub fn success<T>(result: T) -> AutomationEnvelope<T> {
    AutomationEnvelope::success(result)
}

pub fn failure<T>(error: AutomationErrorCode) -> AutomationEnvelope<T> {
    AutomationEnvelope::failure(error)
}

#[cfg(test)]
mod tests {
    use super::{
        failure, success, AutomationErrorCode, NativeActionRequest, ResetRequest, ResetScope,
        WaitCondition, WaitRequest, WebviewEventRequest,
    };
    use serde_json::{json, to_value};

    #[test]
    fn deserializes_webview_event_request() {
        let request: WebviewEventRequest = serde_json::from_value(json!({
            "name": "automation:seed-session",
            "payload": { "agentId": "claude" }
        }))
        .expect("request should deserialize");

        assert_eq!(request.name, "automation:seed-session");
        assert_eq!(request.payload, Some(json!({ "agentId": "claude" })));
    }

    #[test]
    fn deserializes_native_invoke_request() {
        let request: NativeActionRequest = serde_json::from_value(json!({
            "action": "window.focus",
            "args": { "label": "main" }
        }))
        .expect("request should deserialize");

        assert_eq!(request.action, "window.focus");
        assert_eq!(request.args, Some(json!({ "label": "main" })));
    }

    #[test]
    fn deserializes_test_reset_request() {
        let request: ResetRequest = serde_json::from_value(json!({
            "scopes": ["web-storage", "sidecar"]
        }))
        .expect("request should deserialize");

        assert_eq!(
            request.scopes,
            vec![ResetScope::WebStorage, ResetScope::Sidecar]
        );
    }

    #[test]
    fn deserializes_wait_request() {
        let request: WaitRequest = serde_json::from_value(json!({
            "timeoutMs": 2500,
            "intervalMs": 125,
            "condition": {
                "kind": "webview.eval",
                "script": "window.__ready === true"
            }
        }))
        .expect("request should deserialize");

        assert_eq!(request.timeout_ms, 2500);
        assert_eq!(request.interval_ms, 125);
        assert_eq!(
            request.condition,
            WaitCondition::WebviewEval {
                script: "window.__ready === true".to_string(),
            }
        );
    }

    #[test]
    fn serializes_envelope_shape() {
        let envelope = success(json!({ "status": "ready" }));
        let serialized = to_value(envelope).expect("envelope should serialize");

        assert_eq!(
            serialized,
            json!({
                "ok": true,
                "result": { "status": "ready" },
                "error": null
            })
        );
    }

    #[test]
    fn serializes_failure_with_stable_error_code() {
        let envelope = failure::<serde_json::Value>(AutomationErrorCode::UnsupportedAction);
        let serialized = to_value(envelope).expect("envelope should serialize");

        assert_eq!(
            serialized,
            json!({
                "ok": false,
                "result": null,
                "error": "unsupported_action"
            })
        );
    }

    #[test]
    fn error_code_strings_are_stable() {
        assert_eq!(AutomationErrorCode::UnsupportedAction.as_str(), "unsupported_action");
        assert_eq!(AutomationErrorCode::Timeout.as_str(), "timeout");
    }
}
