#[cfg(any(test, debug_assertions))]
mod automation;

#[cfg(any(test, debug_assertions))]
use std::sync::{Arc, RwLock};

#[cfg(any(test, debug_assertions))]
use serde_json::json;

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

                #[cfg(any(test, debug_assertions))]
                {
                    automation::core::layout_hint();
                    automation::runtime::layout_hint();

                    let configured_port = std::env::var("MATRIX_AUTOMATION_PORT")
                        .ok()
                        .and_then(|raw| raw.parse::<u16>().ok())
                        .unwrap_or(18_765);

                    let mut automation_state = automation::state::AutomationState::new(configured_port);
                    automation_state.app_ready = true;
                    automation_state.sidecar_ready = true;
                    automation_state.webview_ready = true;

                    let route_state = Arc::new(RwLock::new(automation::server::RouteState {
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

                    match automation::server::start_loopback_server(
                        automation_state.port,
                        automation_state.token.clone(),
                        route_state,
                        Arc::new(automation::actions::NoopWebviewEvalBackend),
                    ) {
                        Ok(automation_server) => {
                            automation_state.port = automation_server.local_addr().port();
                            match automation_state.write_discovery_file(None) {
                                Ok(path) => {
                                    println!(
                                        "  Automation bridge: {} (discovery: {})",
                                        automation_state.base_url(),
                                        path.display()
                                    );
                                }
                                Err(error) => {
                                    eprintln!("  Automation discovery write failed: {error}");
                                }
                            }
                            app.manage(AutomationServerState(std::sync::Mutex::new(Some(automation_server))));
                        }
                        Err(error) => {
                            eprintln!("  Automation bridge failed to start: {error}");
                        }
                    }
                }

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

#[cfg(all(desktop, any(test, debug_assertions)))]
struct AutomationServerState(std::sync::Mutex<Option<automation::server::AutomationServer>>);
