use std::{env, fs, path::Path};
fn main() {
    let root = Path::new("../dist-mobile")
        .canonicalize()
        .expect("Build production mobile assets first: npm run mobile:build");
    println!("cargo:rerun-if-changed=../dist-mobile");
    let mut files = Vec::new();
    for directory in ["mobile", "assets"] {
        for file in fs::read_dir(root.join(directory)).expect("Production mobile assets are incomplete") {
            let file = file.unwrap();
            assert!(file.file_type().unwrap().is_file(), "Unexpected mobile asset directory");
            let name = file.file_name().to_string_lossy().to_string();
            let accepted = if directory == "mobile" {
                matches!(
                    name.as_str(),
                    "index.html" | "sw.js" | "manifest.webmanifest" | "icon-192.png" | "icon-512.png"
                )
            } else {
                name.ends_with(".js") || name.ends_with(".css") || name.ends_with(".woff") || name.ends_with(".woff2")
            };
            assert!(accepted, "Unexpected production mobile asset: {name}");
            let content_type = match Path::new(&name).extension().and_then(|e| e.to_str()).unwrap() {
                "html" => "text/html; charset=utf-8",
                "js" => "text/javascript; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "woff" => "font/woff",
                "woff2" => "font/woff2",
                "png" => "image/png",
                "webmanifest" => "application/manifest+json",
                _ => unreachable!(),
            };
            files.push(format!(
                "Asset {{ path: {:?}, content: include_bytes!({:?}), content_type: {:?} }}",
                format!("/{directory}/{name}"),
                file.path(),
                content_type
            ));
        }
    }
    assert!(
        root.join("mobile/index.html").is_file() && root.join("mobile/sw.js").is_file(),
        "Missing production viewer/worker"
    );
    files.sort();
    fs::write(
        Path::new(&env::var("OUT_DIR").unwrap()).join("mobile_assets.rs"),
        format!("pub static MOBILE_ASSETS: &[Asset] = &[{}];", files.join(",\n")),
    )
    .unwrap();
    tauri_build::build()
}
