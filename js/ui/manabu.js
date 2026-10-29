// 学習の画面 #/manabu/<単語帳id>（docs/shiyou.md 2.4〜2.6・10.5）: 覚える・テスト・結果・完了。
import { NIGATE_THRESHOLD } from "../core/constants.js";
import { startTest, stepName } from "../core/flow.js";
import { formatDayJa } from "../core/day.js";
import { el, button, guardedButton, wordCards, wordsByNos, alertBox, confirmScreen } from "./parts.js";
import { renderPlay, renderResult } from "./test.js";

// このまとまりの学習で新たに苦手になった語の数（完了画面）。
// 学習の工程のテスト（results の kind が "step"）で×になった回数を引くと、その学習の前から苦手だった語が分かる。
export function countNewNigate({ words, results, block }) {
  const missInBlock = new Map();
  for (const r of results) {
    if (r.blockId !== block.id || r.kind !== "step") continue;
    for (const [no, ok] of r.items) if (ok === 0) missInBlock.set(no, (missInBlock.get(no) || 0) + 1);
  }
  const inBlock = new Set(block.nos);
  return words.filter((w) => {
    if (!inBlock.has(w.no)) return false;
    const miss = w.miss || 0;
    return miss >= NIGATE_THRESHOLD && miss - (missInBlock.get(w.no) || 0) < NIGATE_THRESHOLD;
  }).length;
}

export async function render(view, wordbookId) {
  const ctx = view.ctx;
  const store = ctx.store;
  const book = wordbookId ? await store.getWordbook(wordbookId) : null;
  const home = () => button("ホームへ", () => ctx.go("#/"), "btn btn-main");
  if (!book) {
    view.show([el("h1", "title", "学習"), alertBox("単語帳が見つかりません", "warn")], [home()]);
    return;
  }
  const blocks = await store.listBlocks(book.id);
  const block = blocks.find((b) => b.status === "learning");
  if (!block) {
    view.show([el("h1", "title", book.name), el("p", "lead", "学習中のまとまりはありません")], [home()]);
    return;
  }
  const words = await store.getWords(book.id);
  const wordMap = new Map(words.map((w) => [w.no, w]));
  const i = block.stepIndex;
  const step = block.steps[i];
  const where = book.name + " 第" + block.seq + "回・工程 " + (i + 1) + " / " + block.steps.length;

  const restart = button(
    "最初からやり直す",
    () =>
      confirmScreen(view, {
        title: "最初からやり直しますか",
        lines: ["工程1に戻り、テストの途中の判定を捨てます。すでに確定した間違いの回数・苦手は取り消されません。"],
        buttons: [
          { label: "やめる", onClick: () => ctx.refresh() },
          {
            label: "やり直す",
            cls: "btn btn-main",
            run: async () => {
              await store.restartBlock({ blockId: block.id });
              await ctx.refresh();
            },
          },
        ],
      }),
    "btn btn-sub btn-restart",
  );

  // ---- 覚える（2.4） ----
  if (step.type === "learn") {
    const top = el("div", "top-row");
    top.append(button("中断", () => ctx.go("#/"), "btn btn-sub btn-pause"), restart);
    const main = [top, el("h1", "title", "覚える"), el("p", "note", where), wordCards(wordsByNos(step.nos, wordMap), { full: true })];
    const next = guardedButton(
      ctx,
      "テストへ",
      async () => {
        await store.finishLearnStep({ blockId: block.id, expectedStepIndex: i });
        await ctx.refresh();
      },
      "btn btn-main btn-next",
    );
    view.show(main, [next]);
    return;
  }

  // ---- テスト（2.5） ----
  let st = block.stepState;
  if (!st) {
    st = startTest(step.nos); // 並び（番号の順）はここで決めて保存する（再開しても同じ）
    await store.saveStepState({ blockId: block.id, expectedStepIndex: i, stepState: st });
  }
  const title = stepName(step);

  const onFinish = async (answers) => {
    const r = await store.confirmStepTest({ blockId: block.id, expectedStepIndex: i, answers, now: ctx.now() });
    if (!r.applied) {
      ctx.flash("別の画面で先に進んでいたため、最新の状態を表示します");
      await ctx.refresh();
      return;
    }
    const fresh = await store.getWords(book.id);
    const freshMap = new Map(fresh.map((w) => [w.no, w]));
    renderResult(view, {
      title,
      answers,
      wordMap: freshMap,
      counted: r.counted,
      newlyNigate: r.newlyNigate,
      // 最後の工程の結果画面にも、完了画面と同じ要点を1行出す（「中断」でホームへ戻っても分かるように。10.5）
      doneNote: r.blockDone ? "第" + r.block.seq + "回（" + r.block.nos.length + "語）が終わりました。1日後の復習は" + formatDayJa(r.block.reviews.r1.due) + "です" : "",
      onNext: async () => {
        if (r.blockDone) await showDone(view, book, r.block);
        else await ctx.refresh();
      },
    });
  };

  renderPlay(view, {
    title,
    subtitle: where,
    order: st.order,
    answers: st.answers,
    revealed: st.revealed,
    wordMap,
    topButtons: [restart],
    onSave: async (state) => {
      const r = await store.saveStepState({
        blockId: block.id,
        expectedStepIndex: i,
        stepState: { order: state.order, answers: state.answers, revealed: state.revealed },
      });
      if (!r.applied) throw new Error("別の画面で先に進んでいます。ホームから開き直してください");
    },
    onFinish,
  });
}

// 完了画面（10.5）
async function showDone(view, book, block) {
  const ctx = view.ctx;
  const store = ctx.store;
  const [words, results] = await Promise.all([store.getWords(book.id), store.listResults(block.wordbookId)]);
  const newCount = countNewNigate({ words, results, block });
  const main = [
    el("h1", "title", "第" + block.seq + "回（" + block.nos.length + "語）が終わりました"),
    el("p", "lead done-review", "1日後の復習: " + formatDayJa(block.reviews.r1.due)),
    el("p", "lead done-nigate", "このまとまりで新たに苦手になった語: " + newCount + "語"),
  ];
  view.show(main, [button("ホームへ", () => ctx.go("#/"), "btn btn-main")]);
}
