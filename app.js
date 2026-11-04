import { extractVariables, renderTemplate, normalizeTags, searchPrompts, sortPrompts, validatePrompt, mergeImport, parseExport, demoPrompts } from './logic.js';

const KEY = 'pv-prompts-v1';
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};

const state = { prompts: [], q: '', tag: '', sort: 'recent', selected: null, values: {}, editingId: null, storageOk: true };

/* storage */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const r = parseExport(raw);
    return r.ok ? r.prompts : [];
  } catch { state.storageOk = false; return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state.prompts)); state.storageOk = true; }
  catch { if (state.storageOk) toast('저장소를 쓸 수 없어 이번 세션에만 유지돼요.', 'bad'); state.storageOk = false; }
}

/* helpers */
function toast(msg, kind = 'ok') {
  const t = el('div', { class: 'toast ' + kind, text: msg });
  $('toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
}
function uid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function hueOf(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
function fmtTime(ts) {
  if (!ts) return '없음';
  const d = new Date(ts), diff = Date.now() - ts, m = 60000;
  if (diff < m) return '방금 전';
  if (diff < 60 * m) return Math.floor(diff / m) + '분 전';
  if (diff < 24 * 60 * m) return Math.floor(diff / 60 / m) + '시간 전';
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function tagChip(t, extra = {}) { const c = el('span', { class: 'chip', text: '#' + t, ...extra }); c.style.setProperty('--h', hueOf(t)); return c; }
function tagFilterBtn(t) {
  const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.tag === t), title: '이 태그로 필터', text: '#' + t,
    onclick: () => { state.tag = state.tag === t ? '' : t; document.querySelector('.layout').classList.remove('show-detail'); render(); } });
  c.style.setProperty('--h', hueOf(t));
  return c;
}
function current() { return state.prompts.find((p) => p.id === state.selected) || null; }

function highlight(container, text, values) {
  container.textContent = '';
  let last = 0;
  for (const m of text.matchAll(/\{\{([^{}]+?)\}\}/g)) {
    if (m.index > last) container.append(text.slice(last, m.index));
    const name = m[1].trim();
    const val = values && values[name];
    const filled = typeof val === 'string' && val !== '';
    container.append(el('span', { class: 'v' + (filled ? ' filled' : ''), text: filled ? val : '{{' + name + '}}' }));
    last = m.index + m[0].length;
  }
  if (last < text.length) container.append(text.slice(last));
}

/* render list */
function renderTags() {
  const bar = $('tagBar'); bar.textContent = '';
  const counts = new Map();
  for (const p of state.prompts) for (const t of p.tags) counts.set(t, (counts.get(t) || 0) + 1);
  for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))) {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.tag === t), text: `#${t} ${n}`, onclick: () => { state.tag = state.tag === t ? '' : t; render(); } });
    b.style.setProperty('--h', hueOf(t));
    bar.append(b);
  }
}
function renderList() {
  const list = $('list'); list.textContent = '';
  const items = sortPrompts(searchPrompts(state.prompts, state.q, state.tag), state.sort);
  for (const p of items) {
    const btn = el('button', { class: 'card-btn', type: 'button', 'aria-current': String(p.id === state.selected), onclick: () => select(p.id, true) },
      el('span', { class: 'card-title', text: p.title }),
      el('span', { class: 'card-body', text: p.body }),
      el('span', { class: 'card-foot' },
        el('span', { text: `사용 ${p.useCount}회` }),
        el('span', { text: '최근 사용 ' + fmtTime(p.lastUsedAt) })));
    const li = el('li', { class: 'card' + (p.id === state.selected ? ' active' : '') }, btn);
    const chips = el('div', { class: 'chips' });
    if (p.demo) chips.append(el('span', { class: 'chip demo', text: '예시 데이터' }));
    p.tags.forEach((t) => chips.append(tagChip(t)));
    if (chips.childNodes.length) btn.append(chips);
    list.append(li);
  }
  const empty = $('empty');
  empty.hidden = items.length > 0;
  $('emptyMsg').textContent = state.prompts.length === 0 ? '아직 프롬프트가 없어요. 새로 만들거나 예시 데이터를 불러와 보세요.' : '조건에 맞는 프롬프트가 없어요.';
  const total = state.prompts.reduce((s, p) => s + p.useCount, 0);
  $('stats').textContent = `프롬프트 ${state.prompts.length}개 · 총 ${total}회 사용` + (state.storageOk ? '' : ' · 저장소 사용 불가(임시 모드)');
}

/* detail */
function select(id, scroll) {
  state.selected = id; state.values = {};
  render();
  document.querySelector('.layout').classList.add('show-detail');
  if (scroll) { const d = $('detail'); d.scrollIntoView({ block: 'start' }); d.focus({ preventScroll: true }); }
}
function renderDetail() {
  const p = current();
  $('detailEmpty').hidden = !!p; $('detailBody').hidden = !p;
  if (!p) return;
  $('detailTitle').textContent = p.title;
  $('detailMeta').textContent = `사용 ${p.useCount}회 · 최근 사용 ${fmtTime(p.lastUsedAt)}`;
  const tg = $('detailTags'); tg.textContent = '';
  if (p.demo) tg.append(el('span', { class: 'chip demo', text: '예시 데이터' }));
  p.tags.forEach((t) => tg.append(tagFilterBtn(t)));
  highlight($('rawBody'), p.body, null);
  const vars = extractVariables(p.body);
  const form = $('fillForm'); form.textContent = '';
  $('noVars').hidden = vars.length > 0;
  vars.forEach((name, i) => {
    const long = name.length > 12 || /내용|코드|본문|설명/.test(name);
    const id = 'var-' + i;
    const input = long ? el('textarea', { id, rows: '3' }) : el('input', { id, type: 'text' });
    input.value = state.values[name] || '';
    input.addEventListener('input', () => { state.values[name] = input.value; renderPreview(); });
    form.append(el('label', { class: 'field' + (long ? ' wide' : ''), for: id }, el('span', { text: name }), input));
  });
  renderPreview();
}
function renderPreview() {
  const p = current(); if (!p) return;
  highlight($('preview'), p.body, state.values);
}

/* copy */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = el('textarea', { 'aria-hidden': 'true', tabindex: '-1', readonly: '' });
  ta.value = text;
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.append(ta);
  ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
async function doCopy() {
  const p = current(); if (!p) return;
  const ok = await copyText(renderTemplate(p.body, state.values));
  if (!ok) { toast('복사하지 못했어요. 미리보기를 직접 선택해 복사해 주세요.', 'bad'); return; }
  p.useCount += 1; p.lastUsedAt = Date.now();
  save(); toast('클립보드에 복사했어요!');
  renderList(); renderTags();
  $('detailMeta').textContent = `사용 ${p.useCount}회 · 최근 사용 ${fmtTime(p.lastUsedAt)}`;
}

/* modal */
function openEdit(p) {
  state.editingId = p ? p.id : null;
  $('modalTitle').textContent = p ? '프롬프트 수정' : '새 프롬프트';
  $('fTitle').value = p ? p.title : ''; $('fTags').value = p ? p.tags.join(', ') : ''; $('fBody').value = p ? p.body : '';
  for (const id of ['eTitle', 'eTags', 'eBody']) $(id).textContent = '';
  updateVarHint();
  $('modal').showModal(); $('fTitle').focus();
}
function updateVarHint() {
  const v = extractVariables($('fBody').value);
  $('varHint').textContent = v.length ? '감지된 변수: ' + v.map((x) => '{{' + x + '}}').join(', ') : '감지된 변수가 없어요.';
}
function submitEdit(e) {
  e.preventDefault();
  const data = { title: $('fTitle').value, body: $('fBody').value, tags: $('fTags').value };
  const r = validatePrompt(data);
  $('eTitle').textContent = r.errors.title || ''; $('eTags').textContent = r.errors.tags || ''; $('eBody').textContent = r.errors.body || '';
  if (!r.ok) { (r.errors.title ? $('fTitle') : r.errors.tags ? $('fTags') : $('fBody')).focus(); return; }
  const now = Date.now(), tags = normalizeTags(data.tags);
  if (state.editingId) {
    const p = state.prompts.find((x) => x.id === state.editingId);
    Object.assign(p, { title: data.title.trim(), body: data.body, tags, updatedAt: now });
    toast('수정했어요.');
  } else {
    const p = { id: uid(), title: data.title.trim(), body: data.body, tags, useCount: 0, lastUsedAt: null, createdAt: now, updatedAt: now, demo: false };
    state.prompts.push(p); state.selected = p.id; state.values = {};
    toast('저장했어요.');
  }
  save(); $('modal').close(); render();
  document.querySelector('.layout').classList.add('show-detail');
}

function ask(title, msg, okText) {
  return new Promise((res) => {
    $('confirmTitle').textContent = title; $('confirmMsg').textContent = msg; $('confirmOk').textContent = okText;
    const d = $('confirm');
    d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true });
    d.returnValue = 'cancel'; d.showModal();
  });
}

/* actions */
function exportJson() {
  const blob = new Blob([JSON.stringify({ app: 'prompt-vault', version: 1, exportedAt: new Date().toISOString(), prompts: state.prompts }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'prompt-vault-' + new Date().toISOString().slice(0, 10) + '.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${state.prompts.length}개를 내보냈어요.`);
}
async function importJson(file) {
  if (!file) return;
  let text;
  try { text = await file.text(); } catch { toast('파일을 읽지 못했어요.', 'bad'); return; }
  const r = parseExport(text);
  if (!r.ok) { toast(r.error, 'bad'); return; }
  const m = mergeImport(state.prompts, r.prompts);
  state.prompts = m.merged; save(); render();
  toast(`가져오기 완료: ${m.added}개 추가, ${m.skipped}개 중복 건너뜀, ${r.invalid}개 형식 오류`);
}
function addDemo() {
  const m = mergeImport(state.prompts, demoPrompts());
  state.prompts = m.merged; save(); render();
  toast(m.added ? `예시 데이터 ${m.added}개를 추가했어요.` : '예시 데이터가 이미 있어요.');
}

function render() {
  renderTags(); renderList(); renderDetail();
  if (!state.selected) document.querySelector('.layout').classList.remove('show-detail');
}

/* theme */
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('pv-theme', next); } catch {}
}

/* wiring */
state.prompts = load();
$('themeBtn').addEventListener('click', toggleTheme);
$('newBtn').addEventListener('click', () => openEdit(null));
$('demoBtn').addEventListener('click', addDemo);
$('search').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
$('editForm').addEventListener('submit', submitEdit);
$('cancelBtn').addEventListener('click', () => $('modal').close());
$('fBody').addEventListener('input', updateVarHint);
for (const [field, err] of [['fTitle', 'eTitle'], ['fTags', 'eTags'], ['fBody', 'eBody']]) {
  $(field).addEventListener('input', () => { $(err).textContent = ''; });
}
$('editBtn').addEventListener('click', () => openEdit(current()));
$('copyBtn').addEventListener('click', doCopy);
$('resetBtn').addEventListener('click', () => { state.values = {}; renderDetail(); });
$('backBtn').addEventListener('click', () => { document.querySelector('.layout').classList.remove('show-detail'); window.scrollTo({ top: 0 }); });
$('delBtn').addEventListener('click', async () => {
  const p = current(); if (!p) return;
  if (!(await ask('프롬프트 삭제', `"${p.title}"을(를) 삭제할까요?`, '삭제'))) return;
  state.prompts = state.prompts.filter((x) => x.id !== p.id); state.selected = null; save(); render(); toast('삭제했어요.');
});
$('clearBtn').addEventListener('click', async () => {
  if (!state.prompts.length) { toast('삭제할 프롬프트가 없어요.', 'bad'); return; }
  if (!(await ask('전체 삭제', `프롬프트 ${state.prompts.length}개를 모두 삭제할까요? 되돌릴 수 없어요.`, '모두 삭제'))) return;
  state.prompts = []; state.selected = null; state.tag = ''; save(); render(); toast('모두 삭제했어요.');
});
$('exportBtn').addEventListener('click', exportJson);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => { importJson(e.target.files[0]); e.target.value = ''; });
render();
