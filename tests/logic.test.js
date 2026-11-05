import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPct,
  csvCell,
  daysUntil,
  filingDeadlineFor,
  isRealDate,
  monthlyBreakdown,
  parseAmount,
  sanitizeEntries,
  sanitizeEntry,
  summarize,
  toCSV,
  yearsOf,
} from '../logic.js';

const e = (over) => ({
  id: 'x' + Math.random().toString(36).slice(2),
  date: '2026-03-10',
  type: 'income',
  amount: 1000000,
  client: '',
  memo: '',
  withheld: false,
  ...over,
});

test('parseAmount: 쉼표·원 표기 제거, 음수·잘못된 값은 NaN', () => {
  assert.equal(parseAmount('1,500,000 원'), 1500000);
  assert.equal(parseAmount('12.6'), 13);
  assert.ok(Number.isNaN(parseAmount('-5')));
  assert.ok(Number.isNaN(parseAmount('abc')));
});

test('isRealDate: 존재하지 않는 날짜 거부', () => {
  assert.equal(isRealDate('2026-02-28'), true);
  assert.equal(isRealDate('2026-02-31'), false);
  assert.equal(isRealDate('2024-02-29'), true);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.equal(isRealDate('26-01-01'), false);
});

test('sanitizeEntry: 필수 값 검증, 길이 제한, 수입 외 원천징수 무시', () => {
  assert.equal(sanitizeEntry({ id: 'a', date: '2026-01-01', type: 'expense', amount: 5, withheld: true }).withheld, false);
  assert.equal(sanitizeEntry({ id: 'a', date: '2026-02-31', type: 'income', amount: 5 }), null);
  assert.equal(sanitizeEntry({ id: '', date: '2026-01-01', type: 'income', amount: 5 }), null);
  assert.equal(sanitizeEntry({ id: 'a', date: '2026-01-01', type: 'income', amount: 0 }), null);
  assert.equal(sanitizeEntry({ id: 'a', date: '2026-01-01', type: 'income', amount: 5, client: 'x'.repeat(300) }).client.length, 80);
});

test('sanitizeEntries: 중복 id 제거, 잘못된 항목 제외', () => {
  const out = sanitizeEntries([
    { id: 'a', date: '2026-01-01', type: 'income', amount: 1 },
    { id: 'a', date: '2026-01-02', type: 'income', amount: 2 },
    null,
    'oops',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 1);
  assert.deepEqual(sanitizeEntries('nope'), []);
});

test('clampPct: 0~60 범위, 숫자가 아니면 기본 15', () => {
  assert.equal(clampPct(-3), 0);
  assert.equal(clampPct(99), 60);
  assert.equal(clampPct('abc'), 15);
  assert.equal(clampPct('12.345'), 12.3);
});

test('summarize: 수입·경비·원천징수·적립 목표 계산', () => {
  const s = summarize(
    [
      e({ amount: 1000000, withheld: true }),
      e({ amount: 500000, withheld: false }),
      e({ type: 'expense', amount: 200000 }),
    ],
    15,
  );
  assert.equal(s.income, 1500000);
  assert.equal(s.expense, 200000);
  assert.equal(s.net, 1300000);
  assert.equal(s.withheld, 33000); // 1,000,000 × 3.3%
  assert.equal(s.reserveTarget, 195000); // 1,300,000 × 15%
  assert.equal(s.reserveGap, 162000);
});

test('summarize: 순수입이 음수면 적립 목표 0, 추가 적립 필요 0', () => {
  const s = summarize([e({ type: 'expense', amount: 300000 })], 15);
  assert.equal(s.reserveTarget, 0);
  assert.equal(s.reserveGap, 0);
});

test('summarize: 원천징수가 목표보다 많아도 추가 적립 필요는 0', () => {
  const s = summarize([e({ amount: 10000000, withheld: true })], 1);
  assert.equal(s.reserveTarget, 100000);
  assert.equal(s.reserveGap, 0);
});

test('monthlyBreakdown: 최신 월이 위로, 월별 합계', () => {
  const rows = monthlyBreakdown([
    e({ date: '2026-01-05', amount: 100 }),
    e({ date: '2026-03-01', amount: 300 }),
    e({ date: '2026-03-20', type: 'expense', amount: 50 }),
  ]);
  assert.deepEqual(rows.map((r) => r.month), ['2026-03', '2026-01']);
  assert.equal(rows[0].income, 300);
  assert.equal(rows[0].expense, 50);
  assert.equal(rows[0].net, 250);
});

test('yearsOf: 연도 내림차순 고유 목록', () => {
  assert.deepEqual(yearsOf([e({ date: '2024-01-01' }), e({ date: '2026-01-01' }), e({ date: '2026-05-01' })]), [2026, 2024]);
});

test('filingDeadlineFor: 전년도 소득 → 다음 해 5월 31일', () => {
  const d = filingDeadlineFor(2025);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getDate(), 31);
});

test('daysUntil: 날짜 차이 계산 (시간대 영향 없음)', () => {
  assert.equal(daysUntil(new Date(2026, 4, 31), new Date(2026, 4, 1)), 30);
  assert.equal(daysUntil(new Date(2026, 4, 1), new Date(2026, 4, 1)), 0);
  assert.equal(daysUntil(new Date(2026, 3, 30), new Date(2026, 4, 1)), -1);
});

test('csvCell: 수식 주입 방지와 따옴표 이스케이프', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1'), `'+1`);
  assert.equal(csvCell('-x'), `'-x`);
  assert.equal(csvCell('@sum'), `'@sum`);
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('plain'), 'plain');
});

test('toCSV: BOM 포함, 날짜순 정렬, 원천징수 표시', () => {
  const csv = toCSV([
    e({ date: '2026-05-01', client: '가', withheld: true }),
    e({ date: '2026-02-01', type: 'expense', memo: '노트북' }),
  ]);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines[0], '날짜,구분,금액,거래처,메모,원천징수');
  assert.ok(lines[1].startsWith('2026-02-01,경비'));
  assert.ok(lines[2].endsWith(',Y'));
});
