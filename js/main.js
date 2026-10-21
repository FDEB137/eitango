// 起動: DB を開く（版の確認・移行は openStore の中）→ 画面の枠とルーターを動かす。
// 最後に Service Worker を登録し、新しい版の知らせを出す（pwa.js。仕様 11章）。
import { openStore } from "./db/store.js";
import { setupPwa } from "./pwa.js";
import { createShell } from "./ui/shell.js";
import { el, alertBox } from "./ui/parts.js";

async function start() {
  const mainEl = document.getElementById("main");
  const barEl = document.getElementById("bar");
  const navEl = document.getElementById("nav");
  let shell = null;
  let store = null;
  try {
    store = await openStore({
      now: new Date(),
      // 別のタブで新しい版が DB を更新したときなど、状態が変わったら画面を出し直す（仕様 9.5）
      onStatusChange: () => {
        if (shell) shell.render();
      },
    });
  } catch (e) {
    mainEl.replaceChildren(
      el("h1", "title", "えいたんご"),
      alertBox("このブラウザではデータを保存できないため、使えません（" + (e && e.message ? e.message : e) + "）", "error"),
    );
    return;
  }
  // 新しい版の知らせ（shell.js の update。pwa.js が available と apply を決める）
  const update = { available: false, apply: () => {} };
  shell = createShell({
    store,
    update,
    mainEl,
    barEl,
    navEl,
    now: () => new Date(),
    rng: Math.random,
    navigate: (hash) => {
      if (location.hash === hash) shell.show(hash);
      else location.hash = hash;
    },
  });
  window.addEventListener("hashchange", () => shell.show(location.hash));
  shell.show(location.hash);
  setupPwa({
    serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : null,
    reload: () => location.reload(),
    update,
    getShell: () => shell,
  });
}

start();
