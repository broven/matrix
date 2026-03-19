use serde_json::{json, Value};
use std::sync::Arc;

use crate::automation::core::capabilities::{NativeCapability, TestControlCapability};
use crate::automation::core::errors::AutomationErrorCode;
use crate::automation::core::models::ResetScope;
use crate::automation::runtime::router::{AutomationRouterBackend, RouteStateSnapshot};

#[cfg_attr(not(test), allow(dead_code))]
pub trait DesktopWindowFacade: Send + Sync {
    fn focus(&self) -> Result<Value, AutomationErrorCode>;
    fn reload(&self) -> Result<Value, AutomationErrorCode>;
    fn state(&self) -> Value;
}

#[cfg_attr(not(test), allow(dead_code))]
pub trait DesktopSidecarFacade: Send + Sync {
    fn status(&self) -> Result<Value, AutomationErrorCode>;
    fn restart(&self) -> Result<Value, AutomationErrorCode>;
    fn state(&self) -> Value;
}

impl<T> DesktopWindowFacade for Arc<T>
where
    T: DesktopWindowFacade + ?Sized,
{
    fn focus(&self) -> Result<Value, AutomationErrorCode> {
        self.as_ref().focus()
    }

    fn reload(&self) -> Result<Value, AutomationErrorCode> {
        self.as_ref().reload()
    }

    fn state(&self) -> Value {
        self.as_ref().state()
    }
}

impl<T> DesktopSidecarFacade for Arc<T>
where
    T: DesktopSidecarFacade + ?Sized,
{
    fn status(&self) -> Result<Value, AutomationErrorCode> {
        self.as_ref().status()
    }

    fn restart(&self) -> Result<Value, AutomationErrorCode> {
        self.as_ref().restart()
    }

    fn state(&self) -> Value {
        self.as_ref().state()
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub struct DesktopAutomationAdapter<W, S> {
    window: W,
    sidecar: S,
}

#[cfg_attr(not(test), allow(dead_code))]
impl<W, S> DesktopAutomationAdapter<W, S> {
    pub fn new(window: W, sidecar: S) -> Self {
        Self { window, sidecar }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
impl<W: DesktopWindowFacade, S: DesktopSidecarFacade> DesktopAutomationAdapter<W, S> {
    pub fn state(&self) -> RouteStateSnapshot {
        RouteStateSnapshot {
            platform: "macos".to_string(),
            app_ready: true,
            webview_ready: true,
            sidecar_ready: true,
            window: self.window.state(),
            webview: json!({ "kind": "desktop" }),
            sidecar: self.sidecar.state(),
        }
    }
}

impl<W: DesktopWindowFacade, S: DesktopSidecarFacade> NativeCapability for DesktopAutomationAdapter<W, S> {
    fn invoke(&self, action: &str, _args: Option<&Value>) -> Result<Value, AutomationErrorCode> {
        match action {
            "window.focus" => self.window.focus(),
            "window.reload" => self.window.reload(),
            "sidecar.status" => self.sidecar.status(),
            _ => Err(AutomationErrorCode::UnsupportedAction),
        }
    }
}

impl<W: DesktopWindowFacade, S: DesktopSidecarFacade> TestControlCapability for DesktopAutomationAdapter<W, S> {
    fn reset(&self, scopes: &[ResetScope]) -> Result<Value, AutomationErrorCode> {
        let mut window_reloaded = false;
        let mut sidecar_restarted = false;

        if scopes.iter().any(|scope| {
            matches!(
                scope,
                ResetScope::WebStorage
                    | ResetScope::IndexedDb
                    | ResetScope::AutomationState
                    | ResetScope::SessionCache
            )
        }) {
            self.window.reload()?;
            window_reloaded = true;
        }

        if scopes.iter().any(|scope| matches!(scope, ResetScope::Sidecar)) {
            self.sidecar.restart()?;
            sidecar_restarted = true;
        }

        Ok(json!({
            "windowReloaded": window_reloaded,
            "sidecarRestarted": sidecar_restarted,
            "scopes": scopes,
        }))
    }
}

impl<W: DesktopWindowFacade, S: DesktopSidecarFacade> AutomationRouterBackend for DesktopAutomationAdapter<W, S> {
    fn native_capability(&self) -> Option<&dyn NativeCapability> {
        Some(self)
    }

    fn test_control_capability(&self) -> Option<&dyn TestControlCapability> {
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::{DesktopAutomationAdapter, DesktopSidecarFacade, DesktopWindowFacade};
    use crate::automation::core::capabilities::{NativeCapability, TestControlCapability};
    use crate::automation::core::errors::AutomationErrorCode;
    use crate::automation::core::models::ResetScope;
    use serde_json::json;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct RecordingWindowFacade {
        focus_calls: Mutex<u32>,
        reload_calls: Mutex<u32>,
        state: Value,
    }

    impl DesktopWindowFacade for RecordingWindowFacade {
        fn focus(&self) -> Result<Value, AutomationErrorCode> {
            *self.focus_calls.lock().expect("lock should succeed") += 1;
            Ok(json!({ "focused": true }))
        }

        fn reload(&self) -> Result<Value, AutomationErrorCode> {
            *self.reload_calls.lock().expect("lock should succeed") += 1;
            Ok(json!({ "reloaded": true }))
        }

        fn state(&self) -> Value {
            self.state.clone()
        }
    }

    #[derive(Default)]
    struct RecordingSidecarFacade {
        status_calls: Mutex<u32>,
        restart_calls: Mutex<u32>,
        state: Value,
    }

    impl DesktopSidecarFacade for RecordingSidecarFacade {
        fn status(&self) -> Result<Value, AutomationErrorCode> {
            *self.status_calls.lock().expect("lock should succeed") += 1;
            Ok(json!({ "running": true }))
        }

        fn restart(&self) -> Result<Value, AutomationErrorCode> {
            *self.restart_calls.lock().expect("lock should succeed") += 1;
            Ok(json!({ "restarted": true }))
        }

        fn state(&self) -> Value {
            self.state.clone()
        }
    }

    #[test]
    fn supported_native_actions_invoke_correct_facade_methods() {
        let window = Arc::new(RecordingWindowFacade {
            state: json!({ "label": "main", "focused": false, "visible": true }),
            ..Default::default()
        });
        let sidecar = Arc::new(RecordingSidecarFacade {
            state: json!({ "running": true, "port": 19880 }),
            ..Default::default()
        });
        let adapter = DesktopAutomationAdapter::new(window.clone(), sidecar.clone());

        let focus = adapter.invoke("window.focus", None);
        assert_eq!(focus, Ok(json!({ "focused": true })));
        assert_eq!(*window.focus_calls.lock().expect("lock should succeed"), 1);

        let reload = adapter.invoke("window.reload", None);
        assert_eq!(reload, Ok(json!({ "reloaded": true })));
        assert_eq!(*window.reload_calls.lock().expect("lock should succeed"), 1);

        let status = adapter.invoke("sidecar.status", None);
        assert_eq!(status, Ok(json!({ "running": true })));
        assert_eq!(*sidecar.status_calls.lock().expect("lock should succeed"), 1);
    }

    #[test]
    fn state_reports_desktop_window_and_sidecar_metadata() {
        let window = RecordingWindowFacade {
            state: json!({ "label": "main", "focused": true, "visible": true }),
            ..Default::default()
        };
        let sidecar = RecordingSidecarFacade {
            state: json!({ "running": true, "port": 19880 }),
            ..Default::default()
        };
        let adapter = DesktopAutomationAdapter::new(window, sidecar);

        let state = adapter.state();
        assert_eq!(state.platform, "macos");
        assert_eq!(state.window, json!({ "label": "main", "focused": true, "visible": true }));
        assert_eq!(state.sidecar, json!({ "running": true, "port": 19880 }));
        assert_eq!(state.webview, json!({ "kind": "desktop" }));
    }

    #[test]
    fn reset_maps_scopes_to_desktop_behaviors() {
        let window = Arc::new(RecordingWindowFacade {
            state: json!({ "label": "main", "focused": true, "visible": true }),
            ..Default::default()
        });
        let sidecar = Arc::new(RecordingSidecarFacade {
            state: json!({ "running": true, "port": 19880 }),
            ..Default::default()
        });
        let adapter = DesktopAutomationAdapter::new(window.clone(), sidecar.clone());

        let reset = adapter.reset(&[
            ResetScope::WebStorage,
            ResetScope::IndexedDb,
            ResetScope::AutomationState,
            ResetScope::SessionCache,
            ResetScope::Sidecar,
        ]);

        assert_eq!(
            reset,
            Ok(json!({
                "windowReloaded": true,
                "sidecarRestarted": true,
                "scopes": [
                    "web-storage",
                    "indexed-db",
                    "automation-state",
                    "session-cache",
                    "sidecar"
                ]
            }))
        );
        assert_eq!(*window.reload_calls.lock().expect("lock should succeed"), 1);
        assert_eq!(*sidecar.restart_calls.lock().expect("lock should succeed"), 1);
    }

    #[test]
    fn unsupported_actions_return_unsupported_action() {
        let window = RecordingWindowFacade::default();
        let sidecar = RecordingSidecarFacade::default();
        let adapter = DesktopAutomationAdapter::new(window, sidecar);

        let response = adapter.invoke("sidecar.restart", None);
        assert_eq!(response, Err(AutomationErrorCode::UnsupportedAction));
    }
}
