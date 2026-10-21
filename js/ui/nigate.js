// 苦手の一覧 #/nigate/<元の単語帳id>（docs/shiyou.md 5章）: 英単語・意味・間違いの回数・苦手になった日。
import { formatMonthDay } from "../core/day.js";
import { el, button } from "./parts.js";

export async function render(view, sourceId) {
  const ctx = view.ctx;
  const books = await ctx.store.listWordbooks();
  const nigate = books.find((b) => b.kind === "nigate" && b.sourceId === sourceId) || null;
  const back = button("ホームへ", () => ctx.go("#/"), "btn");
  if (!nigate) {
    view.show([el("h1", "title", "苦手の一覧"), el("p", "lead", "苦手の語はまだありません")], [back]);
    return;
  }
  const words = await ctx.store.getWords(nigate.id);
  const main = [el("h1", "title", nigate.name), el("p", "note nigate-count", "苦手の語: " + words.length + "語")];
  for (const w of words) {
    const card = el("article", "card nigate-item");
    card.append(el("div", "word-head"));
    card.firstChild.append(el("span", "word-no", String(w.no)), el("span", "word-en", w.word));
    card.append(el("p", "line nigate-meaning", w.meaning));
    card.append(
      el("p", "note nigate-info", "間違いの回数: " + (w.miss || 0) + "回・苦手になった日: " + (w.nigateDay ? formatMonthDay(w.nigateDay) : "—")),
    );
    main.push(card);
  }
  view.show(main, [back]);
}
