// 記録の形式の版と移行（docs/shiyou.md 9章）。純粋な関数だけ。
// 形式を変えるときは SCHEMA_VERSION を1上げ、migrations[新しい版] を足す（消さない）。
// migrations[v] は「前の版の data → v の data」（data は書き出しファイルの data の形。入力は変えない）。
export const SCHEMA_VERSION = 2;

// 版1 → 版2: words の各語に expr（語句）・note（備考）を足す（docs/shiyou.md 9.1）。
// すでに文字列で入っていればそのまま、無い・文字列でなければ ""。入力は変えない。
function toV2(data) {
  if (data === null || typeof data !== "object" || !Array.isArray(data.words)) return data;
  const copy = JSON.parse(JSON.stringify(data));
  copy.words = copy.words.map((w) => {
    if (w === null || typeof w !== "object" || Array.isArray(w)) return w;
    return {
      ...w,
      expr: typeof w.expr === "string" ? w.expr : "",
      note: typeof w.note === "string" ? w.note : "",
    };
  });
  return copy;
}

export const migrations = { 2: toV2 };

// data を from の版から to の版まで順に移行する。table は移行関数の表（テストで差し替える）。
export function migrateData(data, from, to = SCHEMA_VERSION, table = migrations) {
  if (!Number.isInteger(from) || from < 1) throw new RangeError("記録の版が正しくありません: " + from);
  if (from > to) throw new RangeError("記録の版（" + from + "）が新しすぎます");
  let cur = JSON.parse(JSON.stringify(data));
  for (let v = from + 1; v <= to; v++) {
    const fn = table[v];
    if (typeof fn !== "function") throw new Error("版 " + v + " への移行関数がありません");
    cur = fn(cur);
  }
  return cur;
}

// 保存されている版が今の版より古く、移行が要るか
export function needsMigration(storedVersion, current = SCHEMA_VERSION) {
  return storedVersion < current;
}

// 保存されている版が今のアプリより新しいか（その DB は書き換えずに「アプリを更新してください」と出す）
export function isNewerThanApp(storedVersion, current = SCHEMA_VERSION) {
  return storedVersion > current;
}
