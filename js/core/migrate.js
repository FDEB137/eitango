// 記録の形式の版と移行（docs/shiyou.md 9章）。純粋な関数だけ。
// 形式を変えるときは SCHEMA_VERSION を1上げ、migrations[新しい版] を足す（消さない）。
// migrations[v] は「前の版の data → v の data」（data は書き出しファイルの data の形。入力は変えない）。
export const SCHEMA_VERSION = 1;

export const migrations = {};

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
