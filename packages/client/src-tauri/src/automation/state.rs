use serde::Serialize;
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);
const DISCOVERY_FILE_NAME: &str = "automation.json";
const DISCOVERY_TEMP_PREFIX: &str = ".automation.json.tmp";

#[cfg(unix)]
const DISCOVERY_DIR_MODE: u32 = 0o700;
#[cfg(unix)]
const DISCOVERY_FILE_MODE: u32 = 0o600;

#[derive(Debug, Clone)]
pub struct AutomationState {
    pub token: String,
    pub platform: &'static str,
    pub port: u16,
    pub app_ready: bool,
    pub webview_ready: bool,
    pub sidecar_ready: bool,
}

#[derive(Debug, Serialize)]
struct DiscoveryMetadata<'a> {
    enabled: bool,
    platform: &'a str,
    #[serde(rename = "baseUrl")]
    base_url: String,
    token: &'a str,
    pid: u32,
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

    fn discovery_metadata(&self) -> DiscoveryMetadata<'_> {
        DiscoveryMetadata {
            enabled: true,
            platform: self.platform,
            base_url: self.base_url(),
            token: &self.token,
            pid: std::process::id(),
        }
    }

    fn discovery_file_path(directory: &Path) -> PathBuf {
        directory.join(DISCOVERY_FILE_NAME)
    }

    fn default_discovery_directory() -> std::io::Result<PathBuf> {
        if let Some(directory) = env::var_os("MATRIX_AUTOMATION_DISCOVERY_DIR") {
            return Ok(PathBuf::from(directory));
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            let home = env::var_os("HOME").ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "HOME is not set")
            })?;
            return Ok(PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Matrix")
                .join("dev"));
        }

        #[cfg(target_os = "windows")]
        {
            let app_data = env::var_os("APPDATA").ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "APPDATA is not set")
            })?;
            return Ok(PathBuf::from(app_data).join("Matrix").join("dev"));
        }

        #[cfg(all(not(target_os = "macos"), not(target_os = "ios"), not(target_os = "windows")))]
        {
            if let Some(data_home) = env::var_os("XDG_DATA_HOME") {
                return Ok(PathBuf::from(data_home).join("Matrix").join("dev"));
            }
            let home = env::var_os("HOME").ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "HOME is not set")
            })?;
            return Ok(PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("Matrix")
                .join("dev"));
        }
    }

    pub fn write_discovery_file(&self, directory_override: Option<&Path>) -> std::io::Result<PathBuf> {
        let directory = match directory_override {
            Some(path) => path.to_path_buf(),
            None => Self::default_discovery_directory()?,
        };
        fs::create_dir_all(&directory)?;
        set_directory_permissions_if_supported(&directory)?;
        let path = Self::discovery_file_path(&directory);
        let metadata = self.discovery_metadata();
        let json = serde_json::to_vec_pretty(&metadata)
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        write_file_atomic(&path, &json)?;
        Ok(path)
    }
}

fn write_file_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let temp_path = temporary_discovery_path(path);
    write_file_with_restrictive_permissions(&temp_path, contents)?;
    match fs::rename(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn temporary_discovery_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let counter = TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    parent.join(format!("{DISCOVERY_TEMP_PREFIX}-{pid}-{counter}"))
}

fn write_file_with_restrictive_permissions(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(DISCOVERY_FILE_MODE)
            .open(path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        return Ok(());
    }

    #[cfg(not(unix))]
    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        Ok(())
    }
}

fn set_directory_permissions_if_supported(directory: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(DISCOVERY_DIR_MODE))?;
        return Ok(());
    }

    #[cfg(not(unix))]
    {
        let _ = directory;
        Ok(())
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
    use std::env;
    use std::fs;
    use std::sync::{Mutex, OnceLock};
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

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

    #[test]
    fn writes_discovery_file() {
        let state = AutomationState::new(18_765);
        let dir = std::env::temp_dir().join(format!("matrix-automation-{}", std::process::id()));

        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }

        let path = state.write_discovery_file(Some(&dir)).unwrap();
        assert_eq!(path, dir.join("automation.json"));
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("automation.json")
        );
        assert!(path.starts_with(&dir));

        let raw = fs::read_to_string(&path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();

        assert_eq!(json.get("enabled").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(json.get("platform").and_then(|v| v.as_str()), Some(state.platform));
        assert_eq!(json.get("baseUrl").and_then(|v| v.as_str()), Some(state.base_url().as_str()));
        assert_eq!(json.get("token").and_then(|v| v.as_str()), Some(state.token.as_str()));
        assert_eq!(json.get("pid").and_then(|v| v.as_u64()), Some(u64::from(std::process::id())));
        #[cfg(unix)]
        {
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0);
            let dir_mode = fs::metadata(&dir).unwrap().permissions().mode();
            assert_eq!(dir_mode & 0o077, 0);
        }

        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    #[test]
    fn writes_discovery_file_to_default_directory_when_override_is_absent() {
        let _guard = env_lock().lock().unwrap();
        let state = AutomationState::new(18_765);
        let original_home = env::var_os("HOME");
        let original_override = env::var_os("MATRIX_AUTOMATION_DISCOVERY_DIR");
        let home_dir = std::env::temp_dir().join(format!(
            "matrix-automation-home-{}-{}",
            std::process::id(),
            state.token
        ));

        if home_dir.exists() {
            fs::remove_dir_all(&home_dir).unwrap();
        }
        env::remove_var("MATRIX_AUTOMATION_DISCOVERY_DIR");
        env::set_var("HOME", &home_dir);

        let path = state.write_discovery_file(None).unwrap();
        assert_eq!(
            path,
            home_dir
                .join("Library")
                .join("Application Support")
                .join("Matrix")
                .join("dev")
                .join("automation.json")
        );
        assert!(path.exists());

        match original_home {
            Some(value) => env::set_var("HOME", value),
            None => env::remove_var("HOME"),
        }
        match original_override {
            Some(value) => env::set_var("MATRIX_AUTOMATION_DISCOVERY_DIR", value),
            None => env::remove_var("MATRIX_AUTOMATION_DISCOVERY_DIR"),
        }
        fs::remove_dir_all(&home_dir).unwrap();
    }
}
