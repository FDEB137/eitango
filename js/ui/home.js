// ホーム #/（docs/shiyou.md 10.2・8.3・9.3）。
// 表示するものの計算は js/core/ の関数にまかせる（今日の復習の並び・次の期限・新しく覚える語の取り方）。
import { BLOCK_SIZE, REMIND_EXPORT_DAYS } from "../core/constants.js";
import { diffDays, formatMonthDay, studyDay } from "../core/day.js";
import { pickNextNos, shortBlockNotice, stepName } from "../core/flow.js";
import { dueReviews, nextDue } from "../core/review.js";
import { el, button, guardedButton, alertBox, section, rangeLabel, confirmScreen, link, MESSAGES, HELP_HREF } from "./parts.js";
import { KIND_LABEL, startReviewFlow } from "./fukushuu.js";

// 書き出しの催促を出すか（8.3）: 記録（まとまり）があり、最後の書き出しから14日以上たっている（または一度も書き出していない）
export function shouldRemindExport({ blocks, lastExportAt, today }) {
  if (!blocks || blocks.length === 0) return false;
  if (!lastExportAt) return true;
  const d = new Date(lastExportAt);
  if (Number.isNaN(d.getTime())) return true;
  return diffDays(today, studyDay(d)) >= REMIND_EXPORT_DAYS;
}

// 「続きから」の1行（例 金フレ 第3回・20語テスト 12/20）
export function describeBlockProgress(book, block) {
  const step = block.steps[block.stepIndex];
  let where = "";
  if (step) {
    if (step.type === "learn") {
      where = "覚える（" + step.nos.length + "語）";
    } else {
      const st = block.stepState;
      where = stepName(step) + " " + (st ? st.answers.length : 0) + "/" + step.nos.length;
    }
  }
  return book.name + " 第" + block.seq + "回・" + where;
}

export async function render(view) {
  const ctx = view.ctx;
  const store = ctx.store;
  const upd = ctx.updateBox && ctx.updateBox();

  // 移行に失敗した状態（9.3）: 知らせと「記録へ」だけ
  if (store.status.state === "migrationFailed") {
    const main = [el("h1", "title", "えいたんご")];
    if (upd) main.push(upd);
    main.push(alertBox(MESSAGES.migrationFailed, "warn"));
    view.show(main, [button("記録へ", () => ctx.go("#/kiroku"), "btn btn-main btn-to-kiroku")]);
    return;
  }

  const now = ctx.now();
  const today = studyDay(now);
  const [books, blocks, meta, session] = await Promise.all([store.listWordbooks(), store.listBlocks(), store.getMeta(), store.getSession()]);
  const normals = books.filter((b) => b.kind === "normal");

  // 単語帳が1つも無いとき
  if (normals.length === 0) {
    const main = [el("h1", "title", "えいたんご")];
    if (upd) main.push(upd);
    main.push(el("p", "lead", "単語帳がありません。CSV から単語帳を取り込んで、学習をはじめましょう。"));
    main.push(link("使い方を見る", HELP_HREF, "btn btn-sub btn-block"));
    view.show(main, [button("単語帳を取り込む", () => ctx.go("#/torikomi"), "btn btn-main btn-to-torikomi")]);
    return;
  }

  const active = normals.find((b) => b.id === meta.activeWordbookId) || normals[0];
  const nigateBook = books.find((b) => b.kind === "nigate" && b.sourceId === active.id) || null;
  const bookById = new Map(books.map((b) => [b.id, b]));

  const main = [];
  const head = el("h1", "title home-title");
  head.append(button(active.name, () => ctx.go("#/tangochou"), "title-btn"));
  main.push(head);

  // 知らせ
  if (upd) main.push(upd);
  if (shouldRemindExport({ blocks, lastExportAt: meta.lastExportAt, today })) {
    main.push(button("記録の書き出し（バックアップ）をおすすめします", () => ctx.go("#/kiroku"), "alert alert-info alert-btn remind-export"));
  }

  // 続きから（使う単語帳とその苦手の単語帳の学習中のまとまり、進行中の復習）
  const resume = [];
  for (const book of [active, nigateBook]) {
    if (!book) continue;
    for (const b of blocks) {
      if (b.wordbookId === book.id && b.status === "learning") {
        resume.push({ text: describeBlockProgress(book, b), go: "#/manabu/" + encodeURIComponent(book.id) });
      }
    }
  }
  if (session) {
    const sb = blocks.find((b) => b.id === session.blockId);
    const sbook = sb ? bookById.get(sb.wordbookId) : null;
    if (sb && sbook) {
      resume.push({
        text: sbook.name + " 第" + sb.seq + "回・" + (KIND_LABEL[session.kind] || "復習") + " " + session.answers.length + "/" + session.order.length,
        go: "#/fukushuu",
      });
    }
  }
  if (resume.length > 0) {
    const s = section("続きから");
    s.classList.add("home-resume");
    for (const r of resume) {
      s.append(el("p", "line resume-line", r.text), button("続きから", () => ctx.go(r.go), "btn btn-main btn-block btn-resume"));
    }
    main.push(s);
  }

  // 今日の復習
  const due = dueReviews(blocks, today, books);
  const rv = section("今日の復習");
  rv.classList.add("home-review");
  if (due.length > 0) {
    const first = due[0];
    const fb = bookById.get(first.wordbookId);
    rv.append(
      el("p", "line review-count", "期限が来た復習: " + due.length + "件"),
      el("p", "note review-first", (fb ? fb.name : "") + " 第" + first.seq + "回・" + KIND_LABEL[first.kind] + "（期限 " + formatMonthDay(first.due) + "）"),
      guardedButton(ctx, "復習を始める", () => startReviewFlow(view, first.blockId), "btn btn-main btn-block btn-start-due"),
    );
  } else {
    rv.append(el("p", "line review-none", "今日の復習はありません"));
    const nd = nextDue(blocks, today);
    if (nd) rv.append(el("p", "note review-next", "次の期限: " + formatMonthDay(nd)));
  }
  main.push(rv);

  // 新しく覚える（学習中のまとまりがあるときは「続きから」が代わりになる）
  const activeBlocks = blocks.filter((b) => b.wordbookId === active.id);
  if (!activeBlocks.some((b) => b.status === "learning")) {
    const nw = section("新しく覚える");
    nw.classList.add("home-new");
    const allNos = (await store.getWords(active.id)).map((w) => w.no);
    const nos = pickNextNos(allNos, activeBlocks.flatMap((b) => b.nos));
    if (nos.length > 0) {
      const seq = activeBlocks.reduce((m, b) => Math.max(m, b.seq), 0) + 1;
      nw.append(
        el("p", "line new-info", "第" + seq + "回・番号 " + rangeLabel(nos) + "・" + nos.length + "語"),
        guardedButton(ctx, "覚える", () => startNew(view, active, nos.length), "btn btn-main btn-block btn-start-new"),
      );
    } else {
      nw.append(el("p", "line new-none", "全部のまとまりを始めました"));
    }
    main.push(nw);
  }

  // 苦手の単語帳
  if (nigateBook && nigateBook.members.length > 0) {
    const nb = section("苦手の単語帳");
    nb.classList.add("home-nigate");
    const nblocks = blocks.filter((b) => b.wordbookId === nigateBook.id);
    const rest = pickNextNos(nigateBook.members, nblocks.flatMap((b) => b.nos));
    const restCount = pickNextNos(nigateBook.members, nblocks.flatMap((b) => b.nos), nigateBook.members.length).length;
    nb.append(el("p", "line nigate-info", "苦手の語: " + nigateBook.members.length + "語・まだ始めていない語: " + restCount + "語"));
    const learningBlock = nblocks.find((b) => b.status === "learning");
    if (learningBlock) nb.append(el("p", "line nigate-learning", "第" + learningBlock.seq + "回を学習中（" + learningBlock.nos.length + "語）"));
    if (rest.length > 0 && !nblocks.some((b) => b.status === "learning")) {
      nb.append(guardedButton(ctx, "覚える", () => startNew(view, nigateBook, rest.length), "btn btn-block btn-start-nigate"));
    }
    nb.append(button("一覧", () => ctx.go("#/nigate/" + encodeURIComponent(active.id)), "btn btn-block btn-nigate-list"));
    main.push(nb);
  }

  // 学習済みのまとまり
  const doneCount = blocks.filter((b) => b.status === "done").length;
  const dn = section("学習済みのまとまり", el("p", "line done-count", "学習済み: " + doneCount));
  dn.classList.add("home-done");
  const pick = button("選んでテスト", () => ctx.go("#/matomari"), "btn btn-block btn-pick");
  pick.disabled = doneCount === 0;
  dn.append(pick);
  main.push(dn);

  view.show(main, []);
}

// 新しいまとまりを作って学習へ。40語に満たないときは先に確かめる（2.1）。
async function startNew(view, book, count) {
  const ctx = view.ctx;
  const go = async () => {
    const r = await ctx.store.startBlock({ wordbookId: book.id, now: ctx.now() });
    if (!r.block) throw new Error("始められる語がありません");
    ctx.go("#/manabu/" + encodeURIComponent(book.id));
  };
  const notice = shortBlockNotice(count, book.kind);
  if (notice === null || count >= BLOCK_SIZE) {
    await go();
    return;
  }
  confirmScreen(view, {
    title: "始めますか",
    lines: [notice],
    buttons: [
      { label: "やめる", onClick: () => ctx.refresh() },
      { label: "始める", cls: "btn btn-main", run: go },
    ],
  });
}
