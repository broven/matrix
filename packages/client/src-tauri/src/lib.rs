use tauri::Manager;

#[cfg(target_os = "macos")]
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init());

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

                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("failed to resolve resource dir");
                let web_dir = resource_dir.join("web");

                let shell = app.shell();
                let (mut _rx, child) = shell
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
