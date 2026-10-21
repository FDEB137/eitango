// 記録の画面 #/kiroku（docs/shiyou.md 8章・9.3・10.1）:
// 進み具合・書き出す・移行前のデータを書き出す・読み込む・アプリの版・データをすべて消す。
import { inspectBackup } from "../core/backup.js";
import { formatMonthDay, studyDay } from "../core/day.js";
import { APP_VERSION } from "../version.js";
import { el, button, guardedButton, alertBox, section, fileButton, confirmScreen, MESSAGES, formatDateTime } from "./parts.js";

// 書き出す。ふつうの状態は 8.1（保存できたら lastExportAt を更新）。
// 移行に失敗した状態は移行前のデータ（9.4。lastExportAt は更新しない）。保存を始められたら true。
export async function exportData(ctx) {
  const store = ctx.store;
  const now = ctx.now();
  if (store.status.state === "migrationFailed") return exportBeforeMigration(ctx);
  const e = await store.exportBackup({ now });
  const saved = await ctx.io.saveFile({ text: e.text, fileName: e.fileName });
  if (saved) await store.markExported({ now });
  return saved;
}

// 移行前のデータを書き出す（9.4。lastExportAt は更新しない）
export async function exportBeforeMigration(ctx) {
  const e = await ctx.store.exportSnapshot({ now: ctx.now() });
  if (!e) throw new Error("移行前のデータはありません");
  return ctx.io.saveFile({ text: e.text, fileName: e.fileName });
}

// 読み込みの前・すべて消す前に勧める書き出し
const exportLabel = (ctx) => (ctx.store.status.state === "migrationFailed" ? "移行前のデータを書き出す" : "書き出す");

export async function render(view) {
  const ctx = view.ctx;
  const store = ctx.store;
  const failed = store.status.state === "migrationFailed";
  const meta = await store.getMeta();
  const main = [el("h1", "title", "記録")];
  const upd = ctx.updateBox && ctx.updateBox();
  if (upd) main.push(upd);

  if (failed) {
    main.push(alertBox(MESSAGES.migrationFailed, "warn"));
  } else {
    const [books, blocks] = await Promise.all([store.listWordbooks(), store.listBlocks()]);
    const kindOf = new Map(books.map((b) => [b.id, b.kind]));
    const done = blocks.filter((b) => b.status === "done");
    const learned = done.filter((b) => kindOf.get(b.wordbookId) === "normal").reduce((n, b) => n + b.nos.length, 0);
    const nigate = books.filter((b) => b.kind === "nigate").reduce((n, b) => n + (b.members ? b.members.length : 0), 0);
    main.push(
      section(
        "進み具合",
        el("p", "line stat-learned", "覚えた語数: " + learned + "語"),
        el("p", "line stat-blocks", "学習済みのまとまり: " + done.length),
        el("p", "line stat-nigate", "苦手の語数: " + nigate + "語"),
      ),
    );
    const last = meta.lastExportAt ? "最後に書き出した日: " + formatMonthDay(studyDay(new Date(meta.lastExportAt))) : "まだ書き出していません";
    main.push(
      section(
        "書き出す",
        el("p", "note", MESSAGES.exportNote),
        el("p", "note export-last", last),
        guardedButton(ctx, "書き出す", () => doExport(ctx, false), "btn btn-main btn-block btn-export"),
      ),
    );
  }

  if (failed || (await store.hasSnapshot())) {
    main.push(
      section(
        "移行前のデータ",
        el("p", "note", "記録の形式を新しくする前のデータです。" + MESSAGES.exportNote),
        guardedButton(ctx, "移行前のデータを書き出す", () => doExport(ctx, true), "btn btn-block btn-export-before"),
      ),
    );
  }

  main.push(
    section(
      "読み込む",
      el("p", "note", "書き出したファイルから、記録をもとに戻します。今の端末のデータはすべて置き換わります。"),
      fileButton("読み込む", (file) => ctx.run(() => pickBackup(view, file)), { accept: ".json,application/json" }),
    ),
  );
  main.push(section("アプリの版", el("p", "line app-version", "版 " + APP_VERSION)));
  main.push(
    section(
      "データをすべて消す",
      el("p", "note", "この端末のデータをすべて消します。元に戻せません。"),
      button("データをすべて消す", () => deleteStep1(view, ""), "btn btn-ng btn-block btn-delete-all"),
    ),
  );
  view.show(main, []);
}

async function doExport(ctx, beforeMigration) {
  const saved = beforeMigration ? await exportBeforeMigration(ctx) : await exportData(ctx);
  if (saved) {
    // 始めた画面がもう出ていなくて、今の画面が別の処理中なら、出し直さない（知らせも出さない。7.7）
    await ctx.refresh("書き出しました");
    return true;
  }
  return false; // 保存しなかった（共有シートを閉じたなど）: 同じ画面に残るので、また押せるようにする
}

// ---- 読み込み（8.2） ----
async function pickBackup(view, file) {
  const ctx = view.ctx;
  const store = ctx.store;
  const text = await file.text();
  const r = inspectBackup(text, { currentVersion: store.config.schemaVersion, table: store.config.migrations });
  if (!r.ok) {
    confirmScreen(view, {
      title: "読み込めません",
      lines: ["このファイルは読み込めません。今のデータは何も変えていません。"],
      nodes: [errorList(r.errors)],
      buttons: [{ label: "戻る", onClick: () => ctx.refresh() }],
    });
    return;
  }
  confirmReplace(view, text, r.summary, "");
}

const IMPORT_FAILED = "読み込めませんでした。今のデータは何も変えていません。";

function errorList(errors) {
  const ul = el("ul", "error-list");
  for (const e of errors) ul.append(el("li", "error-item", e));
  return ul;
}

// 読み込みの失敗（{ok:false}・例外）を出す。始めた確かめの画面がまだ出ていれば、同じ確かめの画面を出し直して
// 見出しのすぐ下に1つの箱で出す（ボタンは新しくなるので押せる）。もう出ていなければ今の画面の見出しの下に出す（7.7）。
function importFailed(view, text, summary, note, items) {
  if (view.alive()) confirmReplace(view, text, summary, note, { message: IMPORT_FAILED, items });
  else view.ctx.fail(new Error(IMPORT_FAILED), items);
}

function confirmReplace(view, text, summary, note, error) {
  const ctx = view.ctx;
  const store = ctx.store;
  const books = el("ul", "summary-list");
  for (const b of summary.wordbooks) {
    books.append(el("li", "summary-book", b.name + "（" + (b.kind === "nigate" ? "苦手・" : "") + b.wordCount + "語）"));
  }
  const lines = [
    "書き出した日時: " + formatDateTime(summary.exportedAt),
    "単語帳: " + summary.wordbooks.length + "冊",
  ];
  const nodes = [books, el("p", "lead", "学習済みのまとまり: " + summary.doneBlocks)];
  nodes.push(alertBox("今の端末のデータはすべて置き換わります。先に今のデータを書き出すことをおすすめします", "warn"));
  if (note) nodes.push(el("p", "note export-done", note));
  confirmScreen(view, {
    title: "このファイルを読み込みますか",
    lines,
    nodes,
    error,
    buttons: [
      { label: "やめる", onClick: () => ctx.refresh() },
      {
        label: exportLabel(ctx),
        run: async () => {
          const saved = await exportData(ctx);
          if (saved) confirmReplace(view, text, summary, "書き出しました");
          return saved ? true : false;
        },
      },
      {
        label: "読み込む",
        cls: "btn btn-main",
        run: async () => {
          let res;
          try {
            res = await store.importBackup(text, ctx.now());
          } catch (e) {
            // 例外も {ok:false} と同じ形（1つの箱に、文と例外の文。8.2・12章）
            importFailed(view, text, summary, note, [e && e.message ? e.message : String(e)]);
            return false;
          }
          if (!res.ok) {
            importFailed(view, text, summary, note, res.errors);
            return false;
          }
          ctx.flash("読み込みました");
          ctx.go("#/");
        },
      },
    ],
  });
}

// ---- データをすべて消す（8.4。2段階） ----
export function deleteStep1(view, note) {
  const ctx = view.ctx;
  const failed = ctx.store.status.state === "migrationFailed";
  const lines = ["この端末のデータをすべて消します。元に戻せません。先に書き出し（バックアップ）をおすすめします"];
  if (failed) lines.push("（書き出されるのは移行前のデータです）");
  if (note) lines.push(note);
  confirmScreen(view, {
    title: "データをすべて消す",
    lines,
    buttons: [
      { label: "やめる", onClick: () => ctx.refresh() },
      {
        label: exportLabel(ctx),
        run: async () => {
          const saved = await exportData(ctx);
          if (saved) deleteStep1(view, "書き出しました");
          return saved ? true : false;
        },
      },
      { label: "次へ", cls: "btn btn-ng", onClick: () => deleteStep2(view) },
    ],
  });
}

export function deleteStep2(view) {
  const ctx = view.ctx;
  confirmScreen(view, {
    title: "本当にすべて消しますか",
    lines: ["単語帳・記録・進行中の復習が、この端末からすべて消えます。"],
    buttons: [
      { label: "やめる", onClick: () => ctx.refresh() },
      {
        label: "すべて消す",
        cls: "btn btn-ng",
        run: async () => {
          await ctx.store.deleteAll();
          ctx.flash("データをすべて消しました");
          ctx.go("#/");
        },
      },
    ],
  });
}
