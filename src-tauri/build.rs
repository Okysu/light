fn main() {
    tauri_build::build();

    // Tauri 的应用 manifest 不会自动链接进集成测试。mock runtime 涉及的原生
    // 组件仍依赖 Common Controls v6；没有此项，Windows 测试会在 main 前退出。
    // 只传给测试程序，不改变正式客户端的 manifest。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
