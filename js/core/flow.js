// 工程の生成（docs/shiyou.md 2.3）・まとまりの作成（2.1）・テストの並びと進め方（2.5）。
// 純粋な関数だけ。乱数は引数（0以上1未満を返す関数）で受け取る。
import { BLOCK_SIZE, GROUP_SIZE } from "./constants.js";

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// 語の番号の並び（1〜40語）から工程の配列を作る。
// 工程 {type: "learn"|"test", level: 0|1|2|3|4, nos, counted}
export function buildSteps(nos) {
  if (!Array.isArray(nos) || nos.length < 1 || nos.length > BLOCK_SIZE) {
    throw new RangeError("まとまりの語数は 1〜" + BLOCK_SIZE + " です");
  }
  const groups = chunk(nos, GROUP_SIZE);
  const sets = chunk(groups, 2);
  const halves = chunk(sets, 2);
  const steps = [];
  const make = (type, level, list, counted) => ({ type, level, nos: [...list], counted });
  for (const h of halves) {
    for (const s of h) {
      for (const g of s) {
        steps.push(make("learn", 0, g, false));
        steps.push(make("test", 1, g, false));
      }
      if (s.length === 2) steps.push(make("test", 2, s.flat(), false));
    }
    if (h.length === 2) steps.push(make("test", 3, h.flat(2), true));
  }
  if (halves.length === 2) steps.push(make("test", 4, nos, true));
  return steps;
}

// 工程の表示名（テストは対象の実際の語数で「N語テスト」）
export function stepName(step) {
  return step.type === "learn" ? "覚える" : step.nos.length + "語テスト";
}

// まだどのまとまりにも入っていない語を番号の小さい順に最大 size 語取る。
// allNos: 単語帳（苦手の単語帳なら members）の番号、takenNos: すでにまとまりに入った番号
export function pickNextNos(allNos, takenNos, size = BLOCK_SIZE) {
  const taken = new Set(takenNos);
  const rest = Array.from(new Set(allNos)).filter((n) => !taken.has(n));
  rest.sort((a, b) => a - b);
  return rest.slice(0, size);
}

// 40語に満たないときの確認の文（40語なら null）。kind は単語帳の kind。
export function shortBlockNotice(count, kind) {
  if (count >= BLOCK_SIZE) return null;
  if (kind === "nigate") {
    return count + "語で始めます（" + BLOCK_SIZE + "語たまるまで待つこともできます）";
  }
  return "残り" + count + "語で始めます。" + BLOCK_SIZE + "語に満たないので流れが短くなります";
}

// まとまり（docs/shiyou.md 7.4）を作る。中身（nos）と工程は作った時点で固定する。
export function createBlock({ wordbookId, seq, nos, startedAt }) {
  const fixed = [...nos];
  return {
    id: wordbookId + ":" + seq,
    wordbookId,
    seq,
    nos: fixed,
    steps: buildSteps(fixed),
    stepIndex: 0,
    stepState: null,
    status: "learning",
    startedAt,
    completedAt: null,
    studiedDay: null,
    reviews: { r1: null, r2: null },
    lastTest: null,
  };
}

// 「最初からやり直す」: 工程1に戻り、テストの途中の判定を捨てる（確定済みの記録は別なので触れない）
export function restartBlock(block) {
  if (block.status !== "learning") throw new Error("学習中のまとまりではありません");
  return { ...block, stepIndex: 0, stepState: null };
}

// ---- テストの並びと進め方（2.5） ----

// 種のある乱数 mulberry32（テスト用。アプリは Math.random を渡す）
export function createRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates。元の配列は変えない。
export function shuffle(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// テストを始める: 並びは nos の順（版7。ランダムにしない）で stepState を作る
export function startTest(nos) {
  return { order: [...nos], answers: [], revealed: false };
}

export function currentNo(state) {
  return state.answers.length < state.order.length ? state.order[state.answers.length] : null;
}

export function isFinished(state) {
  return state.answers.length >= state.order.length;
}

export function revealAnswer(state) {
  if (isFinished(state)) throw new Error("テストは終わっています");
  return { ...state, revealed: true };
}

// ○(true)か×(false)をつけて次の語へ。答えを見た後だけ押せる。
export function recordAnswer(state, ok) {
  if (isFinished(state)) throw new Error("テストは終わっています");
  if (!state.revealed) throw new Error("答えを見る前には判定できません");
  return {
    order: state.order,
    answers: [...state.answers, [state.order[state.answers.length], ok ? 1 : 0]],
    revealed: false,
  };
}

// ひとつ戻る: 直前の判定を取り消し、その語の答えを見た状態に戻る（1語目では使えない）
export function undoAnswer(state) {
  if (state.answers.length === 0) throw new Error("1語目では戻れません");
  return { order: state.order, answers: state.answers.slice(0, -1), revealed: true };
}

export function countAnswers(state) {
  const ng = state.answers.filter((a) => a[1] === 0).map((a) => a[0]);
  return { ok: state.answers.length - ng.length, ng: ng.length, ngNos: ng };
}
