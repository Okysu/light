use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

mod workspace_scope;
use workspace_scope::allow_workspace_scope;

/// 速记窗口的 label。前端靠 `?window=capture` 判断自己该渲染哪一套界面。
const CAPTURE_LABEL: &str = "capture";
const MAIN_LABEL: &str = "main";

/// 主进程要求前端立即落盘。窗口隐藏与退出前都会发一次——
/// 前端的自动保存是防抖的，直接退出会吞掉最后几百毫秒的编辑。
const EVENT_FLUSH: &str = "light://flush";

/// 托盘菜单项句柄。菜单由 Rust 主进程持有，不会随 Vue 语言切换自动重建，
/// 因此保留句柄让前端通过命令原地更新文案。
struct TrayMenuItems {
    show: MenuItem<tauri::Wry>,
    capture: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

struct TrayLabels {
    show: &'static str,
    capture: String,
    quit: &'static str,
}

fn tray_labels(locale: &str) -> TrayLabels {
    let shortcut = if cfg!(target_os = "macos") {
        "⌘⇧Space"
    } else {
        "Ctrl+Shift+Space"
    };

    if locale == "en-US" {
        TrayLabels {
            show: "Show Light",
            capture: format!("Quick Capture  {shortcut}"),
            quit: "Quit Light",
        }
    } else {
        TrayLabels {
            show: "显示主窗口",
            capture: format!("速记  {shortcut}"),
            quit: "退出 Light",
        }
    }
}

#[tauri::command]
fn set_tray_locale(locale: String, items: tauri::State<'_, TrayMenuItems>) -> Result<(), String> {
    let labels = tray_labels(&locale);
    items
        .show
        .set_text(labels.show)
        .map_err(|error| error.to_string())?;
    items
        .capture
        .set_text(labels.capture)
        .map_err(|error| error.to_string())?;
    items
        .quit
        .set_text(labels.quit)
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 把用户选定的工作区目录加入文件系统作用域。
///
/// Tauri 2 的 fs 插件默认只允许 capabilities 里预先声明的路径。工作区目录由用户
/// 在运行时通过对话框选定，编译期无从声明，因此必须在这里动态放行——
/// 否则 `TauriFsAdapter` 的每一次读写都会被作用域拒绝。
///
/// 只放行用户明确选中的那一个目录（递归包含子目录），不做更大范围的授权。
#[tauri::command]
fn allow_workspace(app: AppHandle, path: String) -> Result<(), String> {
    allow_workspace_scope(&app.fs_scope(), std::path::Path::new(&path))
        .map_err(|error| format!("无法授权目录 {path}：{error}"))?;

    Ok(())
}

use tauri_plugin_fs::FsExt;

/// 准备数据目录：放行 + 建好。
///
/// 顺序不能反——`create_dir_all` 走的是 Rust 侧的 std::fs 不受作用域约束，
/// 但**之后前端对它的每一次读写**都要作用域放行，因此两件事在这里一起做完，
/// 免得出现「目录建好了却读不了」这种只在客户端出现、还很难归因的状态。
#[tauri::command]
fn prepare_data_dir(app: AppHandle, path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|error| format!("无法创建目录 {path}：{error}"))?;

    allow_workspace_scope(&app.fs_scope(), std::path::Path::new(&path))
        .map_err(|error| format!("无法授权目录 {path}：{error}"))?;

    Ok(())
}

/// 导入结果，回给前端做提示。
#[derive(serde::Serialize)]
struct ImportOutcome {
    imported: u32,
    skipped: u32,
}

/// 把一个外部文件或目录复制进数据目录（导入）。
///
/// 复制放在 Rust 侧而不是前端逐个文件读写，有两个理由，第二个才是关键：
/// 1. 导入一个几百篇的文件夹，逐个走 IPC 会慢一个数量级；
/// 2. **前端始终不需要拿到源目录的读权限**。走前端就得先 `allow_directory`
///    用户随手选的那个外部目录，那是为了一次性的导入换来一份长期授权。
///
/// 避让与跳过隐藏项的规则须与 `core/workspace/import-service.ts` 保持一致——
/// 同一个功能在两端表现不同，比慢更让人无法信任。
#[tauri::command]
async fn import_path(
    app: AppHandle,
    source: String,
    target: String,
) -> Result<ImportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = std::path::Path::new(&source);
        let target_path = std::path::Path::new(&target);

        // 目标要先放行，否则前端随后刷新文件树时读不到刚导入的内容
        allow_workspace_scope(&app.fs_scope(), target_path)
            .map_err(|error| format!("无法授权目录：{error}"))?;

        std::fs::create_dir_all(target_path).map_err(|error| format!("无法创建目录：{error}"))?;

        let name = source_path
            .file_name()
            .ok_or_else(|| "无法识别导入项的名称".to_string())?;

        if source_path.is_file() {
            if is_hidden(name) {
                return Ok(ImportOutcome {
                    imported: 0,
                    skipped: 1,
                });
            }
            let destination = unique_path(target_path, name);
            std::fs::copy(source_path, destination)
                .map_err(|error| format!("复制失败：{error}"))?;
            return Ok(ImportOutcome {
                imported: 1,
                skipped: 0,
            });
        }

        // 目录同名时合并而不是避让：用户把 `项目/` 导到已有的 `项目/` 旁边，
        // 期待的是内容汇合，不是多出一个 `项目 (2)`
        let mut outcome = ImportOutcome {
            imported: 0,
            skipped: 0,
        };
        copy_dir(source_path, &target_path.join(name), &mut outcome)
            .map_err(|error| format!("复制失败：{error}"))?;
        Ok(outcome)
    })
    .await
    .map_err(|error| format!("导入任务异常：{error}"))?
}

/// 递归复制目录，跳过隐藏项，文件同名时避让。
///
/// 单个文件失败只计入 skipped：导入几百个文件时，因为其中一个权限不对
/// 就整批回滚，比少一个文件糟得多。
fn copy_dir(
    source: &std::path::Path,
    target: &std::path::Path,
    outcome: &mut ImportOutcome,
) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();

        if is_hidden(&name) {
            outcome.skipped += 1;
            continue;
        }

        if entry.file_type()?.is_dir() {
            let _ = copy_dir(&entry.path(), &target.join(&name), outcome);
        } else if std::fs::copy(entry.path(), unique_path(target, &name)).is_ok() {
            outcome.imported += 1;
        } else {
            outcome.skipped += 1;
        }
    }

    Ok(())
}

/// `名称.md`、`名称 (2).md`、`名称 (3).md` …——与 TS 侧 `uniquePath` 同一套规则
fn unique_path(dir: &std::path::Path, name: &std::ffi::OsStr) -> std::path::PathBuf {
    let direct = dir.join(name);
    if !direct.exists() {
        return direct;
    }

    let name = std::path::Path::new(name);
    let stem = name
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = name
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();

    for index in 2..1000 {
        let candidate = dir.join(format!("{stem} ({index}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    // 同名超过千个只能落回覆盖前的那个名字；这已经不是正常使用场景
    direct
}

/// 路径段以 `.` 开头即视为隐藏。从 Obsidian 库导入会带上 `.obsidian/`、`.git/`，
/// 那些是别的工具的内部状态，搬过来只会污染文件树。
fn is_hidden(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('.')
}

/// 把导出结果写到用户在保存对话框里选定的路径。
///
/// 不走 `tauri-plugin-fs` 的 writeFile：那条路要求目标落在 fs 作用域内，
/// 而导出的去处是用户临时挑的任意位置，为它放行一个目录属于过度授权。
/// 这里只写用户明确指定的**那一个文件**，范围最小。
///
/// 用 spawn_blocking：整库压缩包可能有几十 MB，同步写会把命令线程卡住。
#[tauri::command]
async fn write_export(path: String, contents: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&path, contents).map_err(|error| format!("写入 {path} 失败：{error}"))
    })
    .await
    .map_err(|error| format!("写入任务异常：{error}"))?
}

/// 显示并聚焦主窗口（可能此前被「关闭」隐藏到了托盘）
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 唤起 / 收起速记窗口。
///
/// 首次调用才真正创建窗口，之后只做显示与隐藏：速记要求「按下快捷键立刻能写」，
/// 每次重建 webview 会有几百毫秒白屏，那就不叫速记了。
fn toggle_capture(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(CAPTURE_LABEL) {
        if window.is_visible().unwrap_or(false) {
            window.hide()?;
        } else {
            window.show()?;
            window.set_focus()?;
        }
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        CAPTURE_LABEL,
        WebviewUrl::App("index.html?window=capture".into()),
    )
    .title("速记")
    .inner_size(560.0, 220.0)
    .resizable(false)
    // 无边框 + 置顶 + 不进任务栏：是浮在当前工作之上的胶囊，不是第二个应用窗口
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .center()
    .build()?;

    Ok(())
}

/// 退出前留出落盘时间。
///
/// `flush` 在前端是异步的，`exit` 会直接结束进程，两者竞争必然丢数据。
/// 放到独立线程里等待，避免阻塞主线程——主线程一停，webview 就收不到事件，
/// 那这段等待反而什么也保不住。
fn quit_after_flush(app: &AppHandle) {
    let _ = app.emit(EVENT_FLUSH, ());

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        handle.exit(0);
    });
}

/// 启动自检：确认动态放行确实改变了 fs 作用域的判定结果。
///
/// 这是整个桌面端最容易悄悄失效的一环——作用域拒绝时报的是「forbidden path」，
/// 与「文件不存在」几乎无从分辨。放在启动日志里，一眼就能看出授权链路是否还通。
#[cfg(debug_assertions)]
fn selftest_scope(app: &AppHandle) {
    let probe = std::env::temp_dir().join("light-scope-selftest");
    if std::fs::create_dir_all(&probe).is_err() {
        return;
    }

    let scope = app.fs_scope();
    let before = scope.is_allowed(&probe);
    let granted = allow_workspace_scope(&scope, &probe).is_ok();
    let after = scope.is_allowed(&probe);
    let metadata = scope.is_allowed(probe.join(".light/workspace.json"));
    let staging = scope.is_allowed(probe.join(".light-sync/staging/probe"));

    log::info!("fs 作用域自检：授权前 allowed={before}，授权 ok={granted}，授权后 allowed={after}，metadata={metadata}，staging={staging}");
    let _ = std::fs::remove_dir_all(&probe);
}

/// 托盘：常驻入口。有了它，主窗口关闭后进程仍在，全局快捷键才继续有效。
fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let labels = tray_labels("zh-CN");
    let show = MenuItem::with_id(app, "show", labels.show, true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", labels.capture, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &capture, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Light")
        .menu(&menu)
        // 左键留给「点一下打开主窗口」这个通行习惯，菜单走右键
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "capture" => {
                let _ = toggle_capture(app);
            }
            "quit" => quit_after_flush(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayMenuItems {
        show,
        capture,
        quit,
    });

    Ok(())
}

/// 全局快捷键 Ctrl/Cmd+Shift+Space 唤起速记胶囊。
#[cfg(desktop)]
fn install_global_shortcut(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
    let capture = Shortcut::new(Some(modifiers), Code::Space);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                // 只认按下，不然一次敲击会触发两遍（按下 + 抬起）
                if event.state == ShortcutState::Pressed && shortcut == &capture {
                    let _ = toggle_capture(app);
                }
            })
            .build(),
    )?;

    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    // 快捷键被别的软件占用时不该拖垮启动，记一条日志继续跑
    if let Err(error) = app.global_shortcut().register(capture) {
        log::warn!("全局快捷键 Ctrl+Shift+Space 注册失败：{error}");
    }

    Ok(())
}

/// 窗口关闭键的语义：主窗口收起到托盘，速记窗口收起等待下次唤起。
/// 两者都不销毁 webview——真正的退出只有托盘菜单那一个入口。
fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    api.prevent_close();

    if window.label() == MAIN_LABEL {
        let _ = window.emit(EVENT_FLUSH, ());
    }
    let _ = window.hide();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 必须最先注册：第二个进程在 setup（托盘创建）前退出，才不会出现多个托盘图标。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            allow_workspace,
            write_export,
            prepare_data_dir,
            import_path,
            set_tray_locale
        ])
        .on_window_event(|window, event| on_window_event(window, event))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(debug_assertions)]
            selftest_scope(app.handle());

            install_tray(app.handle())?;

            #[cfg(desktop)]
            install_global_shortcut(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::tray_labels;

    #[test]
    fn tray_labels_follow_locale() {
        let zh = tray_labels("zh-CN");
        assert_eq!(zh.show, "显示主窗口");
        assert!(zh.capture.starts_with("速记"));
        assert_eq!(zh.quit, "退出 Light");

        let en = tray_labels("en-US");
        assert_eq!(en.show, "Show Light");
        assert!(en.capture.starts_with("Quick Capture"));
        assert_eq!(en.quit, "Quit Light");
    }

    #[test]
    fn unknown_locale_falls_back_to_chinese() {
        assert_eq!(tray_labels("unknown").show, "显示主窗口");
    }
}
