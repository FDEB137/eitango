// 単語帳の画面 #/tangochou（docs/shiyou.md 6章）: 一覧・使う単語帳の切り替え・取り込み・取り込み直し・消す（2段階）。
import { el, button, guardedButton, badge, confirmScreen } from "./parts.js";
import { exportData } from "./kiroku.js";

export async function render(view) {
  const ctx = view.ctx;
  const store = ctx.store;
  const [books, blocks, meta] = await Promise.all([store.listWordbooks(), store.listBlocks(), store.getMeta()]);
  const normals = books.filter((b) => b.kind === "normal");
  const main = [el("h1", "title", "単語帳")];
  const upd = ctx.updateBox && ctx.updateBox();
  if (upd) main.push(upd);
  if (normals.length === 0) main.push(el("p", "lead", "単語帳がありません。CSV を取り込んでください。"));

  for (const book of normals) {
    const nigate = books.find((b) => b.kind === "nigate" && b.sourceId === book.id) || null;
    const ids = new Set([book.id, nigate ? nigate.id : null]);
    const learning = blocks.some((b) => ids.has(b.wordbookId) && b.status === "learning");
    const count = (await store.getWords(book.id)).length;
    const active = meta.activeWordbookId === book.id;

    const head = el("div", "book-head");
    head.append(el("span", "book-name", book.name));
    if (active) head.append(" ", badge("使う", "active"));
    if (learning) head.append(" ", badge("学習中", "learning"));
    const card = el("section", "card section book-card");
    card.append(head, el("p", "line book-count", "語数: " + count + "語" + (nigate ? "・苦手: " + nigate.members.length + "語" : "")));
    if (book.fileName) card.append(el("p", "note book-file", "ファイル: " + book.fileName));
    if (!active) {
      card.append(guardedButton(ctx, "使う単語帳にする", async () => {
        await store.setActiveWordbook(book.id);
        await ctx.refresh();
      }, "btn btn-main btn-block btn-activate"));
    }
    card.append(
      button("取り込み直す", () => ctx.go("#/torikomi/" + encodeURIComponent(book.id)), "btn btn-block btn-reimport"),
      button("消す", () => deleteStep1(view, book, ""), "btn btn-ng btn-block btn-delete"),
    );
    main.push(card);
  }
  view.show(main, [button("単語帳を取り込む", () => ctx.go("#/torikomi"), "btn btn-main btn-new")]);
}

// 消す: 2段階で確かめる（6.4）。1回目に書き出しを勧める。
function deleteStep1(view, book, note) {
  const ctx = view.ctx;
  const lines = [
    "『" + book.name + "』を消します。その語・まとまり・記録・苦手の単語帳もすべて消えます。先に書き出し（バックアップ）をおすすめします",
  ];
  if (note) lines.push(note);
  confirmScreen(view, {
    title: "単語帳を消す",
    lines,
    buttons: [
      { label: "やめる", onClick: () => ctx.refresh() },
      {
        label: "書き出す",
        run: async () => {
          if (await exportData(ctx)) {
            deleteStep1(view, book, "書き出しました");
            return true;
          }
          return false;
        },
      },
      { label: "次へ", cls: "btn btn-ng", onClick: () => deleteStep2(view, book) },
    ],
  });
}

function deleteStep2(view, book) {
  const ctx = view.ctx;
  confirmScreen(view, {
    title: "本当に消しますか",
    lines: ["『" + book.name + "』を消します。"],
    buttons: [
      { label: "やめる", onClick: () => ctx.refresh() },
      {
        label: "消す",
        cls: "btn btn-ng",
        run: async () => {
          await ctx.store.deleteWordbook({ wordbookId: book.id });
          ctx.flash("単語帳を消しました");
          ctx.go("#/tangochou");
        },
      },
    ],
  });
}
