use tauri::Manager;
use tauri::Emitter;
use tauri::tray::{MouseButton, MouseButtonState};
use tauri::menu::MenuEvent;

mod core;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            core::fetch_opencode_go,
            core::fetch_custom_api,
            core::drag_window,
            core::resize_window,
            core::set_focusable,
            core::save_config,
            core::load_config
        ])
        .on_menu_event(|app, event: MenuEvent| {
            match event.id.as_ref() {
                "quit" => app.exit(0),
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show(); let _ = w.set_focus();
                    }
                }
                "hide" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
                "settings" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show(); let _ = w.set_focus();
                        let _ = w.emit("open-settings", ());
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up, ..
            } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show(); let _ = w.set_focus();
                    }
                }
            }
        })
        .setup(|app| {
            let show = tauri::menu::MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let hide = tauri::menu::MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
            let settings = tauri::menu::MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[
                &show, &hide, &settings,
                &tauri::menu::PredefinedMenuItem::separator(app)?,
                &quit,
            ])?;
            tauri::tray::TrayIconBuilder::new()
                .tooltip("LLM Token Monitor")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
