use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_shell::ShellExt;

                let shell = app.shell();
                let (mut _rx, child) = shell
                    .sidecar("matrix-server")
                    .expect("failed to create sidecar command")
                    .args(["--port", "19880", "--local", "true"])
                    .spawn()
                    .expect("failed to spawn matrix-server sidecar");

                // Store the child process so it lives as long as the app
                app.manage(SidecarState(std::sync::Mutex::new(Some(child))));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Matrix client");

    app.run(|app, event| {
        #[cfg(desktop)]
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app.try_state::<SidecarState>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}

#[cfg(desktop)]
struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);
