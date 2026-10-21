// 学習済みのまとまり #/matomari（docs/shiyou.md 3.4）: 自由な復習の選択。
import { formatMonthDay } from "../core/day.js";
import { orderWordbooks, scheduleLabel } from "../core/review.js";
import { el, button, guardedButton, section, rangeLabel } from "./parts.js";
import { startReviewFlow } from "./fukushuu.js";

export async function render(view) {
  const ctx = view.ctx;
  const store = ctx.store;
  const [books, blocks] = await Promise.all([store.listWordbooks(), store.listBlocks()]);
  const rank = new Map(orderWordbooks(books).map((b, i) => [b.id, i]));
  const byId = new Map(books.map((b) => [b.id, b]));
  const done = blocks
    .filter((b) => b.status === "done" && byId.has(b.wordbookId))
    .sort((a, b) => rank.get(a.wordbookId) - rank.get(b.wordbookId) || a.seq - b.seq);

  const main = [el("h1", "title", "学習済みのまとまり")];
  if (done.length === 0) {
    main.push(el("p", "lead", "学習済みのまとまりはまだありません"));
  } else {
    main.push(el("p", "note", "選んだまとまりを、全語のテストで復習します。"));
  }
  for (const b of done) {
    const book = byId.get(b.wordbookId);
    const last = b.lastTest ? formatMonthDay(b.lastTest.day) + "　○ " + b.lastTest.ok + "／" + b.lastTest.total + "語" : "まだありません";
    const card = section(
      book.name + " 第" + b.seq + "回",
      el("p", "line block-range", "番号 " + rangeLabel(b.nos) + "・" + b.nos.length + "語"),
      el("p", "line block-studied", "学習した日: " + (b.studiedDay ? formatMonthDay(b.studiedDay) : "—")),
      el("p", "line block-last", "最後のテスト: " + last),
      el("p", "line block-schedule", "予定の復習: " + scheduleLabel(b)),
      guardedButton(ctx, "テスト", () => startReviewFlow(view, b.id), "btn btn-main btn-block btn-start-review"),
    );
    main.push(card);
  }
  view.show(main, [button("ホームへ", () => ctx.go("#/"), "btn")]);
}
