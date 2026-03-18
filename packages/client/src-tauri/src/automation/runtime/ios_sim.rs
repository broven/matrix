use serde_json::{json, Value};
use std::sync::Arc;

use crate::automation::core::capabilities::{NativeCapability, TestControlCapability};
use crate::automation::core::errors::AutomationErrorCode;
use crate::automation::core::models::ResetScope;
use crate::automation::runtime::router::{AutomationRouterBackend, RouteStateSnapshot};

pub trait IosAppFacade: Send + Sync {
    fn reload(&self) -> Result<Value, AutomationErrorCode>;
    fn state(&self) -> Value;
}

pub trait IosWebviewFacade: Send + Sync {
    fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode>;
    fn state(&self) -> Value;
}

impl<T> IosAppFacade for Arc<T>
where
    T: IosAppFacade + ?Sized,
{
    fn reload(&self) -> Result<Value, AutomationErrorCode> {
        self.as_ref().reload()
    }

    fn state(&self) -> Value {
        self.as_ref().state()
    }
}

impl<T> IosWebviewFacade for Arc<T>
where
    T: IosWebviewFacade + ?Sized,
{
    fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode> {
        self.as_ref().reset(scopes)
    }

    fn state(&self) -> Value {
        self.as_ref().state()
    }
}

pub struct IosSimulatorAdapter<A, W> {
    app: A,
    webview: W,
}

impl<A, W> IosSimulatorAdapter<A, W> {
    pub fn new(app: A, webview: W) -> Self {
        Self { app, webview }
    }
}

impl<A: IosAppFacade, W: IosWebviewFacade> IosSimulatorAdapter<A, W> {
    pub fn state(&self) -> RouteStateSnapshot {
        RouteStateSnapshot {
            platform: "ios-sim".to_string(),
            app_ready: true,
            webview_ready: true,
            sidecar_ready: false,
            window: self.app.state(),
            webview: self.webview.state(),
            sidecar: Value::Null,
        }
    }
}

impl<A: IosAppFacade, W: IosWebviewFacade> NativeCapability for IosSimulatorAdapter<A, W> {
    fn invoke(&self, action: &str, _args: Option<&Value>) -> Result<Value, AutomationErrorCode> {
        match action {
            "window.reload" => self.app.reload(),
            "window.focus" | "sidecar.status" | "sidecar.restart" => {
                Err(AutomationErrorCode::UnsupportedAction)
            }
            _ => Err(AutomationErrorCode::UnsupportedAction),
        }
    }
}

impl<A: IosAppFacade, W: IosWebviewFacade> TestControlCapability for IosSimulatorAdapter<A, W> {
    fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode> {
        let webview = self.webview.reset(scopes)?;
        Ok(json!({
            "platform": "ios-sim",
            "scopes": scopes,
            "webview": webview,
        }))
    }
}

impl<A: IosAppFacade, W: IosWebviewFacade> AutomationRouterBackend for IosSimulatorAdapter<A, W> {
    fn native_capability(&self) -> Option<&dyn NativeCapability> {
        Some(self)
    }

    fn test_control_capability(&self) -> Option<&dyn TestControlCapability> {
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::{IosAppFacade, IosSimulatorAdapter, IosWebviewFacade};
    use crate::automation::core::capabilities::{NativeCapability, TestControlCapability};
    use crate::automation::core::errors::AutomationErrorCode;
    use crate::automation::core::models::ResetScope;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct RecordingIosAppFacade {
        reload_calls: Mutex<u32>,
        state: Value,
    }

    impl IosAppFacade for RecordingIosAppFacade {
        fn reload(&self) -> Result<Value, AutomationErrorCode> {
            *self.reload_calls.lock().expect("lock should succeed") += 1;
            Ok(json!({ "reloaded": true }))
        }

        fn state(&self) -> Value {
            self.state.clone()
        }
    }

    #[derive(Default)]
    struct RecordingIosWebviewFacade {
        reset_scopes: Mutex<Vec<Vec<ResetScope>>>,
        state: Value,
    }

    impl IosWebviewFacade for RecordingIosWebviewFacade {
        fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode> {
            self.reset_scopes
                .lock()
                .expect("lock should succeed")
                .push(scopes.to_vec());
            Ok(json!({ "resetScopes": scopes }))
        }

        fn state(&self) -> Value {
            self.state.clone()
        }
    }

    #[test]
    fn shared_actions_reuse_existing_capability_contracts() {
        let app = Arc::new(RecordingIosAppFacade {
            state: json!({ "scenePhase": "active" }),
            ..Default::default()
        });
        let webview = Arc::new(RecordingIosWebviewFacade {
            state: json!({ "url": "http://127.0.0.1:19880/mobile" }),
            ..Default::default()
        });
        let adapter = IosSimulatorAdapter::new(app.clone(), webview);

        let reload = adapter.invoke("window.reload", None);

        assert_eq!(reload, Ok(json!({ "reloaded": true })));
        assert_eq!(*app.reload_calls.lock().expect("lock should succeed"), 1);
    }

    #[test]
    fn desktop_only_actions_return_unsupported_action() {
        let app = RecordingIosAppFacade::default();
        let webview = RecordingIosWebviewFacade::default();
        let adapter = IosSimulatorAdapter::new(app, webview);

        assert_eq!(
            adapter.invoke("window.focus", None),
            Err(AutomationErrorCode::UnsupportedAction)
        );
        assert_eq!(
            adapter.invoke("sidecar.status", None),
            Err(AutomationErrorCode::UnsupportedAction)
        );
        assert_eq!(
            adapter.invoke("sidecar.restart", None),
            Err(AutomationErrorCode::UnsupportedAction)
        );
    }

    #[test]
    fn state_and_reset_responses_produce_valid_snapshots() {
        let app = Arc::new(RecordingIosAppFacade {
            state: json!({ "scenePhase": "active", "visible": true }),
            ..Default::default()
        });
        let webview = Arc::new(RecordingIosWebviewFacade {
            state: json!({ "url": "http://127.0.0.1:19880/mobile", "title": "Matrix" }),
            ..Default::default()
        });
        let adapter = IosSimulatorAdapter::new(app, webview.clone());

        let state = adapter.state();
        assert_eq!(state.platform, "ios-sim");
        assert_eq!(state.window, json!({ "scenePhase": "active", "visible": true }));
        assert_eq!(
            state.webview,
            json!({ "url": "http://127.0.0.1:19880/mobile", "title": "Matrix" })
        );
        assert_eq!(state.sidecar, Value::Null);

        let reset = adapter.reset(&[ResetScope::WebStorage, ResetScope::AutomationState]);
        assert_eq!(
            reset,
            Ok(json!({
                "platform": "ios-sim",
                "scopes": ["web-storage", "automation-state"],
                "webview": {
                    "resetScopes": ["web-storage", "automation-state"]
                }
            }))
        );
        assert_eq!(
            webview.reset_scopes.lock().expect("lock should succeed").as_slice(),
            &[vec![ResetScope::WebStorage, ResetScope::AutomationState]]
        );
    }
}
