use std::path::Path;
use tauri::fs::Scope;

/// 仅授权当前工作区及其内部元数据，不扩大到用户主目录或整个文件系统。
pub(crate) fn allow_workspace_scope(scope: &Scope, root: &Path) -> tauri::Result<()> {
    scope.allow_directory(root, true)?;

    // tauri-plugin-fs 2.5.1 用 FsScope::default() 创建动态 scope，未传入插件的
    // requireLiteralLeadingDot 配置。因此 Unix 上 root/** 仍不匹配隐藏子目录。
    // 明确授权两个固定的内部目录；不要用全盘通配符，也不要放开其它隐藏目录。
    for directory in [".light", ".light-sync"] {
        scope.allow_directory(root.join(directory), true)?;
    }
    Ok(())
}
