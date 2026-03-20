use std::env;

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
    pub fn new(port: u16, token: String) -> Self {
        Self {
            token,
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

    /// Read port from env var (with fallback) and token from env var (with default "dev").
    pub fn from_env(port_var: &str, fallback_port: u16) -> Self {
        let port = env::var(port_var)
            .ok()
            .and_then(|raw| raw.parse::<u16>().ok())
            .unwrap_or(fallback_port);
        let token = env::var("MATRIX_AUTOMATION_TOKEN").unwrap_or_else(|_| "dev".to_string());
        Self::new(port, token)
    }
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
        let state = AutomationState::new(18_765, "test-token".to_string());

        assert_eq!(state.token, "test-token");
        assert!(!state.platform.is_empty());
        assert_eq!(state.base_url(), "http://127.0.0.1:18765");
        assert!(!state.app_ready);
        assert!(!state.webview_ready);
        assert!(!state.sidecar_ready);
    }
}
