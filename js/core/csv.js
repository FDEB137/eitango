// CSV の読み取り・点検・取り込み直しの差分（docs/csv.md 1〜4章、docs/shiyou.md 6章）。純粋な関数だけ。
// 文字列は DOM に触れずに返す（表示側が textContent で入れる）。

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_WORDS = 10000;

// 列名（NFKC・空白を除いたもの）→ 語のキー
const COLUMNS = [
  ["番号", "no"],
  ["英単語", "word"],
  ["品詞", "pos"],
  ["意味", "meaning"],
  ["類語", "syn"],
  ["対義語", "ant"],
  ["同じ語源の単語", "ety"],
  ["語句", "expr"],
  ["備考", "note"],
  ["類語（AI）", "synAi"],
  ["対義語（AI）", "antAi"],
  ["同じ語源の単語（AI）", "etyAi"],
  ["要確認", "check"],
];
const REQUIRED = ["番号", "英単語", "意味"];
export const CONTENT_KEYS = COLUMNS.slice(1).map((c) => c[1]);

export function normalizeColumnName(s) {
  return String(s).normalize("NFKC").replace(/\s+/g, "");
}
const KEY_BY_NORM = new Map(COLUMNS.map(([name, key]) => [normalizeColumnName(name), key]));
const NAME_BY_KEY = new Map(COLUMNS.map(([name, key]) => [key, name]));

// バイト列を文字列にする。UTF-8（BOM あり・なし）として読めなければ Shift_JIS。
export function decodeBytes(input) {
  if (typeof input === "string") return { text: input.replace(/^\uFEFF/, ""), encoding: "utf-8" };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ""), encoding: "utf-8" };
  } catch (e) {
    return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };
  }
}

// CSV の文字列を行（セルの配列）に分ける。行の区切りは CRLF・LF・CR。空の行は飛ばす。
// 戻り値 {rows: [{line, cells}], unclosedLine: 閉じていない " の行番号か null}
export function splitCsv(text) {
  const rows = [];
  let cells = [];
  let cell = "";
  let inQuote = false;
  let quoted = false; // 今のセルが " で始まったか
  let line = 1;
  let rowLine = 1;
  let quoteLine = 0;
  const endRow = () => {
    cells.push(cell);
    // すべてのセルが空（前後の空白を除くと空）の行は、列の数・引用符によらず飛ばす（docs/csv.md 3章）
    const empty = cells.every((c) => c.trim() === "");
    if (!empty) rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
    quoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        if (c === "\n") line++;
        else if (c === "\r") {
          if (text[i + 1] === "\n") i++;
          line++;
          cell += "\n";
          continue;
        }
        cell += c;
      }
    } else if (c === '"' && cell === "" && !quoted) {
      inQuote = true;
      quoted = true;
      quoteLine = line;
    } else if (c === ",") {
      cells.push(cell);
      cell = "";
      quoted = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += c;
    }
  }
  if (inQuote) return { rows, unclosedLine: quoteLine };
  if (cell !== "" || cells.length > 0 || quoted) endRow();
  return { rows, unclosedLine: null };
}

function rangesOf(nos) {
  // 昇順の番号から、飛んでいる番号の範囲 [[from, to], ...] を作る
  const out = [];
  for (let i = 1; i < nos.length; i++) {
    if (nos[i] - nos[i - 1] > 1) out.push([nos[i - 1] + 1, nos[i] - 1]);
  }
  return out;
}

function rangeText(r) {
  return r[0] === r[1] ? String(r[0]) : r[0] + "〜" + r[1];
}

// アプリが取り込む CSV を読んで点検する。
// 戻り値 {ok, errors: [{line, message}], warnings: [message], words, encoding, summary}
//   words: [{no, word, pos, meaning, syn, ant, ety, expr, note, synAi, antAi, etyAi, check}]（番号の昇順。エラーがあれば空）
//   summary: {count, minNo, maxNo, gaps: [[from, to]], aiCount, checkCount}
export function parseWordsCsv(input) {
  const errors = [];
  const warnings = [];
  const fail = (line, message) => errors.push({ line, message });
  const result = (words, encoding, summary) => ({ ok: errors.length === 0, errors, warnings, words: errors.length ? [] : words, encoding, summary });
  const emptySummary = { count: 0, minNo: null, maxNo: null, gaps: [], aiCount: 0, checkCount: 0 };

  const size = typeof input === "string" ? new TextEncoder().encode(input).length : input.byteLength;
  if (size > MAX_BYTES) {
    fail(null, "ファイルが大きすぎます（5MB を超えています）");
    return result([], "utf-8", emptySummary);
  }
  const { text, encoding } = decodeBytes(input);
  if (encoding === "shift_jis") {
    warnings.push("Shift_JIS として読みました。表計算ソフトでは『CSV UTF-8』で保存すると確実です");
  }
  const { rows, unclosedLine } = splitCsv(text);
  if (unclosedLine !== null) {
    fail(unclosedLine, "ダブルクォート（\"）が閉じていません");
    return result([], encoding, emptySummary);
  }
  if (rows.length === 0) {
    fail(null, "データの行がありません");
    return result([], encoding, emptySummary);
  }

  // 列名の行
  const head = rows[0];
  const keyAt = []; // 列の位置 → キー（知らない列は null）
  const seen = new Map();
  const unknown = [];
  head.cells.forEach((raw, i) => {
    const norm = normalizeColumnName(raw);
    const key = KEY_BY_NORM.get(norm) || null;
    keyAt.push(key);
    if (key === null) unknown.push(raw.trim());
    else if (seen.has(key)) fail(head.line, "同じ列名が2つあります: " + NAME_BY_KEY.get(key));
    else seen.set(key, i);
  });
  for (const name of REQUIRED) {
    if (!seen.has(KEY_BY_NORM.get(normalizeColumnName(name)))) fail(head.line, "必須の列「" + name + "」がありません");
  }
  if (errors.length) return result([], encoding, emptySummary);
  if (unknown.length) {
    warnings.push("知らない列は無視します: " + unknown.map((u) => (u === "" ? "（列名なし）" : u)).join("、"));
  }

  const data = rows.slice(1);
  if (data.length === 0) {
    fail(null, "データの行がありません");
    return result([], encoding, emptySummary);
  }
  if (data.length > MAX_WORDS) {
    fail(null, "語が多すぎます（" + MAX_WORDS + "語を超えています）");
    return result([], encoding, emptySummary);
  }

  const words = [];
  const lineByNo = new Map();
  for (const row of data) {
    if (row.cells.length !== head.cells.length) {
      fail(row.line, "列の数が列名の行と違います（" + row.cells.length + "列。列名の行は" + head.cells.length + "列）");
      continue;
    }
    const w = { no: 0, word: "", pos: "", meaning: "", syn: "", ant: "", ety: "", expr: "", note: "", synAi: "", antAi: "", etyAi: "", check: "" };
    row.cells.forEach((v, i) => {
      const key = keyAt[i];
      if (key && key !== "no") w[key] = v.trim();
    });
    const noText = row.cells[seen.get("no")].trim();
    let bad = false;
    if (noText === "") {
      fail(row.line, "番号が空です");
      bad = true;
    } else if (!/^[0-9]+$/.test(noText) || !Number.isSafeInteger(Number(noText)) || Number(noText) < 1) {
      fail(row.line, "番号が1以上の整数ではありません: " + noText);
      bad = true;
    } else {
      w.no = Number(noText);
      if (lineByNo.has(w.no)) {
        fail(row.line, "番号 " + w.no + " が重なっています（" + lineByNo.get(w.no) + "行目にもあります）");
        bad = true;
      } else {
        lineByNo.set(w.no, row.line);
      }
    }
    if (w.word === "") {
      fail(row.line, "英単語が空です");
      bad = true;
    }
    if (w.meaning === "") {
      fail(row.line, "意味が空です");
      bad = true;
    }
    if (!bad) words.push(w);
  }
  if (errors.length) return result([], encoding, emptySummary);

  words.sort((a, b) => a.no - b.no);
  const nos = words.map((w) => w.no);
  const gaps = rangesOf(nos);
  const aiCount = words.filter((w) => w.synAi || w.antAi || w.etyAi).length;
  const checkCount = words.filter((w) => w.check).length;
  if (gaps.length) warnings.push("番号が飛んでいます: " + gaps.map(rangeText).join("、"));
  if (checkCount) warnings.push("要確認のメモがある語が " + checkCount + " 語あります");
  return result(words, encoding, { count: words.length, minNo: nos[0], maxNo: nos[nos.length - 1], gaps, aiCount, checkCount });
}

// ファイル名から単語帳名の初期値を作る（拡張子を除く）
export function wordbookNameFromFile(fileName) {
  const base = String(fileName).split(/[\\/]/).pop();
  return base.replace(/\.[^.]*$/, "") || base;
}

// 新しく取り込むときの語の記録（wordbookId・miss・nigateDay を足す）
export function buildWordRecords(wordbookId, csvWords) {
  return csvWords.map((w) => ({ wordbookId, ...w, miss: 0, nigateDay: null }));
}

const sameContent = (a, b) => CONTENT_KEYS.every((k) => (a[k] || "") === (b[k] || ""));

// 取り込み直しの差分（番号で照合する。docs/shiyou.md 6.2）
//   existing: 今の語の記録、csvWords: 新しい CSV の語
//   added: 新しい番号の語、changed: 内容が変わる語 [{no, before, after}]、
//   wordChanged: 英単語そのものが変わる語 [{no, from, to}]、missing: CSV に無い番号（残す）
export function diffImport(existing, csvWords) {
  const old = new Map(existing.map((w) => [w.no, w]));
  const added = [];
  const changed = [];
  const wordChanged = [];
  const inCsv = new Set();
  for (const w of csvWords) {
    inCsv.add(w.no);
    const o = old.get(w.no);
    if (!o) {
      added.push(w);
    } else if (!sameContent(o, w)) {
      changed.push({ no: w.no, before: o, after: w });
      if (o.word !== w.word) wordChanged.push({ no: w.no, from: o.word, to: w.word });
    }
  }
  const missing = existing.filter((w) => !inCsv.has(w.no)).map((w) => w.no).sort((a, b) => a - b);
  return { added, changed, wordChanged, missing };
}

// 差分を適用した語の記録（書き込む分だけ）。追加は miss 0、変更は miss・nigateDay をそのまま残す。
export function applyImport(wordbookId, existing, csvWords) {
  const diff = diffImport(existing, csvWords);
  const old = new Map(existing.map((w) => [w.no, w]));
  const upserts = [
    ...buildWordRecords(wordbookId, diff.added),
    ...diff.changed.map((c) => {
      const o = old.get(c.no);
      const next = { ...o };
      for (const k of CONTENT_KEYS) next[k] = c.after[k];
      return next;
    }),
  ].sort((a, b) => a.no - b.no);
  return { diff, upserts };
}
