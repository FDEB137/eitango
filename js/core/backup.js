// 書き出しファイルの作成と点検（docs/shiyou.md 8章）。純粋な関数だけ。
import { SCHEMA_VERSION, migrations, migrateData } from "./migrate.js";
import { orderWordbooks } from "./review.js";

export const BACKUP_FORMAT = "eitango-backup";
export const DATA_KEYS = ["meta", "wordbooks", "words", "blocks", "results", "session"];

const pad = (n) => String(n).padStart(2, "0");

// ファイル名 eitango-kiroku-YYYYMMDD-HHMM.json（現地時刻）
export function backupFileName(date) {
  return (
    "eitango-kiroku-" + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) +
    "-" + pad(date.getHours()) + pad(date.getMinutes()) + ".json"
  );
}

// 移行前のデータの書き出しのファイル名 eitango-ikoumae-v<fromVersion>-YYYYMMDD-HHMM.json（日時は date の現地時刻。仕様 9.4）
export function snapshotFileName(fromVersion, date) {
  return backupFileName(date).replace("eitango-kiroku-", "eitango-ikoumae-v" + fromVersion + "-");
}

// 移行前のデータ（snapshots の1件 {key, fromVersion, createdAt, data}）を、書き出しファイルの形にする（仕様 9.4）。
// exportedAt = createdAt、schemaVersion = fromVersion、ファイル名の日時は createdAt の現地時刻。
export function snapshotToBackup(snapshot, appVersion) {
  const backup = {
    format: BACKUP_FORMAT, schemaVersion: snapshot.fromVersion, appVersion,
    exportedAt: snapshot.createdAt, data: snapshot.data,
  };
  return { backup, text: serializeBackup(backup), fileName: snapshotFileName(snapshot.fromVersion, new Date(snapshot.createdAt)) };
}

// 書き出す内容を作る。stores は各ストアの全件（meta は {key, value} の配列。snapshots は渡さない）。
// meta には activeWordbookId だけを入れる（schemaVersion はファイルの最上位、lastExportAt は入れない）。
export function createBackup({ stores, appVersion, exportedAt, schemaVersion = SCHEMA_VERSION }) {
  const data = {};
  for (const k of DATA_KEYS) {
    const list = stores[k] || [];
    data[k] = JSON.parse(JSON.stringify(k === "meta" ? list.filter((m) => m.key === "activeWordbookId") : list));
  }
  return { format: BACKUP_FORMAT, schemaVersion, appVersion, exportedAt, data };
}

export function serializeBackup(backup) {
  return JSON.stringify(backup);
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function checkReferences(data) {
  const errs = [];
  const add = (m) => {
    if (errs.length < 10) errs.push(m);
  };
  const books = new Map();
  for (const b of data.wordbooks) {
    if (!isObj(b) || typeof b.id !== "string" || (b.kind !== "normal" && b.kind !== "nigate")) {
      add("単語帳の記録の形が正しくありません");
      continue;
    }
    if (books.has(b.id)) add("単語帳の id が重なっています");
    books.set(b.id, b);
  }
  const wordKeys = new Set();
  const wordCount = new Map();
  for (const w of data.words) {
    if (!isObj(w) || !Number.isInteger(w.no)) {
      add("語の記録の形が正しくありません");
      continue;
    }
    const b = books.get(w.wordbookId);
    if (!b || b.kind !== "normal") {
      add("語の持ち主の単語帳がありません（番号 " + w.no + "）");
      continue;
    }
    const key = w.wordbookId + "\u0000" + w.no;
    if (wordKeys.has(key)) add("同じ語が重なっています（" + b.name + " の番号 " + w.no + "）");
    wordKeys.add(key);
    wordCount.set(w.wordbookId, (wordCount.get(w.wordbookId) || 0) + 1);
  }
  const wordsOwner = (book) => (book.kind === "nigate" ? book.sourceId : book.id);
  const hasWord = (book, no) => wordKeys.has(wordsOwner(book) + "\u0000" + no);
  for (const b of books.values()) {
    if (b.kind === "normal") {
      if (!wordCount.get(b.id)) add("語が1つも無い単語帳があります（" + b.name + "）");
    } else {
      const src = books.get(b.sourceId);
      if (!src || src.kind !== "normal") {
        add("苦手の単語帳の元の単語帳がありません（" + b.name + "）");
        continue;
      }
      if (!Array.isArray(b.members) || b.members.some((n) => !hasWord(b, n))) {
        add("苦手の単語帳に、元の単語帳に無い番号があります（" + b.name + "）");
      }
    }
  }
  const blockIds = new Set();
  for (const bl of data.blocks) {
    if (!isObj(bl) || typeof bl.id !== "string" || !Array.isArray(bl.nos)) {
      add("まとまりの記録の形が正しくありません");
      continue;
    }
    if (blockIds.has(bl.id)) add("まとまりの id が重なっています");
    blockIds.add(bl.id);
    const book = books.get(bl.wordbookId);
    if (!book) {
      add("まとまりの持ち主の単語帳がありません（" + bl.id + "）");
      continue;
    }
    if (bl.nos.some((n) => !hasWord(book, n))) add("まとまりの番号に語がありません（" + bl.id + "）");
  }
  const resultIds = new Set();
  for (const r of data.results) {
    if (!isObj(r)) {
      add("結果の記録の形が正しくありません");
      continue;
    }
    if (resultIds.has(r.id)) add("結果の id が重なっています");
    resultIds.add(r.id);
    if (!books.has(r.wordbookId) || !blockIds.has(r.blockId)) add("結果の持ち主の単語帳かまとまりがありません");
  }
  if (data.session.length > 1) add("進行中の復習が2件以上あります");
  for (const s of data.session) {
    if (!isObj(s) || s.key !== "review" || !blockIds.has(s.blockId)) add("進行中の復習のまとまりがありません");
  }
  // 使う単語帳の点検（仕様 8.2 の表）。行が無いときは null と同じ。
  const row = data.meta.find((m) => isObj(m) && m.key === "activeWordbookId");
  let active = row ? row.value : null;
  if (active === undefined) active = null;
  if (active !== null) {
    const b = typeof active === "string" ? books.get(active) : undefined;
    if (!b) add("使う単語帳がありません");
    else if (b.kind !== "normal") add("使う単語帳が苦手の単語帳になっています");
  } else {
    // 6.4 の決まり: ふつうの単語帳のうち createdAt の古い順、同じなら id の順の先頭。無ければ null
    // 日時（Date.parse）で比べる。単語帳の削除（6.4）と同じ orderWordbooks を使う
    const normals = orderWordbooks(Array.from(books.values()).filter((b) => b.kind === "normal"));
    active = normals.length ? normals[0].id : null;
  }
  return { errs, books, wordCount, active };
}

// 書き出しファイルの文字列を点検する。エラーなら何も読み込まない。
// 戻り値 {ok, errors: [message], data（今の版にそろえた data。エラーなら null）, schemaVersion, summary}
//   summary: {exportedAt, appVersion, wordbooks: [{name, kind, wordCount}], doneBlocks}
export function inspectBackup(text, { currentVersion = SCHEMA_VERSION, table = migrations } = {}) {
  const bad = (message) => ({ ok: false, errors: [message], data: null, schemaVersion: null, summary: null });
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return bad("JSON として読めません。書き出したファイルではないようです");
  }
  if (!isObj(obj) || obj.format !== BACKUP_FORMAT) return bad("このアプリの書き出しファイルではありません");
  const v = obj.schemaVersion;
  if (!Number.isInteger(v) || v < 1) return bad("記録の版が正しくありません");
  if (v > currentVersion) return bad("新しい版のアプリで作ったファイルです。アプリを更新してから読み込んでください");
  if (!isObj(obj.data)) return bad("記録の本体（data）がありません");

  let data = obj.data;
  if (v < currentVersion) {
    try {
      data = migrateData(data, v, currentVersion, table);
    } catch (e) {
      return bad("古い形式のファイルを今の形式に変換できませんでした");
    }
  }
  for (const k of DATA_KEYS) {
    if (!isObj(data) || !Array.isArray(data[k])) return bad("記録の中に必要な配列がありません（" + k + "）");
  }
  const { errs, books, wordCount, active } = checkReferences(data);
  if (errs.length) return { ok: false, errors: errs, data: null, schemaVersion: v, summary: null };
  // 使う単語帳を補った（または確かめた）値にする。元の data は書き換えない。
  const filled = {
    ...data,
    meta: [...data.meta.filter((m) => !(isObj(m) && m.key === "activeWordbookId")), { key: "activeWordbookId", value: active }],
  };
  return {
    ok: true,
    errors: [],
    data: filled,
    activeWordbookId: active,
    schemaVersion: v,
    summary: {
      exportedAt: obj.exportedAt || null,
      appVersion: obj.appVersion || null,
      wordbooks: Array.from(books.values()).map((b) => ({
        name: b.name, kind: b.kind, wordCount: b.kind === "normal" ? wordCount.get(b.id) || 0 : (b.members || []).length,
      })),
      doneBlocks: data.blocks.filter((b) => b.status === "done").length,
    },
  };
}
