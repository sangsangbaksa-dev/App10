import { backupIndicator } from './backup-status.js';
import {
  extractVariables, renderTemplate, normalizeTags, searchPrompts, sortPrompts, validatePrompt,
  mergeImport, parseExport, demoPrompts, textStats, duplicatePrompt, toMarkdown,
  parseDefaults, formatDefaults, removeByIds, recordVersion, restoreVersion, diffLines,
  addTestRun, removeTestRun,
} from './logic.js';

const backupState = backupIndicator(document.getElementById('backupStatus'), 'prompt-vault:backup-requested');
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
const layout = () => document.querySelector('.layout');
const fmtNum = (n) => n.toLocaleString('ko-KR');

const state = {
  prompts: [], q: '', tag: '', fav: false, sort: 'recent', selected: null, values: {},
  editingId: null, storageOk: true, bulk: false, checked: new Set(), visible: [],
  diff: { a: '0', b: 'cur' },
};

/* storage */
const BACKUP_KEY = KEY + '-backup';
let recoveryRaw = null;
function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { state.storageOk = false; return []; }
  if (!raw) return [];
  const r = parseExport(raw);
  if (!r.ok || r.invalid > 0) {
    // Refuse to overwrite the original until the user explicitly chooses recovery.
    recoveryRaw = raw;
    try { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw); } catch {}
  }
  return r.ok ? r.prompts : [];
}
function save() {
  if (recoveryRaw !== null) return false;
  try { localStorage.setItem(KEY, JSON.stringify(state.prompts)); state.storageOk = true; return true; }
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
function tagChip(t) { const c = el('span', { class: 'chip', text: '#' + t }); c.style.setProperty('--h', hueOf(t)); return c; }
function tagFilterBtn(t) {
  const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.tag === t), title: '이 태그로 필터', text: '#' + t,
    onclick: () => { state.tag = state.tag === t ? '' : t; layout().classList.remove('show-detail'); render(); focusEl(`#tagBar [data-tag="${CSS.escape(t)}"]`); } });
  c.style.setProperty('--h', hueOf(t));
  return c;
}
function current() { return state.prompts.find((p) => p.id === state.selected) || null; }
/* keep keyboard focus on a sensible control after a re-render */
function focusEl(sel) { const n = document.querySelector(sel); if (n) n.focus(); }
function defaultsOf(p) { return Object.fromEntries(Object.entries(p?.defaults || {}).map(([name, value]) => [name.trim().normalize('NFC'), value])); }
function hasDefault(p, name) { return typeof defaultsOf(p)[name] === 'string'; }

function highlight(container, text, values) {
  container.textContent = '';
  let last = 0;
  for (const m of text.matchAll(/\{\{([^{}]+?)\}\}/g)) {
    if (m.index > last) container.append(text.slice(last, m.index));
    const name = m[1].trim().normalize('NFC');
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
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.tag === t), text: `#${t} ${n}`, 'data-tag': t,
      onclick: () => { state.tag = state.tag === t ? '' : t; render(); focusEl(`#tagBar [data-tag="${CSS.escape(t)}"]`); } });
    b.style.setProperty('--h', hueOf(t));
    bar.append(b);
  }
  const fav = $('favFilter');
  fav.setAttribute('aria-pressed', String(state.fav));
  fav.textContent = `★ 즐겨찾기만 (${state.prompts.filter((p) => p.favorite).length})`;
}
function renderBulk() {
  const n = state.checked.size;
  $('bulkBar').hidden = !state.bulk;
  $('bulkCount').textContent = `${n}개 선택됨`;
  $('bulkDelBtn').disabled = n === 0;
  const tg = $('bulkToggle');
  tg.textContent = state.bulk ? '선택 종료' : '여러 개 선택';
  tg.setAttribute('aria-pressed', String(state.bulk));
}
function renderList() {
  const list = $('list'); list.textContent = '';
  const items = sortPrompts(searchPrompts(state.prompts, state.q, state.tag, state.fav), state.sort);
  state.visible = items.map((p) => p.id);
  for (const p of items) {
    const isSel = p.id === state.selected;
    const isChecked = state.checked.has(p.id);
    const btn = el('button', {
      class: 'card-btn', type: 'button', 'aria-current': String(isSel),
      onclick: () => (state.bulk ? toggleChecked(p.id) : select(p.id, true)),
    },
      el('span', { class: 'card-title' }, p.favorite ? el('span', { class: 'star', 'aria-hidden': 'true', text: '★ ' }) : null, p.title),
      el('span', { class: 'card-body', text: p.body }),
      el('span', { class: 'card-foot' },
        el('span', { text: `사용 ${p.useCount}회` }),
        el('span', { text: '최근 복사 ' + fmtTime(p.lastUsedAt) })));
    const li = el('li', { class: 'card' + (isSel ? ' active' : '') + (state.bulk ? ' bulk' : '') + (isChecked ? ' checked' : '') }, btn);
    if (state.bulk) {
      const cb = el('input', { type: 'checkbox', class: 'pick', 'aria-label': `${p.title} 선택`, 'data-id': p.id });
      cb.checked = isChecked;
      cb.addEventListener('change', () => toggleChecked(p.id));
      li.append(cb);
    }
    const chips = el('span', { class: 'chips' });
    if (p.demo) chips.append(el('span', { class: 'chip demo', text: '예시 데이터' }));
    (p.tags || []).forEach((t) => chips.append(tagChip(t)));
    if (chips.childNodes.length) btn.append(chips);
    list.append(li);
  }
  const none = state.prompts.length === 0;
  $('empty').hidden = items.length > 0;
  $('emptyMsg').textContent = none
    ? '아직 프롬프트가 없어요. 새로 만들거나 예시 데이터를 불러와 보세요.'
    : '조건에 맞는 프롬프트가 없어요. 검색어나 필터를 바꿔 보세요.';
  $('emptyDemo').hidden = !none;
  const favCount = state.prompts.filter((p) => p.favorite).length;
  const total = state.prompts.reduce((s, p) => s + (p.useCount || 0), 0);
  $('stats').textContent = `프롬프트 ${state.prompts.length}개 · 즐겨찾기 ${favCount}개 · 총 ${total}회 사용` + (state.storageOk ? '' : ' · 저장소 사용 불가(임시 모드)');
}
function toggleChecked(id) {
  if (state.checked.has(id)) state.checked.delete(id); else state.checked.add(id);
  render();
  focusEl(`input.pick[data-id="${CSS.escape(id)}"]`);
}
function pruneChecked() {
  const ids = new Set(state.prompts.map((p) => p.id));
  for (const id of [...state.checked]) if (!ids.has(id)) state.checked.delete(id);
}

/* detail */
function select(id, scroll) {
  state.selected = id;
  state.values = defaultsOf(state.prompts.find((p) => p.id === id));
  state.diff = { a: '0', b: 'cur' };
  render();
  layout().classList.add('show-detail');
  if (scroll) { const d = $('detail'); d.scrollIntoView({ block: 'start' }); d.focus({ preventScroll: true }); }
}
function fieldFor(name, i, p) {
  const long = name.length > 12 || /내용|코드|본문|설명/.test(name);
  const id = 'var-' + i;
  const input = long ? el('textarea', { id, rows: '3' }) : el('input', { id, type: 'text' });
  input.value = typeof state.values[name] === 'string' ? state.values[name] : '';
  input.addEventListener('input', () => { Object.defineProperty(state.values, name, { value: input.value, enumerable: true, configurable: true, writable: true }); renderPreview(); });
  return el('label', { class: 'field' + (long ? ' wide' : ''), for: id },
    el('span', { class: 'flabel' }, name, hasDefault(p, name) ? el('span', { class: 'badge', text: '기본값' }) : null),
    input);
}
function renderDetail() {
  const p = current();
  $('detailEmpty').hidden = !!p; $('detailBody').hidden = !p;
  if (!p) return;
  $('detailTitle').textContent = p.title;
  $('detailMeta').textContent = `사용 ${p.useCount}회 · 최근 복사 ${fmtTime(p.lastUsedAt)}`;
  const fb = $('favBtn');
  fb.textContent = p.favorite ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기';
  fb.setAttribute('aria-pressed', String(!!p.favorite));
  const tg = $('detailTags'); tg.textContent = '';
  if (p.demo) tg.append(el('span', { class: 'chip demo', text: '예시 데이터' }));
  (p.tags || []).forEach((t) => tg.append(tagFilterBtn(t)));
  highlight($('rawBody'), p.body, null);

  const vars = extractVariables(p.body);
  const form = $('fillForm'); form.textContent = '';
  $('noVars').hidden = vars.length > 0;
  const withDef = vars.filter((n) => hasDefault(p, n));
  const rest = vars.filter((n) => !hasDefault(p, n));
  const multi = withDef.length > 0 && rest.length > 0;
  let idx = 0;
  const group = (title, names) => {
    if (!names.length) return;
    const grid = el('div', { class: 'fgrid' });
    for (const name of names) grid.append(fieldFor(name, idx++, p));
    form.append(el('fieldset', { class: 'fgroup' }, el('legend', { text: `${title} · ${names.length}개` }), grid));
  };
  group(multi ? '기본값이 있는 변수' : '변수', withDef);
  group(multi ? '직접 입력할 변수' : '변수', rest);

  renderPreview();
  renderRuns(p);
  renderHistory(p);
}
function renderPreview() {
  const p = current(); if (!p) return;
  highlight($('preview'), p.body, state.values);
  const s = textStats(renderTemplate(p.body, state.values));
  const blanks = extractVariables(p.body).filter((n) => !(typeof state.values[n] === 'string' && state.values[n] !== '')).length;
  $('countInfo').textContent = `${fmtNum(s.chars)}자 · 약 ${fmtNum(s.tokens)} 토큰 (추정)` + (blanks ? ` · 빈칸 ${blanks}개` : '');
}

/* test-run notes */
function renderRuns(p) {
  const list = $('runList'); list.textContent = '';
  const runs = p.testRuns || [];
  $('runEmpty').hidden = runs.length > 0;
  for (const r of runs) {
    list.append(el('li', { class: 'run' },
      el('div', { class: 'run-head' }, el('strong', { text: r.model }), el('span', { class: 'muted', text: fmtTime(r.at) })),
      el('pre', { class: 'code run-result', text: r.result }),
      el('div', { class: 'run-actions' },
        el('button', { class: 'btn ghost sm', type: 'button', text: '이 기록 삭제', onclick: () => deleteRun(r.id) }))));
  }
}
function addRun(e) {
  e.preventDefault();
  const p = current(); if (!p) return;
  const r = addTestRun(p.testRuns || [], { model: $('runModel').value, result: $('runResult').value }, Date.now(), uid());
  $('runErr').textContent = r.error;
  if (!r.ok) { (r.error.includes('모델') ? $('runModel') : $('runResult')).focus(); return; }
  p.testRuns = r.runs; save(); $('runResult').value = ''; render();
  toast('테스트 기록을 저장했어요.');
}
function deleteRun(id) {
  const p = current(); if (!p) return;
  p.testRuns = removeTestRun(p.testRuns || [], id); save(); render(); focusEl('#runModel'); toast('기록을 삭제했어요.');
}

/* version history */
function versionOptions(p) {
  const opts = [['cur', '현재 버전']];
  (p.history || []).forEach((h, i) => opts.push([String(i), `${i + 1}번째 이전 · ${fmtTime(h.savedAt)}`]));
  return opts;
}
function fillSelect(sel, opts, wanted, fallback) {
  sel.textContent = '';
  for (const [v, t] of opts) sel.append(el('option', { value: v, text: t }));
  sel.value = opts.some(([v]) => v === wanted) ? wanted : fallback;
  return sel.value;
}
function snapOf(p, key) {
  if (key === 'cur') return { title: p.title, body: p.body };
  const h = (p.history || [])[Number(key)];
  return h ? { title: h.title, body: h.body } : null;
}
function renderHistory(p) {
  const hist = p.history || [];
  $('verBox').hidden = hist.length === 0;
  $('verEmpty').hidden = hist.length > 0;
  if (!hist.length) { $('diffOut').textContent = ''; $('diffSum').textContent = ''; return; }
  const opts = versionOptions(p);
  state.diff.a = fillSelect($('diffA'), opts, state.diff.a, '0');
  state.diff.b = fillSelect($('diffB'), opts, state.diff.b, 'cur');
  renderDiff(p);
}
function renderDiff(p) {
  const out = $('diffOut'), sum = $('diffSum');
  out.textContent = '';
  const a = snapOf(p, state.diff.a), b = snapOf(p, state.diff.b);
  $('restoreBtn').disabled = state.diff.a === 'cur' || !a;
  if (!a || !b) { sum.textContent = ''; return; }
  const lines = diffLines(`${a.title}\n${a.body}`, `${b.title}\n${b.body}`);
  let add = 0, del = 0;
  for (const ln of lines) {
    if (ln.type === 'add') add++; else if (ln.type === 'del') del++;
    const mark = ln.type === 'add' ? '+ ' : ln.type === 'del' ? '- ' : '  ';
    out.append(el('span', { class: 'dl ' + ln.type, text: mark + ln.text }));
  }
  sum.textContent = add === 0 && del === 0 ? '두 버전의 내용이 같아요.' : `추가 ${add}줄 · 삭제 ${del}줄 (A → B)`;
}
function refreshDiff() {
  const p = current(); if (p) renderDiff(p);
}
function restoreSelected() {
  const p = current(); if (!p || state.diff.a === 'cur') return;
  const r = restoreVersion(p, Number(state.diff.a), Date.now());
  if (!r) return;
  Object.assign(p, r);
  state.values = defaultsOf(p); state.diff = { a: '0', b: 'cur' };
  save(); render(); focusEl('#diffA');
  toast('이 버전으로 복원했어요. 바꾸기 전 내용은 버전 기록에 남아 있어요.');
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
  const btn = $('copyBtn');
  btn.textContent = '복사됨 ✓'; btn.classList.add('done');
  setTimeout(() => { btn.textContent = '클립보드에 복사'; btn.classList.remove('done'); }, 1600);
  renderList(); renderTags();
  $('detailMeta').textContent = `사용 ${p.useCount}회 · 최근 복사 ${fmtTime(p.lastUsedAt)}`;
}

/* modal */
function openEdit(p) {
  state.editingId = p ? p.id : null;
  $('modalTitle').textContent = p ? '프롬프트 수정' : '새 프롬프트';
  $('fTitle').value = p ? p.title : ''; $('fTags').value = p ? p.tags.join(', ') : ''; $('fBody').value = p ? p.body : '';
  $('fDefaults').value = p ? formatDefaults(p.defaults) : '';
  for (const id of ['eTitle', 'eTags', 'eBody']) $(id).textContent = '';
  updateVarHint();
  $('modal').showModal(); $('fTitle').focus();
}
function updateVarHint() {
  const body = $('fBody').value;
  const v = extractVariables(body);
  $('varHint').textContent = v.length ? '감지된 변수: ' + v.map((x) => '{{' + x + '}}').join(', ') : '감지된 변수가 없어요.';
  const s = textStats(body);
  $('fCount').textContent = `${fmtNum(s.chars)}자 · 약 ${fmtNum(s.tokens)} 토큰 (추정)`;
}
function submitEdit(e) {
  e.preventDefault();
  const data = { title: $('fTitle').value, body: $('fBody').value, tags: $('fTags').value };
  const r = validatePrompt(data);
  $('eTitle').textContent = r.errors.title || ''; $('eTags').textContent = r.errors.tags || ''; $('eBody').textContent = r.errors.body || '';
  if (!r.ok) { (r.errors.title ? $('fTitle') : r.errors.tags ? $('fTags') : $('fBody')).focus(); return; }
  const now = Date.now(), tags = normalizeTags(data.tags);
  const defaults = parseDefaults($('fDefaults').value, extractVariables(data.body));
  const fields = { title: data.title.trim(), body: data.body, tags, defaults };
  if (state.editingId) {
    const p = state.prompts.find((x) => x.id === state.editingId);
    if (!p) { $('modal').close(); render(); toast('이미 삭제된 프롬프트예요.', 'bad'); return; }
    const history = recordVersion(p, fields, now);
    Object.assign(p, fields, { history, updatedAt: now });
    state.values = defaultsOf(p);
    state.diff = { a: '0', b: 'cur' };
    toast('수정했어요.');
  } else {
    const p = { id: uid(), ...fields, favorite: false, useCount: 0, lastUsedAt: null, createdAt: now, updatedAt: now, demo: false, history: [], testRuns: [] };
    state.prompts.push(p); state.selected = p.id; state.values = defaultsOf(p);
    toast('저장했어요.');
  }
  save(); $('modal').close(); render();
  layout().classList.add('show-detail');
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
function download(name, type, text) {
  const blob = new Blob([text], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportJson() {
  download('prompt-vault-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json',
    JSON.stringify({ app: 'prompt-vault', version: 1, exportedAt: new Date().toISOString(), prompts: state.prompts }, null, 2));
  if (recoveryRaw === null) backupState.mark();
  toast(`${state.prompts.length}개를 내보냈어요.`);
}
function exportMarkdown() {
  const p = current(); if (!p) return;
  const base = p.title.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 40) || 'prompt';
  download(base + '.md', 'text/markdown;charset=utf-8', toMarkdown(p));
  toast('Markdown 파일로 내보냈어요.');
}
function exportSelected() {
  const ids = new Set(state.checked);
  const list = state.prompts.filter((p) => ids.has(p.id));
  if (!list.length) { toast('먼저 내보낼 프롬프트를 선택해 주세요.', 'bad'); return; }
  download('prompt-vault-선택-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json',
    JSON.stringify({ app: 'prompt-vault', version: 1, exportedAt: new Date().toISOString(), prompts: list }, null, 2));
  toast(`선택한 ${list.length}개를 내보냈어요.`);
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
function toggleFavorite() {
  const p = current(); if (!p) return;
  p.favorite = !p.favorite; save(); render();
  toast(p.favorite ? '즐겨찾기에 추가했어요.' : '즐겨찾기를 해제했어요.');
}
function duplicateCurrent() {
  const p = current(); if (!p) return;
  const copy = duplicatePrompt(p, { id: uid() });
  state.prompts.push(copy); state.selected = copy.id; state.values = defaultsOf(copy); state.diff = { a: '0', b: 'cur' };
  save(); render(); layout().classList.add('show-detail');
  toast('사본을 만들었어요. 수정으로 이름을 바꿔 보세요.');
}
async function bulkDelete() {
  const ids = [...state.checked];
  if (!ids.length) return;
  if (!(await ask('선택 삭제', `선택한 프롬프트 ${ids.length}개를 삭제할까요? 되돌릴 수 없어요.`, '삭제'))) return;
  state.prompts = removeByIds(state.prompts, ids);
  if (ids.includes(state.selected)) state.selected = null;
  state.checked.clear(); state.bulk = false;
  save(); render(); focusEl('#listTitle'); toast(`${ids.length}개를 삭제했어요.`);
}

function render() {
  pruneChecked();
  if (state.selected && !current()) state.selected = null;
  renderTags(); renderList(); renderBulk(); renderDetail();
  if (!state.selected) layout().classList.remove('show-detail');
}

/* theme */
function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function syncThemeBtn() {
  $('themeBtn').textContent = currentTheme() === 'dark' ? '라이트 모드' : '다크 모드';
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  syncThemeBtn();
  try { localStorage.setItem('pv-theme', next); } catch {}
}

/* keyboard shortcuts (ignored while typing or while a dialog is open) */
function onGlobalKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === '/') {
    e.preventDefault();
    layout().classList.remove('show-detail');
    const s = $('search'); s.focus(); s.select();
  } else if (e.key === '?') {
    e.preventDefault(); $('helpDialog').showModal();
  } else if (e.key === 'n') {
    e.preventDefault(); openEdit(null);
  } else if (e.key === 'c' && current()) {
    e.preventDefault(); doCopy();
  }
}

/* wiring */
state.prompts = load();
$('recovery').hidden = recoveryRaw === null;
$('recoveryDownload').addEventListener('click', () => { if (recoveryRaw !== null) download('prompt-vault-original.json', 'application/json', recoveryRaw); });
$('recoveryReset').addEventListener('click', async () => {
  if (!(await ask('현재 기록으로 시작', '읽지 못한 원본을 현재 화면의 기록으로 덮어씁니다. 원본을 먼저 내려받았는지 확인하세요.', '시작'))) return;
  const old = recoveryRaw; recoveryRaw = null;
  if (!save()) { recoveryRaw = old; return; }
  $('recovery').hidden = true; toast('현재 기록을 저장했어요.');
});
$('themeBtn').addEventListener('click', toggleTheme);
$('helpBtn').addEventListener('click', () => $('helpDialog').showModal());
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeBtn);
$('newBtn').addEventListener('click', () => openEdit(null));
$('demoBtn').addEventListener('click', addDemo);
$('emptyDemo').addEventListener('click', addDemo);
$('search').addEventListener('input', (e) => { state.q = e.target.value; renderList(); });
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.value) { e.target.value = ''; state.q = ''; renderList(); }
});
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
$('favFilter').addEventListener('click', () => { state.fav = !state.fav; render(); });
$('bulkToggle').addEventListener('click', () => { state.bulk = !state.bulk; if (!state.bulk) state.checked.clear(); render(); });
$('bulkAllBtn').addEventListener('click', () => { for (const id of state.visible) state.checked.add(id); render(); });
$('bulkClearBtn').addEventListener('click', () => { state.checked.clear(); render(); });
$('bulkDelBtn').addEventListener('click', bulkDelete);
$('bulkExportBtn').addEventListener('click', exportSelected);
$('editForm').addEventListener('submit', submitEdit);
$('cancelBtn').addEventListener('click', () => $('modal').close());
$('fBody').addEventListener('input', updateVarHint);
for (const [field, err] of [['fTitle', 'eTitle'], ['fTags', 'eTags'], ['fBody', 'eBody']]) {
  $(field).addEventListener('input', () => { $(err).textContent = ''; });
}
$('editBtn').addEventListener('click', () => openEdit(current()));
$('favBtn').addEventListener('click', toggleFavorite);
$('dupBtn').addEventListener('click', duplicateCurrent);
$('mdBtn').addEventListener('click', exportMarkdown);
$('copyBtn').addEventListener('click', doCopy);
$('resetBtn').addEventListener('click', () => {
  const p = current(); if (!p) return;
  state.values = defaultsOf(p); renderDetail();
});
$('runForm').addEventListener('submit', addRun);
$('diffA').addEventListener('change', (e) => { state.diff.a = e.target.value; refreshDiff(); });
$('diffB').addEventListener('change', (e) => { state.diff.b = e.target.value; refreshDiff(); });
$('restoreBtn').addEventListener('click', restoreSelected);
$('backBtn').addEventListener('click', () => { layout().classList.remove('show-detail'); window.scrollTo({ top: 0 }); });
$('delBtn').addEventListener('click', async () => {
  const p = current(); if (!p) return;
  if (!(await ask('프롬프트 삭제', `"${p.title}"을(를) 삭제할까요?`, '삭제'))) return;
  state.prompts = state.prompts.filter((x) => x.id !== p.id); state.selected = null; state.checked.delete(p.id);
  save(); render(); focusEl('#listTitle'); toast('삭제했어요.');
});
$('clearBtn').addEventListener('click', async () => {
  if (!state.prompts.length) { toast('삭제할 프롬프트가 없어요.', 'bad'); return; }
  if (!(await ask('전체 삭제', `프롬프트 ${state.prompts.length}개를 모두 삭제할까요? 되돌릴 수 없어요.`, '모두 삭제'))) return;
  state.prompts = []; state.selected = null; state.tag = ''; state.fav = false; state.checked.clear(); state.bulk = false;
  save(); render(); focusEl('#listTitle'); toast('모두 삭제했어요.');
});
$('exportBtn').addEventListener('click', exportJson);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => { importJson(e.target.files[0]); e.target.value = ''; });
document.addEventListener('keydown', onGlobalKey);
syncThemeBtn();
render();
