import {
  DEFAULT_RATE_PCT,
  clampPct,
  daysUntil,
  filingDeadlineFor,
  monthlyBreakdown,
  parseAmount,
  sanitizeEntries,
  sanitizeEntry,
  summarize,
  toCSV,
  yearsOf,
} from './logic.js';

const KEY = 'taxreserve-v1';
const $ = (sel) => document.querySelector(sel);
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const form = $('#entry-form');
const rowsEl = $('#rows');

let state = load();
let year = String(new Date().getFullYear());
let month = 'all';
let editingId = null;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return { entries: sanitizeEntries(raw.entries), ratePct: clampPct(raw.ratePct) };
    }
  } catch {
    // 손상된 저장값은 무시하고 빈 상태로 시작합니다.
  }
  return { entries: [], ratePct: DEFAULT_RATE_PCT };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast('브라우저 저장소에 쓸 수 없어 저장하지 못했습니다.');
  }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    t.hidden = true;
  }, 2400);
}

function td(text, cls) {
  const c = document.createElement('td');
  c.textContent = text;
  if (cls) c.className = cls;
  return c;
}

function btn(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function renderYearOptions() {
  const years = new Set(yearsOf(state.entries));
  years.add(Number(new Date().getFullYear()));
  const sorted = [...years].sort((a, b) => b - a);
  const sel = $('#year-sel');
  sel.replaceChildren(...sorted.map((y) => new Option(`${y}년`, String(y))));
  if (!sorted.map(String).includes(year)) {
    year = String(sorted[0]);
    month = 'all';
  }
  sel.value = year;
}

function renderMonthOptions() {
  const sel = $('#month-sel');
  const opts = [new Option('전체', 'all')];
  for (let m = 1; m <= 12; m++) {
    opts.push(new Option(`${m}월`, `${year}-${String(m).padStart(2, '0')}`));
  }
  sel.replaceChildren(...opts);
  sel.value = month;
  if (sel.value !== month) {
    month = 'all';
    sel.value = 'all';
  }
}

function renderSummary(yearEntries) {
  const s = summarize(yearEntries, state.ratePct);
  $('#s-income').textContent = won(s.income);
  $('#s-expense').textContent = won(s.expense);
  $('#s-net').textContent = won(s.net);
  $('#s-target').textContent = won(s.reserveTarget);
  $('#s-rate-note').textContent = `순수입의 ${state.ratePct}%`;
  $('#s-withheld').textContent = won(s.withheld);
  $('#s-gap').textContent = won(s.reserveGap);
}

function renderDeadline() {
  const target = filingDeadlineFor(year);
  const d = daysUntil(target, new Date());
  const label = d > 0 ? `D-${d}` : d === 0 ? 'D-day' : `마감 ${-d}일 지남`;
  const box = $('#deadline');
  const strong = document.createElement('strong');
  strong.textContent = `${target.getFullYear()}년 5월 31일 종합소득세 정기 신고 마감`;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = label;
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = `${year}년 소득 기준 안내입니다. 실제 신고 기간과 세액은 국세청 안내를 확인하세요.`;
  box.replaceChildren(strong, badge, p);
}

function renderRows(yearEntries) {
  const list = yearEntries
    .filter((e) => month === 'all' || e.date.startsWith(month))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  rowsEl.replaceChildren();
  for (const e of list) {
    const info = td('');
    const name = document.createElement('div');
    name.textContent = e.client || '(거래처 없음)';
    const memo = document.createElement('small');
    memo.textContent = [e.memo, e.withheld ? '원천징수 Y' : ''].filter(Boolean).join(' · ');
    info.append(name, memo);

    const act = td('', 'actions-cell');
    act.append(
      btn('수정', () => startEdit(e.id)),
      btn('삭제', () => removeEntry(e.id), 'danger'),
    );

    const tr = document.createElement('tr');
    const isIncome = e.type === 'income';
    tr.append(
      td(e.date),
      td(isIncome ? '수입' : '경비', `tag ${isIncome ? 'income' : 'expense'}`),
      td(won(e.amount), 'num'),
      info,
      act,
    );
    rowsEl.append(tr);
  }
  $('#empty').hidden = list.length > 0;
}

function renderMonthly(yearEntries) {
  const body = $('#monthly');
  body.replaceChildren();
  for (const r of monthlyBreakdown(yearEntries)) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => {
      month = r.month;
      render();
    });
    tr.append(td(r.month), td(won(r.income), 'num'), td(won(r.expense), 'num'), td(won(r.net), 'num'));
    body.append(tr);
  }
}

function render() {
  renderYearOptions();
  renderMonthOptions();
  const yearEntries = state.entries.filter((e) => e.date.startsWith(year));
  renderSummary(yearEntries);
  renderDeadline();
  renderRows(yearEntries);
  renderMonthly(yearEntries);
}

function syncWithheldRow() {
  const isIncome = form.elements.type.value === 'income';
  $('#withheld-row').hidden = !isIncome;
  if (!isIncome) form.elements.withheld.checked = false;
}

function resetForm() {
  form.reset();
  editingId = null;
  $('#form-title').textContent = '수입·경비 기록';
  $('#submit-btn').textContent = '추가';
  $('#cancel-edit').hidden = true;
  syncWithheldRow();
}

function startEdit(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  form.elements.type.value = e.type;
  form.elements.date.value = e.date;
  form.elements.amount.value = String(e.amount);
  form.elements.client.value = e.client;
  form.elements.memo.value = e.memo;
  form.elements.withheld.checked = e.withheld;
  syncWithheldRow();
  $('#form-title').textContent = '기록 수정';
  $('#submit-btn').textContent = '저장';
  $('#cancel-edit').hidden = false;
  form.elements.amount.focus();
}

function removeEntry(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  if (!confirm(`${e.date} ${won(e.amount)} 기록을 삭제할까요?`)) return;
  state.entries = state.entries.filter((x) => x.id !== id);
  if (editingId === id) resetForm();
  save();
  render();
  toast('삭제했습니다.');
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const wasEdit = editingId !== null;
  const entry = sanitizeEntry({
    id: editingId ?? newId(),
    date: form.elements.date.value,
    type: form.elements.type.value,
    amount: parseAmount(form.elements.amount.value),
    client: form.elements.client.value.trim(),
    memo: form.elements.memo.value.trim(),
    withheld: form.elements.withheld.checked,
  });
  if (!entry) {
    toast('날짜와 금액(0보다 큰 숫자)을 확인하세요.');
    return;
  }
  if (wasEdit) {
    state.entries = state.entries.map((e) => (e.id === entry.id ? entry : e));
  } else {
    state.entries.push(entry);
  }
  year = entry.date.slice(0, 4);
  month = 'all';
  resetForm();
  save();
  render();
  toast(wasEdit ? '수정했습니다.' : '추가했습니다.');
});

form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', syncWithheldRow));
$('#cancel-edit').addEventListener('click', resetForm);

$('#year-sel').addEventListener('change', (ev) => {
  year = ev.target.value;
  month = 'all';
  render();
});

$('#month-sel').addEventListener('change', (ev) => {
  month = ev.target.value;
  render();
});

$('#rate').addEventListener('change', (ev) => {
  state.ratePct = clampPct(ev.target.value);
  ev.target.value = String(state.ratePct);
  save();
  render();
});

$('#export').addEventListener('click', () => {
  const list = state.entries.filter((e) => e.date.startsWith(year));
  if (!list.length) {
    toast(`${year}년 기록이 없습니다.`);
    return;
  }
  const blob = new Blob([toCSV(list)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `세금적립-${year}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#clear').addEventListener('click', () => {
  if (!state.entries.length) {
    toast('삭제할 기록이 없습니다.');
    return;
  }
  if (!confirm('모든 연도의 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  state.entries = [];
  resetForm();
  save();
  render();
  toast('전체 기록을 삭제했습니다.');
});

$('#rate').value = String(state.ratePct);
syncWithheldRow();
render();
