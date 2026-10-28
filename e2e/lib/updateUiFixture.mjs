// Test-only compiled-renderer fixture. Real Tauri invoke is deliberately read-only.
export function installUpdaterFixture(win = window) {
  const original = win.fetch.bind(win);
  const calls = [], handle = "a".repeat(64);
  win.__qaUpdateFixture = { calls, handle };
  win.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw);
    const command = decodeURIComponent(url.pathname).replace(/^\//, "");
    if (url.hostname !== "ipc.localhost" || !["fetch_latest_release", "prepare_signed_update", "download_signed_update", "cancel_signed_update", "install_signed_update"].includes(command)) {
      return original(input, init);
    }
    const args = JSON.parse(init?.body ?? "{}");
    calls.push({ command, args });
    let reply = null;
    if (command === "fetch_latest_release") reply = { tag_name: "v1.3.2", html_url: "https://github.com/OneTrueAsian/vault-spend/releases/tag/v1.3.2", assets: [] };
    if (command === "prepare_signed_update") reply = { handle, version: "1.3.2", size: 12345 };
    if (command === "download_signed_update") {
      if (args.handle !== handle) throw Error("Unexpected fixture token");
      reply = handle;
    }
    if (command === "install_signed_update" && args.token !== handle) throw Error("Unexpected fixture token");
    return new win.Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } });
  };
}
