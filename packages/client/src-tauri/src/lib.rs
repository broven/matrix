use tauri::Manager;

#[cfg(target_os = "macos")]
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    }

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        updater::check_update,
        updater::download_update,
        updater::install_update,
    ]);

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_shell::ShellExt;

                // Kill any orphaned sidecar processes from previous launches
                // that may still hold port 19880
                if let Ok(output) = std::process::Command::new("lsof")
                    .args(["-ti", "tcp:19880"])
                    .output()
                {
                    let pids = String::from_utf8_lossy(&output.stdout);
                    for pid_str in pids.split_whitespace() {
                        if pid_str.trim().is_empty() {
                            continue;
                        }
                        eprintln!(
                            "[matrix-client] killing orphaned process on port 19880: pid {}",
                            pid_str
                        );
                        let _ = std::process::Command::new("kill")
                            .args(["-TERM", pid_str.trim()])
                            .output();
                    }
                    // Brief wait for processes to exit
                    if !pids.trim().is_empty() {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }
                }

                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("failed to resolve resource dir");
                let web_dir = resource_dir.join("web");

                let shell = app.shell();
                let (mut rx, child) = shell
                    .sidecar("matrix-server")
                    .expect("failed to create sidecar command")
                    .args([
                        "--port",
                        "19880",
                        "--local",
                        "true",
                        "--web",
                        &web_dir.to_string_lossy(),
                    ])
                    .spawn()
                    .expect("failed to spawn matrix-server sidecar");

                app.manage(SidecarState(std::sync::Mutex::new(Some(child))));

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

                // Inject a redirect script into the webview to navigate to sidecar URL
                let main_window = app.get_webview_window("main").unwrap();
                std::thread::spawn(move || {
                    use std::net::TcpStream;
                    use std::time::Duration;

                    for _ in 0..60 {
                        if TcpStream::connect_timeout(
                            &"127.0.0.1:19880".parse().unwrap(),
                            Duration::from_millis(200),
                        )
                        .is_ok()
                        {
                            std::thread::sleep(Duration::from_millis(300));
                            let _ = main_window.eval(
                                "window.location.replace('http://127.0.0.1:19880')",
                            );
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(250));
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Matrix client");
}

#[cfg(desktop)]
struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);
