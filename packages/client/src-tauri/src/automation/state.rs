use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone)]
pub struct AutomationState {
    pub token: String,
    pub platform: &'static str,
    pub port: u16,
    pub app_ready: bool,
    pub webview_ready: bool,
    pub sidecar_ready: bool,
}

impl AutomationState {
    pub fn new(port: u16) -> Self {
        Self {
            token: generate_token(),
            platform: platform_name(),
            port,
            app_ready: false,
            webview_ready: false,
            sidecar_ready: false,
        }
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

fn generate_token() -> String {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let counter = TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    format!("dev-{pid:x}-{now_nanos:x}-{counter:x}")
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::AutomationState;

    #[test]
    fn automation_state_defaults_and_base_url() {
        let state = AutomationState::new(18_765);

        assert!(!state.token.is_empty());
        assert!(!state.platform.is_empty());
        assert_eq!(state.base_url(), "http://127.0.0.1:18765");
        assert!(!state.app_ready);
        assert!(!state.webview_ready);
        assert!(!state.sidecar_ready);
    }
}
