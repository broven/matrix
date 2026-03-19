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

/// Resolve sidecar port: in dev mode read SIDECAR_PORT env var, fallback to 19880.
/// In release mode always returns 19880.
#[cfg(desktop)]
fn resolve_sidecar_port() -> u16 {
    #[cfg(any(test, debug_assertions))]
    {
        if let Ok(port_str) = std::env::var("SIDECAR_PORT") {
            if let Ok(port) = port_str.parse::<u16>() {
                return port;
            }
        }
    }
    19880
}

#[cfg(desktop)]
struct SidecarPortState(u16);

#[tauri::command]
#[cfg(desktop)]
fn get_sidecar_port(state: tauri::State<SidecarPortState>) -> u16 {
    state.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(desktop, any(test, debug_assertions)))]
    append_automation_startup_log("entered_run");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        updater::check_update,
        updater::download_update,
        updater::install_update,
        get_sidecar_port,
    ]);

    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.invoke_handler(tauri::generate_handler![get_sidecar_port,]);

    #[cfg(desktop)]
    let builder = builder.setup(|app| {
        initialize_desktop_runtime(app)?;
        Ok(())
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while building Matrix client")
        .run(|_, _| {});
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
    let sidecar_port = resolve_sidecar_port();

    #[cfg(any(test, debug_assertions))]
    append_automation_startup_log(&format!("entered_desktop_setup sidecar_port={sidecar_port}"));

    let skip_sidecar = std::env::var("SKIP_SIDECAR")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if skip_sidecar {
        eprintln!("[matrix-client] SKIP_SIDECAR=true, skipping sidecar spawn (using external dev server on port {sidecar_port})");
        app.manage(SidecarState(std::sync::Mutex::new(None)));
        app.manage(SidecarPortState(sidecar_port));
    } else {
        let port_str = sidecar_port.to_string();

        // Kill any orphaned sidecar processes from previous launches
        // that may still hold the sidecar port
        if let Ok(output) = std::process::Command::new("lsof")
            .args(["-ti", &format!("tcp:{sidecar_port}")])
            .output()
        {
            let pids = String::from_utf8_lossy(&output.stdout);
            for pid_str in pids.split_whitespace() {
                if pid_str.trim().is_empty() {
                    continue;
                }
                eprintln!(
                    "[matrix-client] killing orphaned process on port {}: pid {}",
                    sidecar_port, pid_str
                );
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", pid_str.trim()])
                    .output();
            }
            if !pids.trim().is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }

        use tauri_plugin_shell::ShellExt;

        let resource_dir = app.path().resource_dir()?;
        let web_dir = resource_dir.join("web");

        let shell = app.shell();
        let (mut rx, child) = shell
            .sidecar("matrix-server")?
            .args([
                "--port",
                &port_str,
                "--local",
                "true",
                "--web",
                &web_dir.to_string_lossy(),
            ])
            .spawn()?;

        app.manage(SidecarState(std::sync::Mutex::new(Some(child))));
        app.manage(SidecarPortState(sidecar_port));

        // Log sidecar output for debugging
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        eprintln!("[matrix-server] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Stderr(line) => {
                        eprintln!("[matrix-server:err] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!(
                            "[matrix-server] terminated code={:?} signal={:?}",
                            payload.code, payload.signal
                        );
                        break;
                    }
                    _ => {}
                }
            }
        });
    }

    #[cfg(any(test, debug_assertions))]
    initialize_automation_runtime(app, sidecar_port);

    let main_window = app.get_webview_window("main").unwrap();

    // Dev mode: set window title and inject dev banner
    #[cfg(any(test, debug_assertions))]
    {
        let worktree_name = get_worktree_name();
        set_dev_window_title(&main_window, &worktree_name, sidecar_port);
        inject_dev_banner(&main_window, &worktree_name, sidecar_port);
    }

    // In release mode, redirect webview to sidecar URL (which serves embedded frontend).
    // In dev mode, webview stays on Vite dev server and connects to sidecar via invoke/fetch.
    #[cfg(not(any(test, debug_assertions)))]
    std::thread::spawn(move || {
        use std::net::TcpStream;
        use std::time::Duration;

        let addr = format!("127.0.0.1:{sidecar_port}");
        for _ in 0..60 {
            if TcpStream::connect_timeout(
                &addr.parse().unwrap(),
                Duration::from_millis(200),
            )
            .is_ok()
            {
                std::thread::sleep(Duration::from_millis(300));
                let _ = main_window.eval(&format!(
                    "window.location.replace('http://127.0.0.1:{sidecar_port}')"
                ));
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });

    Ok(())
}

/// Get worktree name from git toplevel directory.
#[cfg(all(desktop, any(test, debug_assertions)))]
fn get_worktree_name() -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
                std::path::Path::new(&path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "dev".to_string())
}

/// Set window title to "Matrix [DEV - <worktree-name> :<port>]" in dev mode.
#[cfg(all(desktop, any(test, debug_assertions)))]
fn set_dev_window_title(window: &tauri::WebviewWindow, worktree_name: &str, port: u16) {
    let title = format!("Matrix [DEV - {worktree_name} :{port}]");
    let _ = window.set_title(&title);
}

/// Inject a dev banner into the webview.
#[cfg(all(desktop, any(test, debug_assertions)))]
fn inject_dev_banner(window: &tauri::WebviewWindow, worktree_name: &str, port: u16) {
    let js = format!(
        r#"(function() {{
  if (document.getElementById('__matrix_dev_banner')) return;
  var b = document.createElement('div');
  b.id = '__matrix_dev_banner';
  b.textContent = 'DEV — {worktree_name} :{port}';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#e67e22;color:#fff;text-align:center;font:bold 11px system-ui;padding:2px 0;pointer-events:none;opacity:0.9;';
  document.body.prepend(b);
  document.body.style.paddingTop = '20px';
}})()"#
    );
    let w = window.clone();
    std::thread::spawn(move || {
        // Wait for webview content to load
        std::thread::sleep(std::time::Duration::from_secs(3));
        let _ = w.eval(&js);
    });
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
struct TauriSidecarFacade {
    handle: tauri::AppHandle,
    port: u16,
}

#[cfg(all(desktop, any(test, debug_assertions)))]
impl automation::runtime::desktop::DesktopSidecarFacade for TauriSidecarFacade {
    fn status(&self) -> Result<serde_json::Value, automation::core::errors::AutomationErrorCode> {
        use std::net::TcpStream;
        use std::time::Duration;
        let addr = format!("127.0.0.1:{}", self.port);
        let running = TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(200),
        )
        .is_ok();
        Ok(json!({"running": running, "port": self.port}))
    }

    fn restart(&self) -> Result<serde_json::Value, automation::core::errors::AutomationErrorCode> {
        Err(automation::core::errors::AutomationErrorCode::UnsupportedAction)
    }

    fn state(&self) -> serde_json::Value {
        self.status()
            .unwrap_or_else(|_| json!({"running": false, "port": self.port}))
    }
}

#[cfg(all(desktop, any(test, debug_assertions)))]
fn initialize_automation_runtime(app: &mut tauri::App<tauri::Wry>, sidecar_port: u16) {
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
            "url": format!("http://127.0.0.1:{sidecar_port}")
        }),
        sidecar: json!({
            "running": true,
            "port": sidecar_port
        }),
    }));

    let webview_bridge = automation::runtime::webview::DesktopWebviewBridge::new(
        automation::runtime::webview::TauriEventBridgeTransport::new(app.handle().clone()),
    );

    let app_handle_for_facades = app.handle().clone();
    let desktop_adapter = automation::runtime::desktop::DesktopAutomationAdapter::new(
        TauriWindowFacade(app_handle_for_facades.clone()),
        TauriSidecarFacade {
            handle: app_handle_for_facades,
            port: sidecar_port,
        },
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
