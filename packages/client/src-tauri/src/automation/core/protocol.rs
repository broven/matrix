#[cfg(test)]
mod tests {
    use super::super::errors::AutomationErrorCode;
    use super::super::models::{
        AutomationEnvelope, NativeActionRequest, ResetRequest, ResetScope, WaitCondition, WaitRequest,
        WebviewEventRequest,
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
        let envelope = AutomationEnvelope::success(json!({ "status": "ready" }));
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
    fn stable_error_strings_are_preserved() {
        assert_eq!(AutomationErrorCode::UnsupportedAction.as_str(), "unsupported_action");
        assert_eq!(AutomationErrorCode::Timeout.as_str(), "timeout");
    }
}
