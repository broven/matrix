use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

#[cfg(target_os = "macos")]
mod updater;

#[cfg(desktop)]
mod screenshot_impl {
    use base64::Engine;
    use std::io::Cursor;
    use xcap::Window;

    pub fn capture() -> Result<String, String> {
        let our_pid = std::process::id();
        let windows = Window::all().map_err(|e| format!("failed to list windows: {e}"))?;

        let window = windows
            .into_iter()
            .find(|w| {
                w.pid().map_or(false, |pid| pid == our_pid)
                    && !w.is_minimized().unwrap_or(true)
            })
            .ok_or_else(|| {
                "could not find Matrix window; refusing full-screen capture".to_string()
            })?;

        let image = window
            .capture_image()
            .map_err(|e| format!("capture_image failed: {e}"))?;

        let mut png_bytes: Vec<u8> = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
            .map_err(|e| format!("PNG encode failed: {e}"))?;

        Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
    }
}

#[tauri::command]
#[cfg(desktop)]
fn screenshot() -> Result<String, String> {
    screenshot_impl::capture()
}

/// Resolve sidecar URL: in dev mode read SIDECAR_URL env var (portless proxy URL),
/// fallback to http://127.0.0.1:19880. In release mode always returns http://127.0.0.1:19880.
#[cfg(desktop)]
fn resolve_sidecar_url() -> String {
    #[cfg(any(test, debug_assertions))]
    {
        if let Ok(url) = std::env::var("SIDECAR_URL") {
            return url.trim_end_matches('/').to_string();
        }
        if let Ok(port_str) = std::env::var("SIDECAR_PORT") {
            if let Ok(port) = port_str.parse::<u16>() {
                return format!("http://127.0.0.1:{port}");
            }
        }
    }
    "http://127.0.0.1:19880".to_string()
}

/// Extract port from a sidecar URL for TCP-level operations (health checks, orphan killing).
/// Returns None for URLs where we can't determine the port (e.g. portless proxy).
#[cfg(desktop)]
fn extract_port_from_url(url: &str) -> Option<u16> {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.port())
}

#[cfg(desktop)]
struct SidecarUrlState(String);

#[tauri::command]
#[cfg(desktop)]
fn get_sidecar_url(state: tauri::State<SidecarUrlState>) -> String {
    state.0.clone()
}

/// Mock file dialog state — tests use this to simulate file picker responses.
struct MockFileDialogState(std::sync::Mutex<Option<String>>);

#[tauri::command]
fn mock_file_dialog(
    state: tauri::State<MockFileDialogState>,
    path: String,
) {
    *state.0.lock().unwrap() = Some(path);
}

#[tauri::command]
fn consume_mock_file_dialog(
    state: tauri::State<MockFileDialogState>,
) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .max_file_size(10_000_000) // 10MB per file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(MockFileDialogState(std::sync::Mutex::new(None)));

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        updater::check_update,
        updater::download_update,
        updater::install_update,
        get_sidecar_url,
        mock_file_dialog,
        consume_mock_file_dialog,
        screenshot,
    ]);

    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_sidecar_url,
        mock_file_dialog,
        consume_mock_file_dialog,
        screenshot,
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        mock_file_dialog,
        consume_mock_file_dialog,
    ]);

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

#[cfg(desktop)]
fn initialize_desktop_runtime(
    app: &mut tauri::App<tauri::Wry>,
) -> Result<(), Box<dyn std::error::Error>> {
    let sidecar_url = resolve_sidecar_url();

    let skip_sidecar = std::env::var("SKIP_SIDECAR")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if skip_sidecar {
        log::info!("SKIP_SIDECAR=true, skipping sidecar spawn (using external server at {sidecar_url})");
        app.manage(SidecarState(std::sync::Mutex::new(None)));
        app.manage(SidecarUrlState(sidecar_url.clone()));
    } else {
        // In release mode, sidecar always runs on port 19880
        let sidecar_port: u16 = extract_port_from_url(&sidecar_url).unwrap_or(19880);
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
                log::warn!("killing orphaned process on port {}: pid {}", sidecar_port, pid_str);
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
        app.manage(SidecarUrlState(sidecar_url.clone()));

        // Log sidecar output for debugging
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let text = String::from_utf8_lossy(&line);
                        // Forward full JSON line to preserve structured context fields
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                            match parsed.get("level").and_then(|v| v.as_u64()) {
                                Some(10) => log::trace!(target: "sidecar", "{}", text),
                                Some(20) => log::debug!(target: "sidecar", "{}", text),
                                Some(30) => log::info!(target: "sidecar", "{}", text),
                                Some(40) => log::warn!(target: "sidecar", "{}", text),
                                Some(50) | Some(60) => log::error!(target: "sidecar", "{}", text),
                                _ => log::info!(target: "sidecar", "{}", text),
                            }
                        } else {
                            log::info!(target: "sidecar", "{}", text);
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        log::warn!(target: "sidecar", "{}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Terminated(payload) => {
                        log::info!(target: "sidecar", "terminated code={:?} signal={:?}", payload.code, payload.signal);
                        break;
                    }
                    _ => {}
                }
            }
        });
    }

    let main_window = app.get_webview_window("main").unwrap();

    // Dev mode: set window title and inject dev banner
    #[cfg(any(test, debug_assertions))]
    {
        let worktree_name = get_worktree_name();
        set_dev_window_title(&main_window, &worktree_name, &sidecar_url);
        inject_dev_banner(&main_window, &worktree_name, &sidecar_url);
    }

    // In release mode, redirect webview to sidecar URL (which serves embedded frontend).
    // In dev mode, webview stays on Vite dev server and connects to sidecar via invoke/fetch.
    #[cfg(not(any(test, debug_assertions)))]
    {
        let redirect_url = sidecar_url.clone();
        if let Some(port) = extract_port_from_url(&sidecar_url) {
            std::thread::spawn(move || {
                use std::net::TcpStream;
                use std::time::Duration;

                let addr = format!("127.0.0.1:{port}");
                for _ in 0..60 {
                    if TcpStream::connect_timeout(
                        &addr.parse().unwrap(),
                        Duration::from_millis(200),
                    )
                    .is_ok()
                    {
                        std::thread::sleep(Duration::from_millis(300));
                        let _ = main_window.eval(&format!(
                            "window.location.replace('{redirect_url}')"
                        ));
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
            });
        }
    }

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

/// Set window title to "Matrix [DEV - <worktree-name> <url>]" in dev mode.
#[cfg(all(desktop, any(test, debug_assertions)))]
fn set_dev_window_title(window: &tauri::WebviewWindow, worktree_name: &str, sidecar_url: &str) {
    let title = format!("Matrix [DEV - {worktree_name} {sidecar_url}]");
    let _ = window.set_title(&title);
}

/// Inject a dev banner into the webview.
#[cfg(all(desktop, any(test, debug_assertions)))]
fn inject_dev_banner(window: &tauri::WebviewWindow, worktree_name: &str, sidecar_url: &str) {
    let js = format!(
        r#"(function() {{
  if (document.getElementById('__matrix_dev_banner')) return;
  var b = document.createElement('div');
  b.id = '__matrix_dev_banner';
  b.textContent = 'DEV — {worktree_name} {sidecar_url}';
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
