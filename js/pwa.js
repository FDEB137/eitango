// Service Worker の登録と更新の知らせ（docs/shiyou.md 11章）。
// navigator.serviceWorker 相当・再読み込みの関数・画面の枠は引数で受け取る（テストで偽物を渡す）。
//   update: shell.js に渡している {available, apply}。同じオブジェクトのまま available を true にし、apply を差し込む。
//   getShell: 画面の枠（{hash, ctx.isBusy(), render()}）を返す関数。今の画面がホームで処理中でなければホームを出し直す。
// 登録の失敗（非対応・file:// など）は無視してアプリは動かす。
export async function setupPwa({ serviceWorker, reload, update, getShell, swUrl = "./sw.js" }) {
  let waiting = null;
  // 「更新する」を押した後の controllerchange だけ再読み込みする（初回の clients.claim・別のタブの更新では再読み込みしない）
  let applying = false;

  // 押していない controllerchange が来た = 待っていた版はもう有効（別のタブで更新された）。押したら再読み込みだけ
  let activated = false;

  update.apply = () => {
    if (activated) {
      reload();
      return;
    }
    if (!waiting) return;
    applying = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  function notify(worker) {
    waiting = worker;
    activated = false;
    update.available = true;
    const shell = typeof getShell === "function" ? getShell() : null;
    if (!shell) return;
    // ホームだけ出し直す。学習・復習・ほかの画面は、次に出したときに出る
    // アプリが古い状態（9.3）の画面は、どの URL でも同じ状態の画面なので、それも出し直す
    const home = /^#?\/?$/.test(shell.hash || "");
    const newer = shell.ctx.store && shell.ctx.store.status && shell.ctx.store.status.state === "newer";
    if ((home || newer) && !shell.ctx.isBusy()) shell.render();
  }

  if (!serviceWorker) return null;
  try {
    serviceWorker.addEventListener("controllerchange", () => {
      if (!applying) {
        // 知らせを出していないとき（初めての登録の clients.claim など）は何もしない
        if (waiting) activated = true;
        return;
      }
      applying = false;
      reload();
    });
    const reg = await serviceWorker.register(swUrl);
    if (reg.waiting) notify(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && serviceWorker.controller) notify(reg.waiting || worker);
      });
    });
    return reg;
  } catch (e) {
    return null;
  }
}
