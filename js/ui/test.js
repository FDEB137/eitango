// テストの画面（docs/shiyou.md 2.5・10.4）。学習の工程のテスト（manabu.js）と復習（fukushuu.js）で共通。
// 状態の計算は js/core/flow.js の関数にまかせる。ここは表示と、1つ操作するごとの保存の呼び出しだけ。
import { revealAnswer, recordAnswer, undoAnswer, isFinished, currentNo, countAnswers } from "../core/flow.js";
import { el, append, button, guardedButton, wordCard, wordCards, wordsByNos } from "./parts.js";

// テストを出題する。
//   order / answers / revealed: 保存されている状態（再開しても同じ並び・同じ判定）
//   wordMap: 番号 → 語の記録
//   onSave(state): 1つ操作するごとの保存（await する。失敗したら例外を投げる）
//   onFinish(answers): 最後の語に判定をつけたとき。確定して結果画面に移る（view を使う）
//   topButtons: 「中断」の隣に出す小さなボタン
export function renderPlay(view, { title, subtitle, order, answers, revealed, wordMap, onSave, onFinish, topButtons = [] }) {
  const ctx = view.ctx;
  let state = { order: [...order], answers: answers.map((a) => [a[0], a[1]]), revealed: !!revealed };

  // 1つの操作の保存（最後の語では確定）が終わるまで、画面全体を処理中にする（中断・最初からやり直す・ひとつ戻るも押せない。7.7）。
  // 成功したら次の表示（view.show）で新しい画面になり押せる。失敗したら同じ語・同じ表示のまま、押せたものを戻す。
  async function act(next, finishing, pressed) {
    const h = ctx.begin(pressed);
    if (!h) return;
    let release = false;
    try {
      if (finishing) {
        await onFinish(next.answers);
      } else {
        await onSave(next);
        state = next;
        draw();
      }
    } catch (e) {
      ctx.fail(e);
      release = true;
    }
    if (release) h.end();
  }

  function draw() {
    const total = state.order.length;
    const finished = isFinished(state);
    const k = finished ? total : state.answers.length + 1;
    const top = el("div", "top-row");
    top.append(button("中断", () => ctx.go("#/"), "btn btn-sub btn-pause"));
    append(top, topButtons);

    const main = [top, el("h1", "title", title)];
    if (subtitle) main.push(el("p", "note", subtitle));
    main.push(el("p", "progress", k + " / " + total));

    const bar = [];
    const sub = [];
    if (finished) {
      main.push(el("p", "lead", "全部の語に判定がつきました"));
      bar.push(button("結果へ", (ev) => act(state, true, ev.currentTarget), "btn btn-main"));
    } else {
      const no = currentNo(state);
      const w = wordMap.get(no) || { no, word: "（番号 " + no + " の語が見つかりません）" };
      main.push(wordCard(w, { front: !state.revealed }));
      // 「ひとつ戻る」は下に固定した帯（判定のボタンの上の段）に置く
      const undo = button("ひとつ戻る", (ev) => act(undoAnswer(state), false, ev.currentTarget), "btn btn-sub btn-undo");
      undo.disabled = state.answers.length === 0;
      sub.push(undo);
      if (!state.revealed) {
        bar.push(button("答えを見る", (ev) => act(revealAnswer(state), false, ev.currentTarget), "btn btn-main btn-reveal"));
      } else {
        const judge = (ok, pressed) => {
          const next = recordAnswer(state, ok);
          return act(next, isFinished(next), pressed);
        };
        bar.push(
          button("× まだ", (ev) => judge(false, ev.currentTarget), "btn btn-ng btn-judge-ng"),
          button("○ 覚えた", (ev) => judge(true, ev.currentTarget), "btn btn-ok btn-judge-ok"),
        );
      }
    }
    view.show(main, bar, sub);
  }

  draw();
}

// 結果画面（2.5）。
//   answers: 全語の判定、wordMap: 番号 → 語の記録
//   counted: 数えるテストか。newlyNigate: 新たに苦手になった番号
//   nextLabel / onNext: 「次へ」（学習は次の工程、復習はホーム）
//   doneNote: 最後の工程で、まとまりが学習済みになったときの1行（完了画面と同じ要点。10.5）
export function renderResult(view, { title, answers, wordMap, counted, newlyNigate = [], nextLabel = "次へ", onNext, doneNote = "" }) {
  const c = countAnswers({ order: answers.map((a) => a[0]), answers, revealed: false });
  const top = el("div", "top-row");
  top.append(button("中断", () => view.ctx.go("#/"), "btn btn-sub btn-pause"));
  const main = [top, el("h1", "title", title), el("p", "note", "結果")];
  const counts = el("p", "result-counts");
  counts.append(el("span", "count-ok", "○ " + c.ok), " ", el("span", "count-ng", "× " + c.ng));
  main.push(counts);
  if (doneNote) main.push(el("p", "lead result-done", doneNote));
  if (counted) {
    const m = el("div", "result-counted");
    // ×が1個以上のときだけ「数えました」。0個なら増えていないことを伝える（2.5）
    m.append(el("p", "lead", c.ng > 0 ? "×の語を間違いの回数に数えました" : "全部○でした（間違いの回数は増えていません）"));
    if (newlyNigate.length > 0) {
      m.append(el("p", "lead nigate-new", "新たに苦手になった語: " + newlyNigate.length + "語"));
      const names = el("p", "note nigate-new-words");
      names.textContent = newlyNigate.map((no) => (wordMap.get(no) ? wordMap.get(no).word : String(no))).join("、");
      m.append(names);
    }
    main.push(m);
  }
  if (c.ng > 0) {
    main.push(el("h2", "section-title", "×の語（ここで覚え直します）"));
    main.push(wordCards(wordsByNos(c.ngNos, wordMap)));
  } else {
    main.push(el("p", "lead", "×の語はありません"));
  }
  view.show(main, [guardedButton(view.ctx, nextLabel, onNext, "btn btn-main btn-next")]);
}
