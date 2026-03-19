#[cfg(any(test, debug_assertions))]
mod automation;

#[cfg(any(test, debug_assertions))]
use std::sync::{Arc, RwLock};

#[cfg(any(test, debug_assertions))]
use serde_json::json;

#[cfg(all(desktop, any(test, debug_assertions)))]
use std::path::{Path, PathBuf};

use tauri::Manager;

#[cfg(target_os = "macos")]
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(desktop, any(test, debug_assertions)))]
    append_automation_startup_log("entered_run");

    let builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        updater::check_update,
        updater::download_update,
        updater::install_update,
    ]);

    let mut app = builder
        .build(tauri::generate_context!())
        .expect("error while building Matrix client");

    #[cfg(desktop)]
    initialize_desktop_runtime(&mut app).expect("error while initializing Matrix client");

    app.run(|_, _| {});
}

#[cfg(desktop)]
#[allow(dead_code)]
struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg(all(desktop, any(test, debug_assertions)))]
#[allow(dead_code)]
struct AutomationServerState(std::sync::Mutex<Option<automation::server::AutomationServer>>);

#[cfg(all(desktop, any(test, debug_assertions)))]
fn append_automation_startup_log(message: &str) {
    let _ = append_automation_startup_log_impl(message);
}

#[cfg(all(desktop, any(test, debug_assertions)))]
fn append_automation_startup_log_impl(message: &str) -> std::io::Result<()> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;

    let discovery_path = automation_debug_log_path()?;
    if let Some(parent) = discovery_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temp_path = std::env::temp_dir().join("matrix-automation-startup.log");
    for path in [discovery_path, temp_path] {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{message}");
            let _ = file.flush();
        }
    }
    Ok(())
}

#[cfg(all(desktop, any(test, debug_assertions)))]
fn automation_debug_log_path() -> std::io::Result<PathBuf> {
    if let Some(directory) = std::env::var_os("MATRIX_AUTOMATION_DISCOVERY_DIR") {
        return Ok(PathBuf::from(directory).join("automation-startup.log"));
    }

    let home = std::env::var_os("HOME")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME is not set"))?;
    Ok(Path::new(&home)
        .join("Library")
        .join("Application Support")
        .join("Matrix")
        .join("dev")
        .join("automation-startup.log"))
}

#[cfg(desktop)]
fn initialize_desktop_runtime(
    app: &mut tauri::App<tauri::Wry>,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(any(test, debug_assertions))]
    append_automation_startup_log("entered_desktop_setup");

    use tauri_plugin_shell::ShellExt;

    let resource_dir = app.path().resource_dir()?;
    let web_dir = resource_dir.join("web");

    let shell = app.shell();
    let (mut _rx, child) = shell
        .sidecar("matrix-server")?
        .args([
            "--port",
            "19880",
            "--local",
            "true",
            "--web",
            &web_dir.to_string_lossy(),
        ])
        .spawn()?;

    app.manage(SidecarState(std::sync::Mutex::new(Some(child))));

    #[cfg(any(test, debug_assertions))]
    initialize_automation_runtime(app);

    let app_handle = app.handle().clone();
    std::thread::spawn(move || {
        use std::net::TcpStream;
        use std::time::Duration;

        for _ in 0..120 {
            if let Some(main_window) = app_handle.get_webview_window("main") {
                if TcpStream::connect_timeout(
                    &"127.0.0.1:19880".parse().unwrap(),
                    Duration::from_millis(200),
                )
                .is_ok()
                {
                    std::thread::sleep(Duration::from_millis(300));
                    let _ = main_window.eval("window.location.replace('http://127.0.0.1:19880')");
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });

    Ok(())
}

#[cfg(all(desktop, any(test, debug_assertions)))]
struct TauriWindowFacade(tauri::AppHandle);

#[cfg(all(desktop, any(test, debug_assertions)))]
impl automation::runtime::desktop::DesktopWindowFacade for TauriWindowFacade {
    fn focus(&self) -> Result<serde_json::Value, automation::core::errors::AutomationErrorCode> {
        if let Some(window) = self.0.get_webview_window("main") {
            let _ = window.set_focus();
            Ok(json!({"focused": true}))
        } else {
            Err(automation::core::errors::AutomationErrorCode::NativeUnavailable)
        }
    }

    fn reload(&self) -> Result<serde_json::Value, automation::core::errors::AutomationErrorCode> {
        if let Some(window) = self.0.get_webview_window("main") {
            let _ = window.eval("window.location.reload()");
            Ok(json!({"reloaded": true}))
        } else {
            Err(automation::core::errors::AutomationErrorCode::NativeUnavailable)
        }
    }

    fn state(&self) -> serde_json::Value {
        if let Some(window) = self.0.get_webview_window("main") {
            let focused = window.is_focused().unwrap_or(false);
            let visible = window.is_visible().unwrap_or(false);
            json!({"label": "main", "focused": focused, "visible": visible})
        } else {
            json!({"label": "main", "focused": false, "visible": false})
        }
    }
}

#[cfg(all(desktop, any(test, debug_assertions)))]
#[allow(dead_code)]
struct TauriSidecarFacade(tauri::AppHandle);

#[cfg(all(desktop, any(test, debug_assertions)))]
impl automation::runtime::desktop::DesktopSidecarFacade for TauriSidecarFacade {
    fn status(&self) -> Result<serde_json::Value, automation::core::errors::AutomationErrorCode> {
        use std::net::TcpStream;
        use std::time::Duration;
        let running = TcpStream::connect_timeout(
            &"127.0.0.1:19880".parse().unwrap(),
            Duration::from_millis(200),
        )
        .is_ok();
        Ok(json!({"running": running, "port": 19880}))
    }

    fn restart(&self) -> Result<serde_json::Value, automation::core::errors::AutomationErrorCode> {
        Err(automation::core::errors::AutomationErrorCode::UnsupportedAction)
    }

    fn state(&self) -> serde_json::Value {
        self.status().unwrap_or_else(|_| json!({"running": false, "port": 19880}))
    }
}

#[cfg(all(desktop, any(test, debug_assertions)))]
fn initialize_automation_runtime(app: &mut tauri::App<tauri::Wry>) {
    append_automation_startup_log("entered_automation_setup");
    let configured_port = std::env::var("MATRIX_AUTOMATION_PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(18_765);
    append_automation_startup_log(&format!("configured_port={configured_port}"));

    let mut automation_state = automation::state::AutomationState::new(configured_port);
    automation_state.app_ready = true;
    automation_state.sidecar_ready = true;
    automation_state.webview_ready = true;

    let route_state = Arc::new(RwLock::new(automation::runtime::router::RouteStateSnapshot {
        platform: automation_state.platform.to_string(),
        app_ready: automation_state.app_ready,
        webview_ready: automation_state.webview_ready,
        sidecar_ready: automation_state.sidecar_ready,
        window: json!({
            "label": "main",
            "focused": true,
            "visible": true
        }),
        webview: json!({
            "url": "http://127.0.0.1:19880"
        }),
        sidecar: json!({
            "running": true,
            "port": 19880
        }),
    }));

    let webview_bridge = automation::runtime::webview::DesktopWebviewBridge::new(
        automation::runtime::webview::TauriEventBridgeTransport::new(app.handle().clone()),
    );

    let app_handle_for_facades = app.handle().clone();
    let desktop_adapter = automation::runtime::desktop::DesktopAutomationAdapter::new(
        TauriWindowFacade(app_handle_for_facades.clone()),
        TauriSidecarFacade(app_handle_for_facades),
    );

    let composite_backend = automation::runtime::composite::DesktopRuntimeBackend::new(
        webview_bridge,
        desktop_adapter,
        route_state.clone(),
    );

    match automation::server::start_loopback_server(
        automation_state.port,
        automation_state.token.clone(),
        route_state,
        Arc::new(composite_backend),
    ) {
        Ok(automation_server) => {
            automation_state.port = automation_server.local_addr().port();
            append_automation_startup_log(&format!(
                "loopback_server_started port={}",
                automation_state.port
            ));
            match automation_state.write_discovery_file(None) {
                Ok(path) => {
                    append_automation_startup_log(&format!(
                        "discovery_written path={}",
                        path.display()
                    ));
                    println!(
                        "  Automation bridge: {} (discovery: {})",
                        automation_state.base_url(),
                        path.display()
                    );
                }
                Err(error) => {
                    append_automation_startup_log(&format!("discovery_write_failed error={error}"));
                    eprintln!("  Automation discovery write failed: {error}");
                }
            }
            app.manage(AutomationServerState(std::sync::Mutex::new(Some(
                automation_server,
            ))));
        }
        Err(error) => {
            append_automation_startup_log(&format!("loopback_server_failed error={error}"));
            eprintln!("  Automation bridge failed to start: {error}");
        }
    }
}
