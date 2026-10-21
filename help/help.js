// 説明ページ（csv.html）のひな形 CSV のダウンロードだけ。外部への通信はしない。
// ひな形は Blob で作る（app/ に CSV ファイルは置かない）。中身は docs/csv.md の列と、作った例の3行だけ。

// docs/csv.md 1章の11列（この順）
export const TEMPLATE_HEADER = [
  "番号",
  "英単語",
  "品詞",
  "意味",
  "類語",
  "対義語",
  "同じ語源の単語",
  "類語（AI）",
  "対義語（AI）",
  "同じ語源の単語（AI）",
  "要確認",
];

// docs/csv.md 2章の例（説明のために作った例。どの単語帳の内容でもない）
export const TEMPLATE_ROWS = [
  ["1", "record", "動・名", "〔動〕を記録する／〔名〕記録", "", "", "", "register（を登録する）", "", "recorder（記録係）", ""],
  ["2", "brave", "形", "勇敢な", "", "cowardly（臆病な）", "", "courageous（勇気のある）", "", "", ""],
  ["3", "example", "名", "例", "", "", "", "instance（例） / sample（見本）", "", "exemplify（を例示する）", "意味の2つ目が不確か"],
];

export const TEMPLATE_FILE_NAME = "tangochou-hinagata.csv";

function cell(s) {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ひな形の文字列（先頭に BOM。改行は CRLF）。Excel で開いても文字化けしないように BOM をつける。
export function templateText() {
  const lines = [TEMPLATE_HEADER, ...TEMPLATE_ROWS].map((row) => row.map(cell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

// 共有シート（使えれば）かダウンロードで保存する（js/ui/io.js の saveFile と同じやり方）。
async function save(text, fileName) {
  const type = "text/csv";
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
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // 利用者がやめた
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
}

// ボタンは JS が動いたときだけ出す
export function setup(doc) {
  const btn = doc && doc.getElementById("dl-template");
  if (!btn) return;
  btn.hidden = false;
  btn.addEventListener("click", () => {
    save(templateText(), TEMPLATE_FILE_NAME);
  });
}

if (typeof document !== "undefined") setup(document);
