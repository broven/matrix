use tauri::Manager;

#[cfg(target_os = "macos")]
mod updater;

#[cfg(target_os = "macos")]
mod screenshot_impl {
    use base64::Engine;
    use core_foundation::array::CFArray;
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionaryRef;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::display::CGWindowListCopyWindowInfo;
    use core_graphics::window::{
        kCGWindowListOptionOnScreenOnly, kCGWindowNumber, kCGWindowOwnerPID,
    };
    use std::process;

    fn find_window_id(our_pid: i64) -> Option<u32> {
        let window_list = unsafe {
            CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, 0)
        };
        if window_list.is_null() {
            return None;
        }
        let windows: CFArray = unsafe { CFArray::wrap_under_create_rule(window_list as _) };

        let pid_key: CFString =
            unsafe { TCFType::wrap_under_get_rule(kCGWindowOwnerPID as *const _) };
        let wid_key: CFString =
            unsafe { TCFType::wrap_under_get_rule(kCGWindowNumber as *const _) };

        for i in 0..windows.len() {
            let Some(item) = windows.get(i) else {
                continue;
            };
            let dict_ref: CFDictionaryRef = unsafe { std::mem::transmute(item) };
            let dict: core_foundation::dictionary::CFDictionary =
                unsafe { TCFType::wrap_under_get_rule(dict_ref) };

            if let Some(pid_val) = dict.find(pid_key.as_CFTypeRef()) {
                let pid_num: CFNumber = unsafe { TCFType::wrap_under_get_rule(*pid_val as _) };
                if let Some(pid) = pid_num.to_i64() {
                    if pid == our_pid {
                        if let Some(wid_val) = dict.find(wid_key.as_CFTypeRef()) {
                            let wid_num: CFNumber =
                                unsafe { TCFType::wrap_under_get_rule(*wid_val as _) };
                            if let Some(wid) = wid_num.to_i32() {
                                return Some(wid as u32);
                            }
                        }
                    }
                }
            }
        }
        None
    }

    fn capture_via_screencapture(window_id: u32) -> Result<String, String> {
        let tmp_path = format!("/tmp/matrix-screenshot-{}.png", process::id());

        let status = process::Command::new("screencapture")
            .args(["-l", &window_id.to_string(), "-o", "-x", &tmp_path])
            .status();

        match status {
            Ok(s) if s.success() => {}
            Ok(s) => return Err(format!("screencapture exited with code {:?}", s.code())),
            Err(e) => return Err(format!("screencapture failed: {e}")),
        }

        let png_bytes =
            std::fs::read(&tmp_path).map_err(|e| format!("failed to read screenshot file: {e}"))?;
        let _ = std::fs::remove_file(&tmp_path);

        Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
    }

    pub fn capture() -> Result<String, String> {
        let our_pid = process::id() as i64;
        let window_id = find_window_id(our_pid)
            .ok_or_else(|| "could not find Matrix window; refusing full-screen capture".to_string())?;
        capture_via_screencapture(Some(window_id))
    }
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn screenshot() -> Result<String, String> {
    screenshot_impl::capture()
}

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
        get_sidecar_port,
        mock_file_dialog,
        consume_mock_file_dialog,
        screenshot,
    ]);

    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_sidecar_port,
        mock_file_dialog,
        consume_mock_file_dialog,
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
    let sidecar_port = resolve_sidecar_port();

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
