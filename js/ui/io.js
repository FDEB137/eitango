// ブラウザの機能への入り口（ファイルの保存・再読み込み）。画面のテストでは差し替える。
// 外部への通信はしない。

// 書き出しファイルを保存する。共有シート（navigator.canShare({files})）が使えればそれ、使えなければダウンロード。
// 保存の操作を始められたら true、利用者が共有をやめたら false。
export async function saveFile({ text, fileName }) {
  const type = "application/json";
  const nav = globalThis.navigator;
  if (nav && typeof nav.canShare === "function" && typeof nav.share === "function" && typeof File === "function") {
    const file = new File([text], fileName, { type });
    let can = false;
    try {
      can = nav.canShare({ files: [file] });
    } catch (e) {
      can = false;
    }
    if (can) {
      try {
        await nav.share({ files: [file] });
        return true;
      } catch (e) {
        if (e && e.name === "AbortError") return false; // 利用者がやめた
        // ほかの失敗は、ダウンロードに切り替える
      }
    }
  }
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

export function reload() {
  location.reload();
}

export const defaultIo = { saveFile, reload };
