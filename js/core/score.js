// テストの確定内容の計算（docs/shiyou.md 2.5・3.2・4・5章）。
// 「今の状態＋判定 → 書き換える内容」を返すだけの純粋な関数。書き込み（トランザクション）は db/store.js の役目。
// 入力は変えず、新しい値を返す。
import { NIGATE_THRESHOLD } from "./constants.js";
import { scheduleR1, scheduleR2 } from "./review.js";

const clone = (v) => JSON.parse(JSON.stringify(v));

// 学習の工程（覚える）を終えて次へ進む。確定しようとしている工程が今の工程と違えば何もしない。
export function advanceLearn(block, expectedStepIndex) {
  if (block.status !== "learning" || block.stepIndex !== expectedStepIndex) {
    return { applied: false, reason: "stale" };
  }
  const step = block.steps[block.stepIndex];
  if (!step || step.type !== "learn") return { applied: false, reason: "stale" };
  return { applied: true, block: { ...clone(block), stepIndex: block.stepIndex + 1, stepState: null } };
}

function checkAnswers(answers, nos) {
  if (!Array.isArray(answers)) throw new Error("判定の形が違います");
  const seen = new Set();
  for (const a of answers) {
    if (!Array.isArray(a) || a.length !== 2 || (a[1] !== 0 && a[1] !== 1)) throw new Error("判定の形が違います");
    if (seen.has(a[0])) throw new Error("同じ語に2回判定がついています: " + a[0]);
    seen.add(a[0]);
  }
  if (seen.size !== nos.length || nos.some((n) => !seen.has(n))) {
    throw new Error("テストに出した全語に判定がついていません");
  }
}

// テストの確定。
//   kind: "step"（学習の工程のテスト）| "r1" | "r2" | "free"
//   block: 今のまとまり、expected: 確定しようとしているもの
//     kind が "step" なら {stepIndex}、復習なら {startedAt}（session.startedAt）
//   session: 今保存されている進行中の復習（復習のとき）
//   answers: [[番号, 1|0], ...]（テストに出した全語）
//   day: 今の学習日、nowIso: 今の日時（ISO）
//   words: 元の単語帳の語の記録（少なくとも×の語を含む。{no, miss, nigateDay, ...}）
//   sourceBook: 元のふつうの単語帳、nigateBook: その苦手の単語帳（まだ無ければ null）
//   newNigateId: 苦手の単語帳を新しく作るときの id（呼び出し側が crypto.randomUUID() で作る）
// 戻り値: {applied: false, reason} か
//   {applied: true, block, words（変わった語）, nigateBook（作った・変わったときだけ。無ければ null）,
//    nigateCreated, result（results に足す内容。id は付けない。数えないテストでは null）,
//    deleteSession, newlyNigate（新しく苦手になった番号）, missNos, counted, blockDone}
export function confirmTest(input) {
  const { kind, block, expected, session, answers, day, nowIso } = input;
  const isStep = kind === "step";
  let step = null;
  let targetNos;

  if (isStep) {
    step = block.steps[block.stepIndex];
    if (block.status !== "learning" || !expected || expected.stepIndex !== block.stepIndex || !step || step.type !== "test") {
      return { applied: false, reason: "stale" };
    }
    targetNos = step.nos;
  } else {
    if (kind !== "r1" && kind !== "r2" && kind !== "free") throw new Error("復習の種類が違います: " + kind);
    if (!session || session.kind !== kind || session.blockId !== block.id || !expected || session.startedAt !== expected.startedAt) {
      return { applied: false, reason: "stale" };
    }
    if (kind !== "free") {
      const r = block.reviews && block.reviews[kind];
      if (!r || r.doneDay !== null) return { applied: false, reason: "stale" };
    }
    targetNos = block.nos;
  }
  checkAnswers(answers, targetNos);

  const counted = isStep ? step.counted : true;
  const missNos = answers.filter((a) => a[1] === 0).map((a) => a[0]);
  const okCount = answers.length - missNos.length;

  const wordMap = new Map((input.words || []).map((w) => [w.no, w]));
  const changedWords = [];
  const newlyNigate = [];
  let nigate = input.nigateBook ? clone(input.nigateBook) : null;
  let nigateCreated = false;
  let nigateChanged = false;

  if (counted) {
    for (const no of missNos) {
      const w = wordMap.get(no);
      if (!w) throw new Error("語の記録がありません: " + no);
      const w2 = { ...w, miss: (w.miss || 0) + 1 };
      if (w2.miss >= NIGATE_THRESHOLD && (w2.nigateDay === null || w2.nigateDay === undefined)) {
        w2.nigateDay = day;
        newlyNigate.push(no);
        if (!nigate) {
          if (!input.newNigateId || !input.sourceBook) throw new Error("苦手の単語帳を作る情報がありません");
          nigate = {
            id: input.newNigateId,
            kind: "nigate",
            name: input.sourceBook.name + "（苦手）",
            sourceId: input.sourceBook.id,
            members: [],
            createdAt: nowIso,
            updatedAt: nowIso,
            fileName: null,
          };
          nigateCreated = true;
        }
        if (!nigate.members.includes(no)) {
          nigate.members.push(no);
          nigate.updatedAt = nowIso;
          nigateChanged = true;
        }
      }
      changedWords.push(w2);
    }
  }

  const b = clone(block);
  let blockDone = false;
  if (isStep) {
    b.stepIndex = block.stepIndex + 1;
    b.stepState = null;
    if (b.stepIndex >= b.steps.length) {
      blockDone = true;
      b.status = "done";
      b.completedAt = nowIso;
      b.studiedDay = day;
      b.reviews = { r1: scheduleR1(day), r2: null };
    }
  } else if (kind !== "free") {
    b.reviews[kind] = { ...b.reviews[kind], doneDay: day, doneAt: nowIso, wrong: missNos.length };
    if (kind === "r1") b.reviews.r2 = scheduleR2(b.studiedDay, day);
  }
  if (counted) b.lastTest = { day, kind, ok: okCount, total: answers.length };

  return {
    applied: true,
    block: b,
    words: changedWords,
    nigateBook: nigateCreated || nigateChanged ? nigate : null,
    nigateCreated,
    result: counted
      ? {
          at: nowIso,
          day,
          wordbookId: block.wordbookId,
          blockId: block.id,
          kind,
          level: isStep ? step.level : null,
          items: answers.map((a) => [a[0], a[1]]),
        }
      : null,
    deleteSession: !isStep,
    newlyNigate,
    missNos,
    counted,
    blockDone,
  };
}

// 復習を始めるときの進行中の復習（session の値）
export function newSession({ kind, block, order, nowIso }) {
  return {
    key: "review",
    kind,
    blockId: block.id,
    order: [...order],
    answers: [],
    revealed: false,
    startedAt: nowIso,
    updatedAt: nowIso,
  };
}
