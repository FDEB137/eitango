// 画面の共通部品（docs/shiyou.md 2.4・12章）。
// 利用者のデータ（CSV のセル・単語帳名・ファイル名・エラーの文）は textContent / Node.append(文字列) で入れる。
// innerHTML・insertAdjacentHTML は使わない（docs/jissou.md 1章）。

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

// 子を足す。文字列は文字として（テキストノードで）入る。null・undefined は無視する。
export function append(parent, ...children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, ...c);
    else parent.append(c);
  }
  return parent;
}

export function badge(text, kind) {
  return el("span", "badge badge-" + kind, text);
}

// ボタン。bar の中では flex で並ぶ。main の中では block を足して横いっぱいにする。
export function button(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// 書き込みをするボタン（連打の防止）。押したら処理が終わるまで押せず、処理中の二重実行もしない。
// 成功して画面が移るときは、次の画面が出るまで押せないままにする（終わった直後の2回目を防ぐ）。
// 失敗したとき（例外は画面に出す）と、fn が false を返したとき（同じ画面に残る。共有シートを閉じた、など）だけ押せる状態に戻す。
// 押した瞬間に画面全体を処理中にする（ctx.begin。仕様 7.7 版5）: ほかのボタン・ナビも押せない。
// 押せる状態に戻すのは、処理の前に押せたものだけ（画面が替わっていれば、新しい画面の印は触らない）。
export function guardedButton(ctx, label, fn, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", async () => {
    const h = ctx.begin(b);
    if (!h) return;
    let release = false;
    try {
      release = (await fn()) === false;
    } catch (e) {
      ctx.fail(e);
      release = true;
    }
    if (release) h.end();
  });
  return b;
}

export function link(label, href, className = "btn") {
  const a = el("a", className, label);
  a.href = href;
  return a;
}

// 知らせの箱。kind: info・warn・error
export function alertBox(text, kind = "info") {
  const d = el("div", "alert alert-" + kind);
  if (kind === "error") d.setAttribute("role", "alert");
  if (Array.isArray(text)) {
    for (const t of text) d.append(el("p", "alert-line", t));
  } else {
    d.append(el("p", "alert-line", text));
  }
  return d;
}

// エラーの箱（12章「エラーの出し方」）。文と、理由の一覧（任意）を1つの箱にする。
export function errorBox(message, items) {
  const box = alertBox(message, "error");
  if (items && items.length > 0) {
    const ul = el("ul", "error-list");
    for (const t of items) ul.append(el("li", "error-item", t));
    box.append(ul);
  }
  return box;
}

export function section(title, ...children) {
  const s = el("section", "card section");
  if (title) s.append(el("h2", "section-title", title));
  append(s, ...children);
  return s;
}

// アプリの状態の知らせ（docs/shiyou.md 9.3）
export const MESSAGES = {
  newer: "新しい版のアプリで使っていたデータです。アプリを更新してください",
  closed: "アプリが更新されました。再読み込みしてください",
  migrationFailed:
    "記録の形式の移行に失敗しました。今のデータはそのまま残っています。アプリが直ったら（更新したら）開き直すと、移行をやり直します。念のため『記録』画面で移行前のデータを書き出してください",
  exportNote: "このファイルには単語帳の内容が入っています。人に渡したり、公開したりしないでください",
};

export const HELP_HREF = "./help/tsukaikata.html";

const pad2 =(n) => String(n).padStart(2, "0");

// ISO の日時を「2026年10月21日 21:05」にする（読めない値は「不明」）
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (typeof iso !== "string" || Number.isNaN(d.getTime())) return "不明";
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

// 番号の並びの範囲の表示（例 1〜40）。空なら ""。
export function rangeLabel(nos) {
  if (!nos || nos.length === 0) return "";
  let min = nos[0];
  let max = nos[0];
  for (const n of nos) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return min === max ? String(min) : min + "〜" + max;
}

// ---- 単語カード（2.4） ----
// 番号・英単語・品詞・意味・類語・対義語・同語源（CSV の列は「同じ語源の単語」）・語句・備考（語句・備考は覚える画面だけ。full）。
// （AI）の列は同じ項目の後ろに「AI」の印をつけて出す。要確認のメモがあれば「要確認」の印とメモ。空の項目は出さない。
// front: true のときは英単語だけ（テストの問題の表示。2.5）。
const ROWS = [
  ["meaning", "意味", null],
  ["syn", "類語", "synAi"],
  ["ant", "対義語", "antAi"],
  ["ety", "同語源","etyAi"],
];

const text = (v) => (v === undefined || v === null ? "" : String(v));

// full: true のときだけ、語句・備考の行を出す（覚える画面だけ。2.4）。AI の印は付けない。
export function wordCard(w, { front = false, full = false } = {}) {
  const card = el("article", front ? "card word-card word-front" : "card word-card");
  const head = el("div", "word-head");
  if (!front) head.append(el("span", "word-no", text(w.no)));
  head.append(el("span", front ? "word-en word-en-big" : "word-en", text(w.word)));
  if (!front && text(w.pos) !== "") head.append(el("span", "word-pos", text(w.pos)));
  card.append(head);
  if (front) return card;

  for (const [key, label, aiKey] of ROWS) {
    const book = text(w[key]);
    const ai = aiKey ? text(w[aiKey]) : "";
    if (book === "" && ai === "") continue;
    const row = el("div", "row");
    row.dataset.key = key;
    row.append(el("span", "label", label));
    const value = el("span", "value");
    if (book !== "") value.append(el("span", "book-text", book));
    if (ai !== "") {
      const part = el("span", "ai-part");
      part.append(badge("AI", "ai"), el("span", "ai-text", ai));
      value.append(part);
    }
    row.append(value);
    card.append(row);
  }
  if (full) {
    for (const [key, label] of [["expr", "語句"], ["note", "備考"]]) {
      const v = text(w[key]);
      if (v === "") continue;
      const row = el("div", "row row-" + key);
      row.dataset.key = key;
      row.append(el("span", "label", label));
      const value = el("span", "value");
      value.append(el("span", "book-text", v));
      row.append(value);
      card.append(row);
    }
  }
  if (text(w.check) !== "") {
    const row = el("div", "row row-check");
    row.dataset.key = "check";
    row.append(badge("要確認", "check"), el("span", "value check-text", text(w.check)));
    card.append(row);
  }
  return card;
}

// 語の一覧（覚える画面・結果の×の語）。words は記録の配列。
export function wordCards(words, opts) {
  const box = el("div", "word-list");
  for (const w of words) box.append(wordCard(w, opts));
  return box;
}

// 語の番号の配列を記録の配列にする。記録が無い番号は番号だけのカードにする（表示が崩れないように）。
export function wordsByNos(nos, wordMap) {
  return nos.map((no) => wordMap.get(no) || { no, word: "（番号 " + no + " の語が見つかりません）" });
}

// ファイルを選ぶボタン（label の中に input を置く。スマホでも確実に選べる）。
// onFile(File) を呼ぶ。選び直せるように、選んだ後に input を空に戻す。
export function fileButton(label, onFile, { accept = "", className = "btn btn-main btn-block" } = {}) {
  const wrap = el("label", className + " file-btn");
  wrap.append(el("span", "file-label", label));
  const input = el("input", "file-input");
  input.type = "file";
  if (accept) input.accept = accept;
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (!f) return;
    Promise.resolve(onFile(f)).finally(() => {
      try {
        input.value = "";
      } catch (e) {
        // 空に戻せない環境は、そのまま
      }
    });
  });
  wrap.append(input);
  return wrap;
}

// 確かめの画面（view.show で出す）。buttons: [{label, onClick, cls}]（左から並ぶ）
// onClick の代わりに run を渡すと、書き込みのボタン（連打を防ぎ、例外は画面に出す。guardedButton）になる。
// error: {message, items} を渡すと、見出しのすぐ下にエラーの箱を1つ出す（要約より前）。
export function confirmScreen(view, { title, lines = [], nodes = [], buttons, error = null }) {
  const main = [el("h1", "title", title)];
  if (error) main.push(errorBox(error.message, error.items));
  for (const l of lines) main.push(el("p", "lead", l));
  main.push(...nodes);
  const bar = buttons.map((b) => (b.run ? guardedButton(view.ctx, b.label, b.run, b.cls || "btn") : button(b.label, b.onClick, b.cls || "btn")));
  view.show(main, bar);
}
