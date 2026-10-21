// 画面の枠とルーター（docs/shiyou.md 10.1・10.3・9.3）。
// 1ページのアプリで、画面は #/… で切り替える。画面ごとの描画は ui/*.js にまかせ、ここは
// 「どの画面を出すか」「ナビ」「アプリの状態（9.3）ごとの出し分け」「共通の知らせ・エラー」を受け持つ。
// 今の時刻（now）・乱数（rng）・画面遷移（navigate）・ファイル操作（io）は引数で受け取る（テストで差し替える）。
import { defaultIo } from "./io.js";
import { el, alertBox, errorBox, button, MESSAGES, HELP_HREF } from "./parts.js";
import { render as renderHome } from "./home.js";
import { render as renderManabu } from "./manabu.js";
import { render as renderFukushuu } from "./fukushuu.js";
import { render as renderMatomari } from "./matomari.js";
import { render as renderTangochou } from "./tangochou.js";
import { render as renderTorikomi } from "./torikomi.js";
import { render as renderNigate } from "./nigate.js";
import { render as renderKiroku } from "./kiroku.js";

export const SCREENS = {
  "": renderHome,
  manabu: renderManabu,
  fukushuu: renderFukushuu,
  matomari: renderMatomari,
  tangochou: renderTangochou,
  torikomi: renderTorikomi,
  nigate: renderNigate,
  kiroku: renderKiroku,
};

// 学習・復習の画面にはナビを出さない（左上の「中断」でホームへ。10.1）
const NO_NAV = new Set(["manabu", "fukushuu"]);

export function parseHash(hash) {
  const h = String(hash || "").replace(/^#/, "");
  const segs = h.split("/").filter((s) => s !== "");
  let param = segs.length > 1 ? segs[1] : null;
  if (param !== null) {
    try {
      param = decodeURIComponent(param);
    } catch (e) {
      // 壊れた文字は、そのまま使う（見つからない単語帳として扱われる）
    }
  }
  return { name: segs[0] || "", param };
}

export function hashFor(name, param) {
  return "#/" + name + (param ? "/" + encodeURIComponent(param) : "");
}

const NAV_OF = { "": "home", matomari: "home", nigate: "home", tangochou: "tangochou", torikomi: "tangochou", kiroku: "kiroku" };

// opts: {store, mainEl, barEl, navEl, now, rng, navigate, io, update}
//   update: {available: bool, apply(): void} 新しい版の知らせ（フェーズ4で渡す。無ければ出さない）
export function createShell(opts) {
  const { store, mainEl, barEl, navEl } = opts;
  const io = { ...defaultIo, ...(opts.io || {}) };
  let currentHash = "#/";
  let renderToken = 0;
  let pendingFlash = null;
  // 描き替え待ちの間に起きた失敗（次に出る画面の見出しの下に出す）と、最後に view.show した画面の印
  let pendingError = null;
  let shownToken = 0;
  let shell = null;
  // 処理中の印（仕様 7.7。版5）。画面（view.show・shell.show で出すたびに新しくなる）ごとに持つ。
  //   busy: 処理中か / locked: 処理中に押せなくした要素 / timer: 見た目を変えるまでの待ち / status: アプリが古い・閉じた状態の画面か
  const busyDelay = typeof opts.busyDelayMs === "number" ? opts.busyDelayMs : 300;
  let screen = newScreen();

  function newScreen(status = false) {
    return { busy: false, locked: [], timer: null, status };
  }

  function rootEl() {
    return navEl.parentElement;
  }

  function clearBusyLook(s) {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    const root = rootEl();
    if (root) root.classList.remove("is-busy", "is-busy-shown");
  }

  // 押せなくしたものを元に戻す（処理の前に押せたものだけを入れてある）
  function unlock(s) {
    for (const e of s.locked) {
      if (e.tagName === "A") e.removeAttribute("aria-disabled");
      else e.disabled = false;
      e.removeAttribute("data-locked");
    }
    s.locked = [];
  }

  // 新しい画面にする。古い画面の処理中の印は消す。
  // restore: 古い画面の押せなくしたものを戻す（view.show。ナビは描き直されないので戻す）。shell.show は古い本文が新しい画面に替わるまで押せないままにする。
  function replaceScreen(status, restore) {
    const old = screen;
    clearBusyLook(old);
    if (restore) unlock(old);
    screen = newScreen(status);
  }

  // 画面全体を押せなくする（capture の click で止める）。押した瞬間（最初の await の前）に呼ぶ。
  // 処理中なら null（押した操作は行わない）。pressed: 押したボタン（すぐ押せない見た目になる）。
  function begin(pressed) {
    if (screen.busy) return null;
    const s = screen;
    s.busy = true;
    const root = rootEl();
    if (root) {
      root.classList.add("is-busy");
      for (const e of root.querySelectorAll("button, input[type=file], a[href]")) {
        if (e.tagName === "A") {
          if (e.getAttribute("aria-disabled") === "true") continue;
          e.setAttribute("aria-disabled", "true");
        } else {
          if (e.disabled) continue;
          e.disabled = true;
        }
        if (e !== pressed) e.setAttribute("data-locked", "");
        s.locked.push(e);
      }
      if (pressed && !pressed.disabled) pressed.disabled = true;
      s.timer = setTimeout(() => {
        s.timer = null;
        if (screen === s && s.busy && rootEl()) rootEl().classList.add("is-busy-shown");
      }, busyDelay);
    }
    return {
      screen: s,
      // 失敗したとき・同じ画面に残るときに押せる状態へ戻す。画面が替わっていれば何もしない（新しい画面の印を触らない）
      end() {
        if (screen !== s || !s.busy) return;
        s.busy = false;
        unlock(s);
        clearBusyLook(s);
      },
    };
  }

  function installGuard() {
    const root = rootEl();
    if (!root || root.__eitangoGuard) return;
    root.__eitangoGuard = true;
    // 処理中は、本文・帯・ナビのどれを押しても何も起きない（ボタン・リンク・ファイルを選ぶボタン）
    root.addEventListener(
      "click",
      (ev) => {
        if (!screen.busy) return;
        ev.preventDefault();
        ev.stopPropagation();
      },
      true,
    );
  }
  installGuard();

  const ctx = {
    store,
    io,
    now: opts.now || (() => new Date()),
    rng: opts.rng || Math.random,
    get update() {
      return opts.update || null;
    },
    go(hash) {
      if (typeof opts.navigate === "function") opts.navigate(hash);
      else shell.show(hash);
    },
    refresh() {
      return shell.show(currentHash);
    },
    // 次に出す画面の上に知らせを1つ出す
    flash(message) {
      if (screen.status) return; // アプリが古い・閉じた状態の画面は、知らせだけ（7.7）
      pendingFlash = message;
    },
    begin,
    // 今の画面が処理中か
    isBusy() {
      return screen.busy;
    },
    // エラーを今の画面の見出しのすぐ下に、1つの箱で出す（12章）。items: 理由の一覧（任意。同じ箱の中に入れる）。
    // 前のエラーの箱はすべて消す。画面をいちばん上へ動かす。アプリが古い・閉じた状態の画面では何も出さない。
    fail(e, items) {
      if (screen.status) return;
      const message = e && e.message ? e.message : String(e);
      // 新しい画面を描き始めているが、まだ view.show していない（本文は古い画面のまま）: 取っておき、次に出る画面で出す（7.7）
      if (shownToken !== renderToken) {
        pendingError = { message, items };
        return;
      }
      for (const old of mainEl.querySelectorAll(".alert-error")) old.remove();
      const box = errorBox(message, items);
      const h1 = mainEl.querySelector("h1");
      if (h1) h1.after(box);
      else mainEl.prepend(box);
      const w = mainEl.ownerDocument.defaultView;
      if (w && typeof w.scrollTo === "function") w.scrollTo(0, 0);
    },
    // 操作を行い、例外は画面に出す
    async run(fn) {
      try {
        return await fn();
      } catch (e) {
        ctx.fail(e);
        return undefined;
      }
    },
  };

  // 帯の上の段（判定のボタンの上）。帯の手前に必要なときに作る。
  function subBar() {
    let s = barEl.previousElementSibling;
    if (!s || !s.classList.contains("bar-sub")) {
      s = mainEl.ownerDocument.createElement("div");
      s.className = "bar-sub";
      barEl.before(s);
    }
    return s;
  }

  // 固定した帯・ナビの下に本文が隠れないよう、枠（.app）に印の class をつける（余白は CSS で決める）
  function setLayout(cls, on) {
    const root = navEl.parentElement;
    if (root) root.classList.toggle(cls, !!on);
  }

  function makeView(token, name, param) {
    // 画面ごとの ctx。refresh だけが「始めた画面がまだ出ているか」で動きを変える（7.7「処理中のブラウザの戻る」）
    const vctx = Object.create(ctx);
    vctx.refresh = (flashMessage) => {
      // 始めた画面がもう出ていなくて、今の画面が自分の処理中なら、出し直さない（その処理中の印を消さないため）
      if (token !== renderToken && screen.busy) return undefined;
      if (flashMessage) ctx.flash(flashMessage);
      return shell.show(currentHash);
    };
    const view = {
      ctx: vctx,
      name,
      param,
      alive: () => token === renderToken,
      // bar: 下に固定した帯のボタン。sub: その上の段（「ひとつ戻る」など）
      show(main, bar = [], sub = []) {
        if (token !== renderToken) return;
        replaceScreen(name === "status", true);
        shownToken = token;
        const nodes = Array.isArray(main) ? [...main] : [main];
        const carried = pendingError;
        pendingError = null;
        if (carried && name !== "status") {
          const box = errorBox(carried.message, carried.items);
          const hi = nodes.findIndex((n) => n && n.tagName === "H1");
          nodes.splice(hi + 1, 0, box);
        }
        if (pendingFlash) {
          nodes.unshift(alertBox(pendingFlash, "info"));
          pendingFlash = null;
        }
        mainEl.replaceChildren(...nodes);
        const barNodes = Array.isArray(bar) ? bar : [bar];
        const subNodes = Array.isArray(sub) ? sub : [sub];
        barEl.replaceChildren(...barNodes);
        subBar().replaceChildren(...subNodes);
        setLayout("has-bar", barNodes.length > 0);
        setLayout("has-sub", subNodes.length > 0);
        const w = mainEl.ownerDocument.defaultView;
        if (w && typeof w.scrollTo === "function") w.scrollTo(0, 0);
      },
    };
    return view;
  }

  function drawNav(route, state) {
    navEl.replaceChildren();
    if (state === "newer" || state === "closed" || NO_NAV.has(route)) {
      navEl.hidden = true;
      setLayout("has-nav", false);
      return;
    }
    navEl.hidden = false;
    setLayout("has-nav", true);
    const cur = NAV_OF[route];
    const items = [["home", "ホーム", "#/"]];
    if (state === "ready") items.push(["tangochou", "単語帳", "#/tangochou"]);
    items.push(["kiroku", "記録", "#/kiroku"], ["help", "使い方", HELP_HREF]);
    for (const [key, label, href] of items) {
      const a = el("a", key === cur ? "nav-item nav-current" : "nav-item", label);
      a.href = href;
      if (key === cur) a.setAttribute("aria-current", "page");
      navEl.append(a);
    }
  }

  // 新しい版の知らせ（11章）。画面ごとに出す所で使う。
  function updateBox() {
    const u = opts.update;
    if (!u || !u.available) return null;
    const box = alertBox("新しい版があります", "info");
    box.append(button("更新する", () => u.apply(), "btn btn-main btn-block"));
    return box;
  }
  ctx.updateBox = updateBox;

  // アプリが古い・閉じた状態の画面（9.3）。どの URL でもこの画面だけ。
  function showStatusScreen(state, token) {
    const view = makeView(token, "status", null);
    const main = [el("h1", "title", "えいたんご")];
    const bar = [];
    if (state === "newer") {
      main.push(alertBox(MESSAGES.newer, "warn"));
      const u = updateBox();
      if (u) main.push(u);
    } else {
      main.push(alertBox(MESSAGES.closed, "warn"));
      bar.push(button("再読み込み", () => io.reload(), "btn btn-main"));
    }
    view.show(main, bar);
  }

  shell = {
    ctx,
    get hash() {
      return currentHash;
    },
    // 現在の状態に合わせて、画面を出し直す
    render() {
      return shell.show(currentHash);
    },
    async show(hash) {
      currentHash = hash || "#/";
      const token = ++renderToken;
      installGuard();
      replaceScreen(false, false);
      const state = store.status.state;
      drawNav("", state);
      if (state === "newer" || state === "closed") {
        showStatusScreen(state, token);
        return;
      }
      const { name, param } = parseHash(currentHash);
      let route = Object.prototype.hasOwnProperty.call(SCREENS, name) ? name : "";
      // 移行に失敗した状態: ホームと記録だけ。ほかの URL はホームへ（9.3）
      if (state === "migrationFailed" && route !== "" && route !== "kiroku") {
        ctx.go("#/");
        return;
      }
      drawNav(route, state);
      const view = makeView(token, route, param);
      try {
        await SCREENS[route](view, param);
      } catch (e) {
        if (view.alive()) {
          view.show([el("h1", "title", "えいたんご"), alertBox("画面を出せませんでした: " + (e && e.message ? e.message : e), "error")], [
            button("ホームへ", () => ctx.go("#/"), "btn btn-main"),
          ]);
        }
      }
    },
  };
  return shell;
}
