use serde_json::Value;

use super::errors::AutomationErrorCode;
use super::models::{
    AutomationEnvelope, NativeActionRequest, ResetScope, WaitCondition, WaitRequest, WebviewEventRequest,
};

pub trait NativeCapability {
    fn invoke(&self, action: &str, args: Option<&Value>) -> Result<Value, AutomationErrorCode>;

    /// Capture a screenshot of the application window.
    /// Returns PNG-encoded bytes on success.
    fn screenshot(&self) -> Result<Vec<u8>, AutomationErrorCode> {
        Err(AutomationErrorCode::UnsupportedAction)
    }
}

pub trait WebviewCapability {
    fn eval(&self, script: &str) -> Result<Value, AutomationErrorCode>;
    fn dispatch_event(
        &self,
        name: &str,
        payload: Option<&Value>,
    ) -> Result<Value, AutomationErrorCode>;
    #[allow(dead_code)]
    fn snapshot(&self) -> Result<Value, AutomationErrorCode>;
}

pub trait TestControlCapability {
    fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode>;

    /// Mock the next file dialog to return the given path instead of opening the native picker.
    fn mock_file_dialog(&self, path: &str) -> Result<Value, AutomationErrorCode>;
}

pub trait WaitCapability {
    fn wait_for(
        &self,
        condition: &WaitCondition,
        timeout_ms: u64,
        interval_ms: u64,
    ) -> Result<Value, AutomationErrorCode>;
}

pub fn invoke_native<C: NativeCapability + ?Sized>(
    capability: &C,
    request: &NativeActionRequest,
) -> AutomationEnvelope<Value> {
    match capability.invoke(&request.action, request.args.as_ref()) {
        Ok(result) => AutomationEnvelope::success(result),
        Err(error) => AutomationEnvelope::failure(error),
    }
}

pub fn capture_screenshot<C: NativeCapability + ?Sized>(
    capability: &C,
) -> Result<Vec<u8>, AutomationErrorCode> {
    capability.screenshot()
}

pub fn evaluate_webview<C: WebviewCapability + ?Sized>(
    capability: &C,
    script: &str,
) -> AutomationEnvelope<Value> {
    match capability.eval(script) {
        Ok(result) => AutomationEnvelope::success(result),
        Err(error) => AutomationEnvelope::failure(error),
    }
}

pub fn dispatch_webview_event<C: WebviewCapability + ?Sized>(
    capability: &C,
    request: &WebviewEventRequest,
) -> AutomationEnvelope<Value> {
    match capability.dispatch_event(&request.name, request.payload.as_ref()) {
        Ok(result) => AutomationEnvelope::success(result),
        Err(error) => AutomationEnvelope::failure(error),
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn snapshot_webview<C: WebviewCapability + ?Sized>(capability: &C) -> AutomationEnvelope<Value> {
    match capability.snapshot() {
        Ok(result) => AutomationEnvelope::success(result),
        Err(error) => AutomationEnvelope::failure(error),
    }
}

pub fn reset_test_control<C: TestControlCapability + ?Sized>(
    capability: &C,
    scopes: &[ResetScope],
) -> AutomationEnvelope<Value> {
    match capability.reset(scopes) {
        Ok(result) => AutomationEnvelope::success(result),
        Err(error) => AutomationEnvelope::failure(error),
    }
}

pub fn mock_file_dialog<C: TestControlCapability + ?Sized>(
    capability: &C,
    path: &str,
) -> AutomationEnvelope<Value> {
    match capability.mock_file_dialog(path) {
        Ok(result) => AutomationEnvelope::success(result),
        Err(error) => AutomationEnvelope::failure(error),
    }
}

pub fn wait_for_condition<C: WaitCapability + ?Sized>(
    capability: &C,
    request: &WaitRequest,
) -> AutomationEnvelope<Value> {
    match capability.wait_for(&request.condition, request.timeout_ms, request.interval_ms) {
        Ok(result) => AutomationEnvelope::success(result),
        Err(error) => AutomationEnvelope::failure(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    #[derive(Default)]
    struct MockCapability {
        native_actions: RefCell<Vec<String>>,
        eval_scripts: RefCell<Vec<String>>,
        dispatch_events: RefCell<Vec<String>>,
        snapshots: RefCell<u32>,
        reset_scopes: RefCell<Vec<Vec<ResetScope>>>,
        wait_conditions: RefCell<Vec<WaitCondition>>,
    }

    impl NativeCapability for MockCapability {
        fn invoke(&self, action: &str, args: Option<&Value>) -> Result<Value, AutomationErrorCode> {
            self.native_actions.borrow_mut().push(action.to_string());
            match action {
                "window.focus" => Ok(json!({ "focused": true, "args": args.cloned() })),
                "window.reload" => Ok(json!({ "reloaded": true })),
                "sidecar.status" => Ok(json!({ "running": true })),
                _ => Err(AutomationErrorCode::UnsupportedAction),
            }
        }
    }

    impl WebviewCapability for MockCapability {
        fn eval(&self, script: &str) -> Result<Value, AutomationErrorCode> {
            self.eval_scripts.borrow_mut().push(script.to_string());
            Ok(json!({ "script": script, "evaluated": true }))
        }

        fn dispatch_event(
            &self,
            name: &str,
            payload: Option<&Value>,
        ) -> Result<Value, AutomationErrorCode> {
            self.dispatch_events.borrow_mut().push(name.to_string());
            Ok(json!({ "name": name, "payload": payload.cloned() }))
        }

        fn snapshot(&self) -> Result<Value, AutomationErrorCode> {
            *self.snapshots.borrow_mut() += 1;
            Ok(json!({ "ready": true, "count": *self.snapshots.borrow() }))
        }
    }

    impl TestControlCapability for MockCapability {
        fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode> {
            self.reset_scopes.borrow_mut().push(scopes.to_vec());
            Ok(json!({ "resetScopes": scopes }))
        }

        fn mock_file_dialog(&self, path: &str) -> Result<Value, AutomationErrorCode> {
            Ok(json!({ "mocked": true, "path": path }))
        }
    }

    impl WaitCapability for MockCapability {
        fn wait_for(
            &self,
            condition: &WaitCondition,
            timeout_ms: u64,
            interval_ms: u64,
        ) -> Result<Value, AutomationErrorCode> {
            self.wait_conditions.borrow_mut().push(condition.clone());
            Ok(json!({
                "condition": condition,
                "timeoutMs": timeout_ms,
                "intervalMs": interval_ms,
                "ok": true
            }))
        }
    }

    #[test]
    fn invokes_supported_native_actions_and_rejects_unsupported_ones() {
        let capability = MockCapability::default();

        let focused = invoke_native(
            &capability,
            &NativeActionRequest {
                action: "window.focus".to_string(),
                args: Some(json!({ "label": "main" })),
            },
        );
        assert_eq!(focused.ok, true);
        assert_eq!(focused.result, Some(json!({ "focused": true, "args": { "label": "main" } })));
        assert_eq!(focused.error, None);

        let unsupported = invoke_native(
            &capability,
            &NativeActionRequest {
                action: "sidecar.restart".to_string(),
                args: None,
            },
        );
        assert_eq!(unsupported.ok, false);
        assert_eq!(
            unsupported.error,
            Some(AutomationErrorCode::UnsupportedAction)
        );
    }

    #[test]
    fn webview_contract_covers_eval_dispatch_and_snapshot() {
        let capability = MockCapability::default();

        let eval = evaluate_webview(&capability, "window.__ready");
        assert_eq!(eval.ok, true);
        assert_eq!(
            eval.result,
            Some(json!({ "script": "window.__ready", "evaluated": true }))
        );
        assert_eq!(eval.error, None);

        let event = dispatch_webview_event(
            &capability,
            &WebviewEventRequest {
                name: "automation:seed-session".to_string(),
                payload: Some(json!({ "agentId": "claude" })),
            },
        );
        assert_eq!(event.ok, true);
        assert_eq!(
            event.result,
            Some(json!({
                "name": "automation:seed-session",
                "payload": { "agentId": "claude" }
            }))
        );
        assert_eq!(event.error, None);

        let snapshot = snapshot_webview(&capability);
        assert_eq!(snapshot.ok, true);
        assert_eq!(snapshot.result, Some(json!({ "ready": true, "count": 1 })));
        assert_eq!(snapshot.error, None);
    }

    #[test]
    fn reset_contract_accepts_multiple_scopes() {
        let capability = MockCapability::default();
        let response = reset_test_control(
            &capability,
            &[ResetScope::WebStorage, ResetScope::Sidecar],
        );

        assert_eq!(response.ok, true);
        assert_eq!(
            response.result,
            Some(json!({ "resetScopes": ["web-storage", "sidecar"] }))
        );
        assert_eq!(response.error, None);
        assert_eq!(
            capability.reset_scopes.borrow().as_slice(),
            &[vec![ResetScope::WebStorage, ResetScope::Sidecar]]
        );
    }

    #[test]
    fn wait_contract_covers_webview_eval_and_state_match() {
        let capability = MockCapability::default();

        let webview = wait_for_condition(
            &capability,
            &WaitRequest {
                timeout_ms: 5000,
                interval_ms: 100,
                condition: WaitCondition::WebviewEval {
                    script: "window.__ready === true".to_string(),
                },
            },
        );
        assert_eq!(webview.ok, true);
        assert_eq!(
            webview.result,
            Some(json!({
                "condition": {
                    "kind": "webview.eval",
                    "script": "window.__ready === true"
                },
                "timeoutMs": 5000,
                "intervalMs": 100,
                "ok": true
            }))
        );
        assert_eq!(webview.error, None);

        let state = wait_for_condition(
            &capability,
            &WaitRequest {
                timeout_ms: 5000,
                interval_ms: 100,
                condition: WaitCondition::StateMatch {
                path: "webview.ready".to_string(),
                equals: json!(true),
                },
            },
        );
        assert_eq!(state.ok, true);
        assert_eq!(
            state.result,
            Some(json!({
                "condition": {
                    "kind": "state.match",
                    "path": "webview.ready",
                    "equals": true
                },
                "timeoutMs": 5000,
                "intervalMs": 100,
                "ok": true
            }))
        );
        assert_eq!(state.error, None);
        assert_eq!(capability.wait_conditions.borrow().len(), 2);
    }
}
