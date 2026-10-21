// 復習の画面 #/fukushuu（docs/shiyou.md 3章・10.1）: 進行中の復習のテスト・結果。
// 復習の始め方（startReviewFlow）もここに置く（ホームの「復習を始める」と「学習済みのまとまり」から使う）。
import { el, button, confirmScreen } from "./parts.js";
import { renderPlay, renderResult } from "./test.js";

export const KIND_LABEL = { r1: "1日後の復習", r2: "2日後の復習", free: "自由な復習" };

// 進行中の復習を「単語帳名 第N回（種類）」の1行にする
export async function describeSession(store, session) {
  const block = await store.getBlock(session.blockId);
  const book = block ? await store.getWordbook(block.wordbookId) : null;
  const name = book && block ? book.name + " 第" + block.seq + "回" : "不明なまとまり";
  return name + "・" + (KIND_LABEL[session.kind] || "復習");
}

// 復習を始めて復習の画面へ。進行中の復習があるときは、やめてよいかを確かめてから始める（3.3）。
export async function startReviewFlow(view, blockId) {
  const ctx = view.ctx;
  const store = ctx.store;
  const r = await store.startReview({ blockId, rng: ctx.rng, now: ctx.now() });
  if (r.started) {
    ctx.go("#/fukushuu");
    return;
  }
  if (r.reason === "inProgress") {
    const label = await describeSession(store, r.session);
    confirmScreen(view, {
      title: "中断中の復習があります",
      lines: ["中断中の復習（" + label + "）をやめて始めますか（途中の判定は記録されません）"],
      buttons: [
        { label: "やめる", onClick: () => ctx.refresh() },
        {
          label: "やめて始める",
          cls: "btn btn-main",
          run: async () => {
            const r2 = await store.startReview({ blockId, rng: ctx.rng, now: ctx.now(), replace: true });
            if (!r2.started) throw new Error("復習を始められませんでした");
            ctx.go("#/fukushuu");
          },
        },
      ],
    });
    return;
  }
  throw new Error("この復習は始められません");
}

export async function render(view) {
  const ctx = view.ctx;
  const store = ctx.store;
  const home = () => button("ホームへ", () => ctx.go("#/"), "btn btn-main");
  const session = await store.getSession();
  const block = session ? await store.getBlock(session.blockId) : null;
  const book = block ? await store.getWordbook(block.wordbookId) : null;
  if (!session || !block || !book) {
    view.show([el("h1", "title", "復習"), el("p", "lead", "進行中の復習はありません")], [home()]);
    return;
  }
  const words = await store.getWords(book.id);
  const wordMap = new Map(words.map((w) => [w.no, w]));
  const title = KIND_LABEL[session.kind] || "復習";
  const subtitle = book.name + " 第" + block.seq + "回";

  renderPlay(view, {
    title,
    subtitle,
    order: session.order,
    answers: session.answers,
    revealed: session.revealed,
    wordMap,
    onSave: async (state) => {
      const r = await store.saveSession({
        expectedStartedAt: session.startedAt,
        answers: state.answers,
        revealed: state.revealed,
        now: ctx.now(),
      });
      if (!r.applied) throw new Error("別の画面で復習が変わっています。ホームから開き直してください");
    },
    onFinish: async (answers) => {
      const r = await store.confirmReview({ expectedStartedAt: session.startedAt, answers, now: ctx.now() });
      if (!r.applied) {
        ctx.flash("別の画面で復習が変わっていたため、最新の状態を表示します");
        ctx.go("#/");
        return;
      }
      renderResult(view, {
        title,
        answers,
        wordMap,
        counted: r.counted,
        newlyNigate: r.newlyNigate,
        nextLabel: "ホームへ",
        onNext: () => ctx.go("#/"),
      });
    },
  });
}
