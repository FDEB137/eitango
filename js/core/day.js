// 学習日と日付の計算（docs/shiyou.md 3.1）。純粋な関数だけ。今の時刻は引数（Date）で受け取る。
// 日付は「YYYY-MM-DD」の文字列で持ち、日数の計算は年月日の上で行う（ミリ秒の差で計算しない）。
import { DAY_START_HOUR } from "./constants.js";

const pad = (n, w = 2) => String(n).padStart(w, "0");

function format(y, m, d) {
  return pad(y, 4) + "-" + pad(m) + "-" + pad(d);
}

// 「YYYY-MM-DD」を {y, m, d} にする。形が違う・存在しない日付なら例外。
export function parseDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!m) throw new RangeError("日付の形が違います: " + day);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) {
    throw new RangeError("存在しない日付です: " + day);
  }
  return { y, m: mo, d };
}

export function isValidDay(day) {
  try {
    parseDay(day);
    return true;
  } catch (e) {
    return false;
  }
}

// 日付に n 日（負も可）を足す。月末・年末・うるう年をまたいでよい。
export function addDays(day, n) {
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// a が b より前なら -1、同じなら 0、後なら 1
export function compareDays(a, b) {
  parseDay(a);
  parseDay(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

// a - b の日数
export function diffDays(a, b) {
  const x = parseDay(a);
  const y = parseDay(b);
  return Math.round((Date.UTC(x.y, x.m - 1, x.d) - Date.UTC(y.y, y.m - 1, y.d)) / 86400000);
}

export function maxDay(a, b) {
  return compareDays(a, b) >= 0 ? a : b;
}

// 学習日: 端末の現地時刻で、午前4時に日付が切り替わる（3:59 は前の日、4:00 は当日）。
// 夏時間などに左右されないよう、現地の年月日・時の値から計算する。
export function studyDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError("日時が正しくありません");
  const day = format(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return date.getHours() < DAY_START_HOUR ? addDays(day, -1) : day;
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// 「10月21日（水）」
export function formatDayJa(day) {
  const { y, m, d } = parseDay(day);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return m + "月" + d + "日（" + WEEK[w] + "）";
}

// 「10/21」
export function formatMonthDay(day) {
  const { m, d } = parseDay(day);
  return m + "/" + d;
}

// 現地時刻の ISO 8601（例 2026-10-19T21:05:00.000+09:00）
export function isoWithOffset(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError("日時が正しくありません");
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return (
    format(date.getFullYear(), date.getMonth() + 1, date.getDate()) +
    "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds()) +
    "." + pad(date.getMilliseconds(), 3) + sign + pad(Math.floor(a / 60)) + ":" + pad(a % 60)
  );
}
