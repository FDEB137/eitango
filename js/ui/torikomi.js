// 取り込み #/torikomi（新規）・#/torikomi/<単語帳id>（取り込み直し）（docs/shiyou.md 6.1・6.2、docs/csv.md）。
// CSV の点検（エラー・警告）は core/csv.js の parseWordsCsv の結果を表示するだけ。
// 点検の文・ファイル名・単語帳名には CSV の内容が入るので、すべて textContent で入れる。
import { parseWordsCsv, wordbookNameFromFile } from "../core/csv.js";
import { el, button, guardedButton, alertBox, section, fileButton, link } from "./parts.js";

const MAX_LIST = 50; // 長い一覧は先頭だけ出す（残りは件数）

function listOf(items, className) {
  const ul = el("ul", className);
  for (const t of items.slice(0, MAX_LIST)) ul.append(el("li", "list-item", t));
  if (items.length > MAX_LIST) ul.append(el("li", "list-item list-more", "ほか " + (items.length - MAX_LIST) + " 件"));
  return ul;
}

const gapText = (gaps) => gaps.map((g) => (g[0] === g[1] ? String(g[0]) : g[0] + "〜" + g[1])).join("、");

// 点検の結果（エラー・警告）の表示
export function checkReport(r) {
  const nodes = [];
  if (r.errors.length > 0) {
    const box = alertBox("エラーがあるので取り込めません。CSV を直してから、もう一度選んでください", "error");
    box.append(listOf(r.errors.map((e) => (e.line === null || e.line === undefined ? "" : e.line + "行目: ") + e.message), "error-list"));
    nodes.push(box);
  }
  if (r.warnings.length > 0) {
    const box = alertBox("確かめてください（取り込みは続けられます）", "warn");
    box.append(listOf(r.warnings, "warning-list"));
    nodes.push(box);
  }
  return nodes;
}

export async function render(view, wordbookId) {
  const ctx = view.ctx;
  let book = null;
  if (wordbookId) {
    book = await ctx.store.getWordbook(wordbookId);
    if (!book || book.kind !== "normal") {
      view.show([el("h1", "title", "取り込み直し"), alertBox("単語帳が見つかりません", "warn")], [button("単語帳へ", () => ctx.go("#/tangochou"), "btn btn-main")]);
      return;
    }
  }
  showPicker(view, book, []);
}

function showPicker(view, book, report) {
  const ctx = view.ctx;
  const back = () => ctx.go(book ? "#/tangochou" : "#/");
  const main = [el("h1", "title", book ? "取り込み直す" : "単語帳を取り込む")];
  if (book) {
    main.push(el("p", "lead import-target", "単語帳: " + book.name));
    main.push(el("p", "note", "番号で照合します。新しい番号は追加、ある番号は CSV のとおりに直します（間違いの回数・苦手・まとまり・記録はそのまま。CSV に無い語は残します）。"));
  } else {
    main.push(el("p", "note", "CSV ファイルを選びます。作り方は『使い方』の CSV の説明にあります。"));
  }
  main.push(...report);
  main.push(
    fileButton(
      book ? "CSV ファイルを選んで取り込み直す" : "CSV ファイルを選ぶ",
      (file) => ctx.run(() => onFile(view, book, file)),
      { accept: ".csv,text/csv,text/plain" },
    ),
  );
  main.push(link("CSV の作り方", "./help/csv.html", "btn btn-sub btn-block"));
  view.show(main, [button("やめる", back, "btn")]);
}

async function onFile(view, book, file) {
  const ctx = view.ctx;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = parseWordsCsv(bytes);
  if (!r.ok) {
    showPicker(view, book, checkReport(r));
    return;
  }
  if (book) await confirmReimport(view, book, file, r);
  else confirmNew(view, file, r);
}

// ---- 新しく取り込む（6.1） ----
function confirmNew(view, file, r) {
  const ctx = view.ctx;
  const s = r.summary;
  const defaultName = wordbookNameFromFile(file.name);
  const nameInput = el("input", "text-input name-input");
  nameInput.type = "text";
  nameInput.value = defaultName;
  nameInput.maxLength = 100;
  nameInput.setAttribute("aria-label", "単語帳名");
  const nameLabel = el("label", "field");
  nameLabel.append(el("span", "label", "単語帳名"), nameInput);

  const main = [
    el("h1", "title", "取り込みの確認"),
    section(
      "内容",
      el("p", "line import-file", "ファイル: " + file.name),
      el("p", "line import-count", "語数: " + s.count + "語"),
      el("p", "line import-range", "番号の範囲: " + s.minNo + "〜" + s.maxNo),
      el("p", "line import-gaps", "番号の飛び: " + (s.gaps.length ? gapText(s.gaps) : "なし")),
      el("p", "line import-ai", "（AI）の内容がある語: " + s.aiCount + "語"),
      el("p", "line import-check", "要確認の語: " + s.checkCount + "語"),
    ),
    nameLabel,
    ...checkReport(r),
  ];
  view.show(main, [
    button("やめる", () => ctx.refresh(), "btn"),
    guardedButton(
      ctx,
      "取り込む",
      async () => {
        const name = nameInput.value.trim() || defaultName;
        await ctx.store.importNew({ csvWords: r.words, fileName: file.name, name, now: ctx.now() });
        ctx.flash("取り込みました");
        ctx.go("#/");
      },
      "btn btn-main btn-import",
    ),
  ]);
}

// ---- 取り込み直す（6.2） ----
async function confirmReimport(view, book, file, r) {
  const ctx = view.ctx;
  const diff = await ctx.store.previewReimport({ wordbookId: book.id, csvWords: r.words });
  const main = [
    el("h1", "title", "取り込み直しの確認"),
    el("p", "lead import-target", "単語帳: " + book.name),
    section(
      "変わる内容",
      el("p", "line diff-added", "追加: " + diff.added.length + "語"),
      el("p", "line diff-changed", "内容が変わる: " + diff.changed.length + "語"),
      el("p", "line diff-missing", "CSV に無い: " + diff.missing.length + "語（そのまま残します）"),
    ),
  ];
  if (diff.wordChanged.length > 0) {
    main.push(
      section(
        "英単語そのものが変わる語",
        listOf(diff.wordChanged.map((c) => c.no + ": " + c.from + " → " + c.to), "word-changed-list"),
      ),
    );
  }
  main.push(...checkReport(r));
  view.show(main, [
    button("やめる", () => ctx.refresh(), "btn"),
    guardedButton(
      ctx,
      "適用する",
      async () => {
        const d = await ctx.store.reimport({ wordbookId: book.id, csvWords: r.words, fileName: file.name, now: ctx.now() });
        ctx.flash("取り込み直しました（追加 " + d.added.length + "語・変更 " + d.changed.length + "語）");
        ctx.go("#/tangochou");
      },
      "btn btn-main btn-import",
    ),
  ]);
}
