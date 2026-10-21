// 予定の復習の期限と、今日の復習の並び（docs/shiyou.md 3章）。純粋な関数だけ。
import { addDays, compareDays, maxDay, formatMonthDay } from "./day.js";

// r1（学習した日の1日後）を予定に入れる
export function scheduleR1(studiedDay) {
  return { due: addDays(studiedDay, 1), doneDay: null, doneAt: null, wrong: null };
}

// r2: 期限 = max(学習した日 + 2日, r1 を終えた学習日 + 1日)
export function scheduleR2(studiedDay, r1DoneDay) {
  return {
    due: maxDay(addDays(studiedDay, 2), addDays(r1DoneDay, 1)),
    doneDay: null,
    doneAt: null,
    wrong: null,
  };
}

// 次に行う予定の復習 {kind: "r1"|"r2", due}。無ければ null。
export function pendingReview(block) {
  const r = block && block.reviews;
  if (!r || !r.r1) return null;
  if (r.r1.doneDay === null) return { kind: "r1", due: r.r1.due };
  if (r.r2 && r.r2.doneDay === null) return { kind: "r2", due: r.r2.due };
  return null;
}

// 期限が来ているか（今日 >= 期限）。期限を過ぎても終えるまで残る。
export function isDue(block, today) {
  const p = pendingReview(block);
  return p !== null && compareDays(today, p.due) >= 0;
}

// 自由な復習で選んだまとまりをどう記録するか: 期限が来た予定があればその予定、なければ "free"
export function reviewKindFor(block, today) {
  const p = pendingReview(block);
  return p !== null && compareDays(today, p.due) >= 0 ? p.kind : "free";
}

// 学習済みのまとまりの一覧に出す「予定の復習の状態」
export function scheduleLabel(block) {
  const p = pendingReview(block);
  if (p === null) return "予定なし";
  return (p.kind === "r1" ? "1日後" : "2日後") + "の復習 " + formatMonthDay(p.due);
}

// 単語帳を取り込んだ順（苦手の単語帳は作られた順）に並べるため、作られた日時の順にする
export function orderWordbooks(wordbooks) {
  return [...wordbooks].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// 今日の復習の並び: 期限の古い順 → 同じ期限なら r1 が先 → 単語帳の順 → 第N回の小さい順
// 返す要素 {blockId, wordbookId, kind, due, seq}
export function dueReviews(blocks, today, wordbooks) {
  const rank = new Map(orderWordbooks(wordbooks).map((w, i) => [w.id, i]));
  const rankOf = (id) => (rank.has(id) ? rank.get(id) : Number.MAX_SAFE_INTEGER);
  const list = [];
  for (const b of blocks) {
    const p = pendingReview(b);
    if (p !== null && compareDays(today, p.due) >= 0) {
      list.push({ blockId: b.id, wordbookId: b.wordbookId, kind: p.kind, due: p.due, seq: b.seq });
    }
  }
  list.sort((a, b) => {
    const c = compareDays(a.due, b.due);
    if (c !== 0) return c;
    if (a.kind !== b.kind) return a.kind === "r1" ? -1 : 1;
    const r = rankOf(a.wordbookId) - rankOf(b.wordbookId);
    if (r !== 0) return r;
    return a.seq - b.seq;
  });
  return list;
}

// 期限が来ていない予定のうち、いちばん早い期限（ホームの「次の期限」）。無ければ null。
export function nextDue(blocks, today) {
  let best = null;
  for (const b of blocks) {
    const p = pendingReview(b);
    if (p !== null && compareDays(today, p.due) < 0 && (best === null || compareDays(p.due, best) < 0)) {
      best = p.due;
    }
  }
  return best;
}
