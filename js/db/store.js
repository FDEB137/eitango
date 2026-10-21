// IndexedDB への保存（docs/shiyou.md 7〜9章）。
// 計算は js/core/ の純粋な関数にまかせ、ここは「読む・トランザクションで書く」ことに徹する。
// 今の時刻は引数（Date）で受け取る（中で new Date() を使わない）。
// DB 名は openStore の引数で変えられる（テスト用。既定は "eitango"）。
import { SCHEMA_VERSION, migrations as defaultMigrations, migrateData } from "../core/migrate.js";
import { studyDay, isoWithOffset } from "../core/day.js";
import { createBlock, restartBlock, pickNextNos, shuffle } from "../core/flow.js";
import { advanceLearn, confirmTest, newSession } from "../core/score.js";
import { reviewKindFor, orderWordbooks } from "../core/review.js";
import { buildWordRecords, applyImport, diffImport, wordbookNameFromFile } from "../core/csv.js";
import { createBackup, serializeBackup, backupFileName, snapshotToBackup, inspectBackup, DATA_KEYS } from "../core/backup.js";
import { APP_VERSION } from "../version.js";

export const DEFAULT_DB_NAME = "eitango";
export const DB_VERSION = 1; // IndexedDB の版（ストアや索引を変えるときだけ上げる。仕様 9章）

// 全ストア（snapshots を含む）。書き出しの対象は DATA_KEYS（snapshots を除く）。
export const STORE_NAMES = ["meta", "wordbooks", "words", "blocks", "results", "session", "snapshots"];
const DATA_STORES = DATA_KEYS.filter((k) => k !== "meta"); // 置き換え・移行で作り直す5つ

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

// 1つのトランザクションで fn を行う。fn が例外を投げたらトランザクション全体を取り消す（途中まで書かない）。
// fn の中では IndexedDB の要求だけを await する（それ以外を待つとトランザクションが終わってしまう）。
function transact(db, names, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let value;
    let failure = null;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(failure || tx.error || new Error("トランザクションが取り消されました"));
    let p;
    try {
      p = Promise.resolve(fn(tx));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (v) => {
        value = v;
      },
      (e) => {
        failure = e;
        try {
          tx.abort();
        } catch (e2) {
          // すでに取り消されている
        }
      },
    );
  });
}

function openDb(idb, name) {
  return new Promise((resolve, reject) => {
    const r = idb.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      // ここでは構成だけを作る（データの変換は移行関数で行う。仕様 9章）
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("wordbooks")) db.createObjectStore("wordbooks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("words")) {
        db.createObjectStore("words", { keyPath: ["wordbookId", "no"] }).createIndex("wordbookId", "wordbookId");
      }
      if (!db.objectStoreNames.contains("blocks")) {
        db.createObjectStore("blocks", { keyPath: "id" }).createIndex("wordbookId", "wordbookId");
      }
      if (!db.objectStoreNames.contains("results")) {
        db.createObjectStore("results", { keyPath: "id", autoIncrement: true }).createIndex("wordbookId", "wordbookId");
      }
      if (!db.objectStoreNames.contains("session")) db.createObjectStore("session", { keyPath: "key" });
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "key" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// データベースを消す（テスト用。開いている接続は先に close すること）
export function deleteDatabase(name, idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const r = idb.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

function defaultPersist() {
  const s = globalThis.navigator && globalThis.navigator.storage;
  return s && typeof s.persist === "function" ? s.persist() : Promise.resolve(false);
}

const S = (tx, name) => tx.objectStore(name);
const getOne = (tx, name, key) => req(S(tx, name).get(key));
const getAllOf = (tx, name) => req(S(tx, name).getAll());
const byBook = (tx, name, id) => req(S(tx, name).index("wordbookId").getAll(id));
const byBookKeys = (tx, name, id) => req(S(tx, name).index("wordbookId").getAllKeys(id));

// 全ストアの全件
async function readEverything(tx) {
  const out = {};
  for (const n of STORE_NAMES) out[n] = await getAllOf(tx, n);
  return out;
}

async function putMeta(tx, key, value) {
  await req(S(tx, "meta").put({ key, value }));
}

async function metaValue(tx, key, fallback = null) {
  const r = await getOne(tx, "meta", key);
  return r === undefined ? fallback : r.value;
}

// 全ストアを data（書き出しファイルの data の形）で置き換える。meta は activeWordbookId だけ書き換える。
async function replaceData(tx, data) {
  for (const k of DATA_KEYS) {
    if (!Array.isArray(data[k])) throw new Error("記録の中に必要な配列がありません（" + k + "）");
  }
  for (const n of DATA_STORES) await req(S(tx, n).clear());
  for (const n of DATA_STORES) {
    for (const rec of data[n]) await req(S(tx, n).put(rec));
  }
  const active = data.meta.find((m) => m && m.key === "activeWordbookId");
  await putMeta(tx, "activeWordbookId", active ? active.value : null);
}

const META_KEYS = ["schemaVersion", "activeWordbookId", "lastExportAt"];

// 状態（仕様 9.3）: status.state は次の4つ。
//   "ready"           ふつう。すべてできる。
//   "migrationFailed" 移行に失敗（元のデータのまま）。読み込み・すべて消す・移行前のデータの書き出しだけできる。
//   "newer"           DB の版がアプリより新しい（meta.schemaVersion が大きい、または open が VersionError）。何も書かない・出さない。
//   "closed"          versionchange が届いて DB を閉じた。何もできない。
// 状態が変わったら options.onStatusChange(status) を呼ぶ（画面に知らせる手段）。
export async function openStore(options = {}) {
  const cfg = {
    dbName: DEFAULT_DB_NAME,
    idb: globalThis.indexedDB,
    schemaVersion: SCHEMA_VERSION,
    migrations: defaultMigrations,
    appVersion: APP_VERSION,
    newId: () => globalThis.crypto.randomUUID(),
    persist: defaultPersist,
    now: null, // 移行が要るときの日時（Date）
    onStatusChange: null,
    ...options,
  };
  const status = { state: "ready", error: null };
  // 状態の変更はすべてここを通す。一度 closed になったら、ほかの状態へ移らない（抜けるのは再読み込みだけ。仕様 9.3）。
  // notify が false のとき（起動の途中）は知らせない（呼び出し側は openStore の戻り値の status を見る）。
  const setState = (state, error = null, notify = true) => {
    if (status.state === "closed") return;
    if (status.state === state && status.error === error) return;
    status.state = state;
    status.error = error;
    if (notify && typeof cfg.onStatusChange === "function") {
      try {
        cfg.onStatusChange(status);
      } catch (e) {
        // 画面側の例外でストアを止めない
      }
    }
  };
  let snapshotSaved = false; // この起動の移行で snapshots に保存できたか（仕様 9.4 の最後）
  const NEWER_MESSAGE = "新しい版のアプリで作ったデータです。アプリを更新してください";

  let db = null;
  try {
    db = await openDb(cfg.idb, cfg.dbName);
  } catch (e) {
    if (e && e.name === "VersionError") {
      setState("newer", NEWER_MESSAGE, false); // 例外にせず、何もできないストアを返す（仕様 9.5）
    } else {
      throw e;
    }
  }
  if (db) {
    db.onversionchange = () => {
      db.close();
      setState("closed", "アプリが更新されました。再読み込みしてください");
    };
  }

  // ---- 起動時: 版の確認と移行 ----
  const stored = db ? await transact(db, ["meta"], "readonly", async (tx) => metaValue(tx, "schemaVersion", null)) : null;
  if (!db) {
    // VersionError。何もしない
  } else if (stored === null) {
    await transact(db, ["meta"], "readwrite", async (tx) => {
      await putMeta(tx, "schemaVersion", cfg.schemaVersion);
      if ((await getOne(tx, "meta", "activeWordbookId")) === undefined) await putMeta(tx, "activeWordbookId", null);
      if ((await getOne(tx, "meta", "lastExportAt")) === undefined) await putMeta(tx, "lastExportAt", null);
    });
  } else if (stored > cfg.schemaVersion) {
    setState("newer", NEWER_MESSAGE, false);
  } else if (stored < cfg.schemaVersion) {
    try {
      await migrateDb(stored);
    } catch (e) {
      setState(
        "migrationFailed",
        "記録の形式の移行に失敗しました（元のデータはそのままです）。記録の書き出しをおすすめします: " + (e && e.message ? e.message : e),
        false,
      );
    }
  }

  // 移行: 全データを読む → snapshots に移行前を保存 → 移行関数を順に適用 → 1つのトランザクションで書き戻す
  async function migrateDb(from) {
    if (!(cfg.now instanceof Date)) throw new Error("移行には日時（now）が必要です");
    const everything = await transact(db, STORE_NAMES, "readonly", readEverything);
    const before = createBackup({ stores: everything, appVersion: cfg.appVersion, exportedAt: isoWithOffset(cfg.now), schemaVersion: from });
    await transact(db, ["snapshots"], "readwrite", (tx) =>
      req(S(tx, "snapshots").put({ key: "beforeMigration", fromVersion: from, createdAt: before.exportedAt, data: before.data })),
    );
    snapshotSaved = true;
    const migrated = migrateData(before.data, from, cfg.schemaVersion, cfg.migrations);
    await transact(db, ["meta", ...DATA_STORES], "readwrite", async (tx) => {
      await replaceData(tx, migrated);
      await putMeta(tx, "schemaVersion", cfg.schemaVersion);
    });
  }

  // 操作ごとの可否（仕様 9.3 の表）。許さない状態ではエラーにする。
  const assertState = (allowed) => {
    if (!allowed.includes(status.state)) throw new Error(status.error || "いまの状態ではできません（" + status.state + "）");
  };
  const READY = ["ready"];
  const READY_OR_FAILED = ["ready", "migrationFailed"]; // 読み込み・すべて消す・書き出し
  const openDbOrThrow = () => {
    if (!db || status.state === "closed") throw new Error(status.error || "データベースを開けません");
    return db;
  };
  const read = (names, fn) => transact(openDbOrThrow(), names, "readonly", fn);
  const write = (names, fn) => {
    assertState(READY);
    return transact(openDbOrThrow(), names, "readwrite", fn);
  };

  // 確定の共通処理: 確定の前にまとまり（または session）が確定しようとしているものと同じかを確かめ、
  // 同じなら 語・単語帳・まとまり・結果・session を同じトランザクションで書く。
  async function confirmIn(tx, { kind, block, expected, session, answers, now }) {
    const book = await getOne(tx, "wordbooks", block.wordbookId);
    if (!book) throw new Error("まとまりの単語帳がありません");
    const sourceBook = book.kind === "nigate" ? await getOne(tx, "wordbooks", book.sourceId) : book;
    if (!sourceBook) throw new Error("苦手の単語帳の元の単語帳がありません");
    let nigateBook = book.kind === "nigate" ? book : null;
    if (!nigateBook) {
      const all = await getAllOf(tx, "wordbooks");
      nigateBook = all.find((b) => b.kind === "nigate" && b.sourceId === sourceBook.id) || null;
    }
    const words = [];
    if (Array.isArray(answers)) {
      for (const a of answers) {
        if (Array.isArray(a) && a[1] === 0) {
          const w = await getOne(tx, "words", [sourceBook.id, a[0]]);
          if (w) words.push(w);
        }
      }
    }
    const r = confirmTest({
      kind, block, expected, session, answers,
      day: studyDay(now), nowIso: isoWithOffset(now), // 学習日は確定した時のもの（仕様 3.1）
      words, sourceBook, nigateBook, newNigateId: cfg.newId(),
    });
    if (!r.applied) return r;
    await req(S(tx, "blocks").put(r.block));
    for (const w of r.words) await req(S(tx, "words").put(w));
    if (r.nigateBook) await req(S(tx, "wordbooks").put(r.nigateBook));
    let resultId = null;
    if (r.result) resultId = await req(S(tx, "results").add(r.result));
    if (r.deleteSession) await req(S(tx, "session").delete("review"));
    return { ...r, resultId };
  }

  const CONFIRM_STORES = ["blocks", "words", "wordbooks", "results", "session"];

  // 書き込みの二重実行を防ぐ: 同じ操作が処理中のとき、2回目は新しく始めず、処理中のものの結果を返す（連打の対策）
  const inflight = new Map();
  const single = (key, fn) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => fn())().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  const store = {
    status,
    config: cfg,
    close() {
      if (db) db.close();
    },

    // ---- 読む ----
    async getMeta() {
      const rows = await read(["meta"], (tx) => getAllOf(tx, "meta"));
      const m = { schemaVersion: null, activeWordbookId: null, lastExportAt: null };
      for (const r of rows) m[r.key] = r.value;
      return m;
    },
    async readAll() {
      return read(STORE_NAMES, readEverything);
    },
    async listWordbooks() {
      return orderWordbooks(await read(["wordbooks"], (tx) => getAllOf(tx, "wordbooks")));
    },
    async getWordbook(id) {
      return (await read(["wordbooks"], (tx) => getOne(tx, "wordbooks", id))) || null;
    },
    // 語の一覧（番号順）。苦手の単語帳は、元の単語帳の語のうち members の語を返す。
    async getWords(wordbookId) {
      return read(["wordbooks", "words"], async (tx) => {
        const book = await getOne(tx, "wordbooks", wordbookId);
        if (!book) return [];
        if (book.kind === "nigate") {
          const out = [];
          for (const no of book.members) {
            const w = await getOne(tx, "words", [book.sourceId, no]);
            if (w) out.push(w);
          }
          return out.sort((a, b) => a.no - b.no);
        }
        return (await byBook(tx, "words", wordbookId)).sort((a, b) => a.no - b.no);
      });
    },
    async listBlocks(wordbookId = null) {
      const list = await read(["blocks"], (tx) => (wordbookId === null ? getAllOf(tx, "blocks") : byBook(tx, "blocks", wordbookId)));
      return list.sort((a, b) => (a.wordbookId < b.wordbookId ? -1 : a.wordbookId > b.wordbookId ? 1 : a.seq - b.seq));
    },
    async getBlock(id) {
      return (await read(["blocks"], (tx) => getOne(tx, "blocks", id))) || null;
    },
    async listResults(wordbookId = null) {
      return read(["results"], (tx) => (wordbookId === null ? getAllOf(tx, "results") : byBook(tx, "results", wordbookId)));
    },
    async getSession() {
      return (await read(["session"], (tx) => getOne(tx, "session", "review"))) || null;
    },
    async hasSnapshot() {
      return (await read(["snapshots"], (tx) => getOne(tx, "snapshots", "beforeMigration"))) !== undefined;
    },

    // ---- 単語帳（6章） ----
    async setActiveWordbook(id) {
      await write(["meta", "wordbooks"], async (tx) => {
        const b = await getOne(tx, "wordbooks", id);
        if (!b || b.kind !== "normal") throw new Error("使う単語帳にできるのはふつうの単語帳だけです");
        await putMeta(tx, "activeWordbookId", id);
      });
    },

    // 新しく取り込む。csvWords は parseWordsCsv の words。使う単語帳にする。初めてなら persist() を求める。
    async importNew({ csvWords, fileName, name, now }) {
      if (!Array.isArray(csvWords) || csvWords.length === 0) throw new Error("語がありません");
      const nowIso = isoWithOffset(now);
      const id = cfg.newId();
      const wordbook = {
        id, kind: "normal", name: name || wordbookNameFromFile(fileName), sourceId: null, members: null,
        createdAt: nowIso, updatedAt: nowIso, fileName,
      };
      const first = await write(["meta", "wordbooks", "words"], async (tx) => {
        const first = !(await getAllOf(tx, "wordbooks")).some((b) => b.kind === "normal");
        await req(S(tx, "wordbooks").put(wordbook));
        for (const w of buildWordRecords(id, csvWords)) await req(S(tx, "words").put(w));
        await putMeta(tx, "activeWordbookId", id);
        return first;
      });
      let persisted = null;
      if (first) {
        try {
          persisted = await cfg.persist(); // 結果によらず続ける
        } catch (e) {
          persisted = false;
        }
      }
      return { wordbook, persisted };
    },

    // 取り込み直しの差分（書き込まない）
    async previewReimport({ wordbookId, csvWords }) {
      const existing = await read(["words"], (tx) => byBook(tx, "words", wordbookId));
      return diffImport(existing, csvWords);
    },

    // 取り込み直す。番号で照合し、単語帳で変えるのは fileName・updatedAt だけ（createdAt は変えない。仕様 6.2）
    async reimport({ wordbookId, csvWords, fileName, now }) {
      const nowIso = isoWithOffset(now);
      return write(["wordbooks", "words"], async (tx) => {
        const book = await getOne(tx, "wordbooks", wordbookId);
        if (!book || book.kind !== "normal") throw new Error("取り込み直せるのはふつうの単語帳だけです");
        const existing = await byBook(tx, "words", wordbookId);
        const { diff, upserts } = applyImport(wordbookId, existing, csvWords);
        for (const w of upserts) await req(S(tx, "words").put(w));
        await req(S(tx, "wordbooks").put({ ...book, fileName, updatedAt: nowIso }));
        return diff;
      });
    },

    // ふつうの単語帳を消す。語・まとまり・記録・苦手の単語帳・（それらのまとまりの）進行中の復習も消える。
    async deleteWordbook({ wordbookId }) {
      return write(STORE_NAMES.filter((n) => n !== "snapshots"), async (tx) => {
        const book = await getOne(tx, "wordbooks", wordbookId);
        if (!book) return { deleted: false };
        if (book.kind !== "normal") throw new Error("苦手の単語帳だけを消すことはできません");
        const all = await getAllOf(tx, "wordbooks");
        const ids = [wordbookId, ...all.filter((b) => b.kind === "nigate" && b.sourceId === wordbookId).map((b) => b.id)];
        const blockIds = new Set();
        for (const id of ids) {
          for (const k of await byBookKeys(tx, "words", id)) await req(S(tx, "words").delete(k));
          for (const k of await byBookKeys(tx, "blocks", id)) {
            blockIds.add(k);
            await req(S(tx, "blocks").delete(k));
          }
          for (const k of await byBookKeys(tx, "results", id)) await req(S(tx, "results").delete(k));
          await req(S(tx, "wordbooks").delete(id));
        }
        const session = await getOne(tx, "session", "review");
        if (session && blockIds.has(session.blockId)) await req(S(tx, "session").delete("review"));
        const active = await metaValue(tx, "activeWordbookId", null);
        if (ids.includes(active)) {
          const rest = orderWordbooks((await getAllOf(tx, "wordbooks")).filter((b) => b.kind === "normal"));
          await putMeta(tx, "activeWordbookId", rest.length ? rest[0].id : null);
        }
        return { deleted: true, removedWordbookIds: ids };
      });
    },

    // ---- 学習（2章） ----
    // 新しく覚える: 学習中のまとまりがあればその続き。無ければ、まだまとまりに入っていない語から次のまとまりを作る。
    async startBlock({ wordbookId, now }) {
      return write(["wordbooks", "words", "blocks"], async (tx) => {
        const book = await getOne(tx, "wordbooks", wordbookId);
        if (!book) throw new Error("単語帳がありません");
        const blocks = await byBook(tx, "blocks", wordbookId);
        const learning = blocks.find((b) => b.status === "learning");
        if (learning) return { created: false, block: learning };
        const allNos = book.kind === "nigate" ? book.members : (await byBookKeys(tx, "words", wordbookId)).map((k) => k[1]);
        const nos = pickNextNos(allNos, blocks.flatMap((b) => b.nos));
        if (nos.length === 0) return { created: false, block: null, reason: "noWords" };
        const seq = blocks.reduce((m, b) => Math.max(m, b.seq), 0) + 1;
        const block = createBlock({ wordbookId, seq, nos, startedAt: isoWithOffset(now) });
        await req(S(tx, "blocks").put(block));
        return { created: true, block };
      });
    },

    // テストの途中の保存（並び・判定・答えを見たか）。工程が違えば何もしない。
    async saveStepState({ blockId, expectedStepIndex, stepState }) {
      return write(["blocks"], async (tx) => {
        const block = await getOne(tx, "blocks", blockId);
        const step = block && block.steps[block.stepIndex];
        if (!block || block.status !== "learning" || block.stepIndex !== expectedStepIndex || !step || step.type !== "test") {
          return { applied: false, reason: "stale" };
        }
        await req(S(tx, "blocks").put({ ...block, stepState }));
        return { applied: true };
      });
    },

    // 覚える工程を終えて次へ
    async finishLearnStep({ blockId, expectedStepIndex }) {
      return write(["blocks"], async (tx) => {
        const block = await getOne(tx, "blocks", blockId);
        if (!block) return { applied: false, reason: "stale" };
        const r = advanceLearn(block, expectedStepIndex);
        if (r.applied) await req(S(tx, "blocks").put(r.block));
        return r;
      });
    },

    // 学習の工程のテストの確定（段階1・2は何も数えず次の工程へ、段階3・4は数える）
    async confirmStepTest({ blockId, expectedStepIndex, answers, now }) {
      return write(CONFIRM_STORES, async (tx) => {
        const block = await getOne(tx, "blocks", blockId);
        if (!block) return { applied: false, reason: "stale" };
        return confirmIn(tx, { kind: "step", block, expected: { stepIndex: expectedStepIndex }, session: null, answers, now });
      });
    },

    async restartBlock({ blockId }) {
      return write(["blocks"], async (tx) => {
        const block = await getOne(tx, "blocks", blockId);
        if (!block) throw new Error("まとまりがありません");
        const b = restartBlock(block);
        await req(S(tx, "blocks").put(b));
        return b;
      });
    },

    // ---- 復習（3章） ----
    // 復習を始める。記録の種類（r1・r2・free）は始めた時の学習日で決めて session.kind に入れる（仕様 3.4）。
    // 進行中の復習があるときは、replace が true でなければ何もしない（確かめた後に replace: true で捨てて始める）。
    async startReview({ blockId, rng, now, replace = false }) {
      return write(["blocks", "session"], async (tx) => {
        const block = await getOne(tx, "blocks", blockId);
        if (!block || block.status !== "done") return { started: false, reason: "notDone" };
        const existing = await getOne(tx, "session", "review");
        const kind = reviewKindFor(block, studyDay(now));
        if (existing && !replace) {
          // 進行中の復習と同じもの（同じまとまり・同じ種類）は、確かめずに続きから再開する（仕様 3.3。判定を捨てない）
          if (existing.blockId === blockId && existing.kind === kind) return { started: true, resumed: true, session: existing };
          return { started: false, reason: "inProgress", session: existing };
        }
        const session = newSession({ kind, block, order: shuffle(block.nos, rng), nowIso: isoWithOffset(now) });
        await req(S(tx, "session").put(session));
        return { started: true, session };
      });
    },

    // 復習の途中の保存。始めたもの（startedAt）が違えば何もしない。
    async saveSession({ expectedStartedAt, answers, revealed, now }) {
      return write(["session"], async (tx) => {
        const s = await getOne(tx, "session", "review");
        if (!s || s.startedAt !== expectedStartedAt) return { applied: false, reason: "stale" };
        const next = { ...s, answers: answers.map((a) => [a[0], a[1]]), revealed: !!revealed, updatedAt: isoWithOffset(now) };
        await req(S(tx, "session").put(next));
        return { applied: true, session: next };
      });
    },

    async discardSession() {
      await write(["session"], (tx) => req(S(tx, "session").delete("review")));
    },

    // 復習の確定。学習日は確定した時のもの、種類は session.kind（始めた時に決めたもの）。
    async confirmReview({ expectedStartedAt, answers, now }) {
      return write(CONFIRM_STORES, async (tx) => {
        const session = await getOne(tx, "session", "review");
        if (!session) return { applied: false, reason: "stale" };
        const block = await getOne(tx, "blocks", session.blockId);
        if (!block) return { applied: false, reason: "stale" };
        return confirmIn(tx, { kind: session.kind, block, expected: { startedAt: expectedStartedAt }, session, answers, now });
      });
    },

    // ---- 書き出し・読み込み（8章） ----
    // 書き出す内容を作る。lastExportAt は、保存できたあとに markExported で更新する。
    async exportBackup({ now }) {
      assertState(READY); // 移行に失敗した状態の書き出しは exportSnapshot だけ（仕様 9.3）
      const stores = await read(STORE_NAMES, readEverything);
      const meta = Object.fromEntries(stores.meta.map((m) => [m.key, m.value]));
      const backup = createBackup({
        stores, appVersion: cfg.appVersion, exportedAt: isoWithOffset(now),
        schemaVersion: Number.isInteger(meta.schemaVersion) ? meta.schemaVersion : cfg.schemaVersion,
      });
      return { backup, text: serializeBackup(backup), fileName: backupFileName(now) };
    },
    async markExported({ now }) {
      await write(["meta"], (tx) => putMeta(tx, "lastExportAt", isoWithOffset(now)));
    },
    // 書き出しファイルの文字列で、今のデータを全部置き換える（now は読み込んだ時刻の Date。lastExportAt になる）。
    // 点検でエラーなら何も変えない。ふつうの状態か移行に失敗した状態で使え、成功したらふつうの状態になる（仕様 8.2・9.3）。
    async importBackup(text, now) {
      assertState(READY_OR_FAILED);
      if (!(now instanceof Date)) throw new Error("読み込みには日時（now）が必要です");
      const r = inspectBackup(text, { currentVersion: cfg.schemaVersion, table: cfg.migrations });
      if (!r.ok) return { ok: false, errors: r.errors };
      try {
        await transact(openDbOrThrow(), ["meta", ...DATA_STORES, "snapshots"], "readwrite", async (tx) => {
          await replaceData(tx, r.data);
          await req(S(tx, "snapshots").clear());
          await req(S(tx, "meta").clear());
          await putMeta(tx, "schemaVersion", cfg.schemaVersion);
          await putMeta(tx, "activeWordbookId", r.activeWordbookId);
          await putMeta(tx, "lastExportAt", isoWithOffset(now));
        });
      } catch (e) {
        return { ok: false, errors: ["読み込み中にエラーが起きたため、何も変えていません: " + (e && e.message ? e.message : e)] };
      }
      snapshotSaved = false;
      setState("ready");
      return { ok: true, summary: r.summary };
    },
    // データをすべて消す（仕様 8.4）。全ストアを1つのトランザクションで空にし、meta の3件だけを書く。deleteDatabase は使わない。
    async deleteAll() {
      assertState(READY_OR_FAILED);
      await transact(openDbOrThrow(), STORE_NAMES, "readwrite", async (tx) => {
        for (const n of STORE_NAMES) await req(S(tx, n).clear());
        await putMeta(tx, "schemaVersion", cfg.schemaVersion);
        await putMeta(tx, "activeWordbookId", null);
        await putMeta(tx, "lastExportAt", null);
      });
      snapshotSaved = false;
      setState("ready");
    },
    // 移行前のデータを書き出しファイルの形で返す（仕様 9.4）。{backup, text, fileName}。lastExportAt は更新しない。
    // ふつうの状態: snapshots が無ければ null。
    // 移行に失敗した状態: その起動の移行で snapshots に保存できていればそれ。保存できなかったときは端末の今のデータ
    // （元の版のまま）を同じ形で書き出す（now が要る。古い snapshots が残っていても使わない）。
    async exportSnapshot({ now } = {}) {
      assertState(READY_OR_FAILED);
      const snap = await read(["snapshots"], (tx) => getOne(tx, "snapshots", "beforeMigration"));
      if (status.state === "ready" || snapshotSaved) {
        return snap ? snapshotToBackup(snap, cfg.appVersion) : null;
      }
      if (!(now instanceof Date)) throw new Error("書き出しには日時（now）が必要です");
      const stores = await read(STORE_NAMES, readEverything);
      const meta = Object.fromEntries(stores.meta.map((m) => [m.key, m.value]));
      const fromVersion = Number.isInteger(meta.schemaVersion) ? meta.schemaVersion : cfg.schemaVersion;
      const createdAt = isoWithOffset(now);
      const data = createBackup({ stores, appVersion: cfg.appVersion, exportedAt: createdAt, schemaVersion: fromVersion }).data;
      return snapshotToBackup({ key: "beforeMigration", fromVersion, createdAt, data }, cfg.appVersion);
    },
  };
  // 取り込み・取り込み直し・単語帳を消す・読み込み・すべて消すは、処理中の二重実行をしない（連打の対策）
  const SINGLE = {
    importNew: () => "importNew",
    reimport: (a) => "reimport:" + (a && a.wordbookId),
    deleteWordbook: (a) => "deleteWordbook:" + (a && a.wordbookId),
    importBackup: () => "importBackup",
    deleteAll: () => "deleteAll",
  };
  for (const [name, keyOf] of Object.entries(SINGLE)) {
    const f = store[name];
    store[name] = (...args) => single(keyOf(...args), () => f.apply(store, args));
  }
  return store;
}
