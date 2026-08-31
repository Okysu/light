#[path = "../src/workspace_scope.rs"]
mod workspace_scope;

use tauri::fs::Scope;
use workspace_scope::allow_workspace_scope;

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::config::FsScope;

    // 显式使用 Unix 匹配规则，使 Windows 上的测试也能复现 Linux 的隐藏目录问题。
    fn unix_scope() -> Scope {
        Scope::new(
            &tauri::test::mock_app(),
            &FsScope::Scope {
                allow: vec![],
                deny: vec![],
                require_literal_leading_dot: Some(true),
            },
        )
        .unwrap()
    }

    fn root() -> std::path::PathBuf {
        std::env::temp_dir()
            .join("light-workspace-scope-tests")
            .join("文档/Light [1]")
    }

    #[test]
    fn recursive_grant_alone_does_not_cover_unix_metadata() {
        let scope = unix_scope();
        let root = root();
        scope.allow_directory(&root, true).unwrap();
        assert!(scope.is_allowed(root.join("note.md")));
        assert!(!scope.is_allowed(root.join(".light")));
        assert!(!scope.is_allowed(root.join(".light/properties.json")));
        assert!(!scope.is_allowed(root.join(".light-sync/staging/chunk")));
    }

    #[test]
    fn grants_metadata_and_staging_before_they_exist() {
        let scope = unix_scope();
        let root = root();
        allow_workspace_scope(&scope, &root).unwrap();
        for path in [
            "",
            "note.md",
            "项目/笔记.md",
            "attachments/image.png",
            ".light",
            ".light/properties.json",
            ".light/history/v1/note/index.json",
            ".light/extensions/demo/settings.json",
            ".light/trash/archive/note.md",
            ".light-sync",
            ".light-sync/staging/chunk",
        ] {
            assert!(scope.is_allowed(root.join(path)), "path denied: {path}");
        }
    }

    #[test]
    fn hidden_workspace_root_can_have_its_own_metadata() {
        let scope = unix_scope();
        let root = root().join(".vault");
        allow_workspace_scope(&scope, &root).unwrap();
        assert!(scope.is_allowed(&root));
        assert!(scope.is_allowed(root.join(".light/workspace.json")));
        assert!(scope.is_allowed(root.join(".light-sync/staging/chunk")));
    }

    #[test]
    fn grant_does_not_escape_the_selected_workspace() {
        let scope = unix_scope();
        let root = root();
        allow_workspace_scope(&scope, &root).unwrap();
        assert!(!scope.is_allowed(root.parent().unwrap()));
        assert!(!scope.is_allowed(root.with_file_name("Light 1").join(".light/workspace.json")));
        assert!(!scope.is_allowed(root.with_file_name("other").join("note.md")));
        assert!(!scope.is_allowed(root.join(".ssh/id_rsa")));
    }

    #[test]
    fn explicit_denials_still_take_precedence() {
        let scope = unix_scope();
        let root = root();
        scope
            .forbid_directory(root.join(".light/private"), true)
            .unwrap();
        allow_workspace_scope(&scope, &root).unwrap();
        assert!(!scope.is_allowed(root.join(".light/private/secret")));
        assert!(scope.is_allowed(root.join(".light/properties.json")));
    }
}
