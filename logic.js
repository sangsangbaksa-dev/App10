// 세금적립 — 순수 계산 로직 (DOM 접근 없음)
// 금액은 원 단위 정수로 다룹니다. 모든 세액은 추정치이며 세무 신고를 대신하지 않습니다.

export const WITHHOLDING_RATE = 0.033; // 사업소득 원천징수: 소득세 3% + 지방소득세 0.3%
export const DEFAULT_RATE_PCT = 15;
export const MAX_RATE_PCT = 60;

export function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseAmount(v) {
  const n = Number(String(v ?? '').replace(/[,\s원]/g, ''));
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n);
}

export function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_RATE_PCT;
  return Math.min(MAX_RATE_PCT, Math.max(0, Math.round(n * 10) / 10));
}

export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').slice(0, 64);
  const date = String(raw.date ?? '');
  const type = raw.type === 'income' || raw.type === 'expense' ? raw.type : null;
  const amount = parseAmount(raw.amount);
  if (!id || !isRealDate(date) || !type || !Number.isFinite(amount) || amount <= 0) return null;
  return {
    id,
    date,
    type,
    amount,
    client: String(raw.client ?? '').slice(0, 80),
    memo: String(raw.memo ?? '').slice(0, 200),
    withheld: type === 'income' && raw.withheld === true,
  };
}

export function sanitizeEntries(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const e = sanitizeEntry(raw);
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

export function yearsOf(entries) {
  return [...new Set(entries.map((e) => Number(e.date.slice(0, 4))))].sort((a, b) => b - a);
}

// 수입 합계, 경비 합계, 순수입, 원천징수 누계, 적립 목표, 추가 적립 필요액
export function summarize(entries, ratePct = DEFAULT_RATE_PCT) {
  let income = 0;
  let expense = 0;
  let withheld = 0;
  for (const e of entries) {
    if (e.type === 'income') {
      income += e.amount;
      if (e.withheld) withheld += Math.round(e.amount * WITHHOLDING_RATE);
    } else {
      expense += e.amount;
    }
  }
  const net = income - expense;
  const reserveTarget = Math.round(Math.max(0, net) * (clampPct(ratePct) / 100));
  return {
    income,
    expense,
    net,
    withheld,
    reserveTarget,
    reserveGap: Math.max(0, reserveTarget - withheld),
  };
}

export function monthlyBreakdown(entries) {
  const map = new Map();
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    const row = map.get(month) ?? { month, income: 0, expense: 0, net: 0 };
    if (e.type === 'income') row.income += e.amount;
    else row.expense += e.amount;
    row.net = row.income - row.expense;
    map.set(month, row);
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

// 종합소득세 정기 신고 마감: 전년도 소득 기준 다음 해 5월 31일
export function filingDeadlineFor(year) {
  return new Date(Number(year) + 1, 4, 31);
}

export function daysUntil(target, today) {
  const a = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}

// 수식 주입 방지: = + - @ 탭 CR 로 시작하는 셀은 앞에 ' 를 붙입니다.
const FORMULA_RE = /^[=+\-@\t\r]/;
export function csvCell(v) {
  let s = String(v ?? '');
  if (FORMULA_RE.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(entries) {
  const head = ['날짜', '구분', '금액', '거래처', '메모', '원천징수'];
  const rows = [...entries]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) =>
      [e.date, e.type === 'income' ? '수입' : '경비', e.amount, e.client, e.memo, e.withheld ? 'Y' : '']
        .map(csvCell)
        .join(','),
    );
  return '﻿' + [head.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n';
}
