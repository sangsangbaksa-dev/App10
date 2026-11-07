import {
  extractVariables, renderTemplate, normalizeTags, searchPrompts, sortPrompts, validatePrompt,
  mergeImport, parseExport, demoPrompts, textStats, duplicatePrompt, toMarkdown,
  parseDefaults, formatDefaults, removeByIds, recordVersion, restoreVersion, diffLines,
  addTestRun, removeTestRun, rememberValues, parseRecent, suggestionsFor, RECENT,
} from './logic.js';
import {
  t, setLang, getLang, detectLang, readSavedLang, saveLang, applyI18n, LANGS, fmtNumber, fmtDateTime,
} from './i18n.js';

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
const fmtNum = (n) => fmtNumber(n);

const state = {
  prompts: [], q: '', tag: '', fav: false, sort: 'recent', selected: null, values: {},
  editingId: null, storageOk: true, bulk: false, checked: new Set(), visible: [], recent: {},
  diff: { a: '0', b: 'cur' },
};

/* storage */
const BACKUP_KEY = KEY + '-backup';
const RECENT_KEY = 'pv-recent-values-v1'; // per-browser quick picks, separate from prompt data
function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { state.storageOk = false; return []; }
  if (!raw) return [];
  const r = parseExport(raw);
  if (!r.ok || r.invalid > 0) {
    // Keep the original text so unreadable entries are not lost on the next save.
    try { localStorage.setItem(BACKUP_KEY, raw); } catch {}
    toast(r.ok ? t('errUnreadable', { n: r.invalid, key: BACKUP_KEY }) : t('errReadSaved', { key: BACKUP_KEY }), 'bad');
  }
  return r.ok ? r.prompts : [];
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state.prompts)); state.storageOk = true; }
  catch { if (state.storageOk) toast(t('toastStorage'), 'bad'); state.storageOk = false; }
}

/* helpers */
function toast(msg, kind = 'ok') {
  const tn = el('div', { class: 'toast ' + kind, text: msg });
  $('toasts').append(tn);
  setTimeout(() => { tn.classList.add('out'); setTimeout(() => tn.remove(), 350); }, 2600);
}
function uid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function hueOf(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
function fmtTime(ts) {
  if (!ts) return t('timeNone');
  const diff = Date.now() - ts, m = 60000;
  if (diff < m) return t('timeJust');
  if (diff < 60 * m) return t('timeMin', { n: Math.floor(diff / m) });
  if (diff < 24 * 60 * m) return t('timeHour', { n: Math.floor(diff / 60 / m) });
  return fmtDateTime(ts);
}
function tagChip(tg) { const c = el('span', { class: 'chip', text: t('tagChipLabel', { t: tg }) }); c.style.setProperty('--h', hueOf(tg)); return c; }
function tagFilterBtn(tg) {
  const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.tag === tg), title: t('tagFilterTitle'), text: t('tagChipLabel', { t: tg }),
    onclick: () => { state.tag = state.tag === tg ? '' : tg; layout().classList.remove('show-detail'); render(); focusEl(`#tagBar [data-tag="${CSS.escape(tg)}"]`); } });
  c.style.setProperty('--h', hueOf(tg));
  return c;
}
function current() { return state.prompts.find((p) => p.id === state.selected) || null; }
/* keep keyboard focus on a sensible control after a re-render */
function focusEl(sel) { const n = document.querySelector(sel); if (n) n.focus(); }
function defaultsOf(p) { return { ...(p && p.defaults ? p.defaults : {}) }; }
function hasDefault(p, name) { return typeof (p.defaults || {})[name] === 'string'; }

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
  for (const p of state.prompts) for (const tg of p.tags) counts.set(tg, (counts.get(tg) || 0) + 1);
  for (const [tg, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], getLang()))) {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.tag === tg), text: t('countTag', { t: tg, n }), 'data-tag': tg,
      onclick: () => { state.tag = state.tag === tg ? '' : tg; render(); focusEl(`#tagBar [data-tag="${CSS.escape(tg)}"]`); } });
    b.style.setProperty('--h', hueOf(tg));
    bar.append(b);
  }
  const fav = $('favFilter');
  fav.setAttribute('aria-pressed', String(state.fav));
  fav.textContent = t('favFilterOnly', { n: state.prompts.filter((p) => p.favorite).length });
}
function renderBulk() {
  const n = state.checked.size;
  $('bulkBar').hidden = !state.bulk;
  $('bulkCount').textContent = t('bulkCount', { n });
  $('bulkDelBtn').disabled = n === 0;
  const tg = $('bulkToggle');
  tg.textContent = state.bulk ? t('bulkToggleOff') : t('bulkToggleOn');
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
      el('span', { class: 'card-title' }, p.title),
      el('span', { class: 'card-body', text: p.body }),
      el('span', { class: 'card-foot' },
        el('span', { text: t('cardUse', { n: p.useCount }) }),
        el('span', { text: t('cardLast', { t: fmtTime(p.lastUsedAt) }) })));
    const li = el('li', { class: 'card' + (isSel ? ' active' : '') + (state.bulk ? ' bulk' : '') + (isChecked ? ' checked' : '') + (p.favorite ? ' fav' : '') }, btn);
    if (state.bulk) {
      const cb = el('input', { type: 'checkbox', class: 'pick', 'aria-label': t('pickLabel', { title: p.title }), 'data-id': p.id });
      cb.checked = isChecked;
      cb.addEventListener('change', () => toggleChecked(p.id));
      li.append(cb);
    }
    const chips = el('span', { class: 'chips' });
    if (p.demo) chips.append(el('span', { class: 'chip demo', text: t('demoTag') }));
    (p.tags || []).forEach((tg) => chips.append(tagChip(tg)));
    if (chips.childNodes.length) btn.append(chips);
    list.append(li);
  }
  const none = state.prompts.length === 0;
  $('empty').hidden = items.length > 0;
  $('emptyMsg').textContent = none ? t('emptyNone') : t('emptyNoMatch');
  $('emptyDemo').hidden = !none;
  const favCount = state.prompts.filter((p) => p.favorite).length;
  const total = state.prompts.reduce((s, p) => s + (p.useCount || 0), 0);
  $('stats').textContent = t('statsLine', { n: state.prompts.length, fav: favCount, total }) + (state.storageOk ? '' : t('statsTemp'));
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
function loadRecent() {
  try { return parseRecent(localStorage.getItem(RECENT_KEY) || 'null'); } catch { return {}; }
}
function saveRecent() {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent)); } catch {}
}
function fieldFor(name, i, p) {
  const long = name.length > 12 || /내용|코드|본문|설명|内容|コード|本文|代码|código|contenido|content|code|body|description|text/i.test(name);
  const id = 'var-' + i;
  const input = long ? el('textarea', { id, rows: '3' }) : el('input', { id, type: 'text' });
  input.value = typeof state.values[name] === 'string' ? state.values[name] : '';
  input.addEventListener('input', () => { state.values[name] = input.value; renderPreview(); });
  const label = el('label', { class: 'field', for: id },
    el('span', { class: 'flabel' }, name, hasDefault(p, name) ? el('span', { class: 'badge', text: t('flagDefault') }) : null),
    input);
  const wrap = el('div', { class: 'fwrap' + (long ? ' wide' : '') }, label);
  const picks = suggestionsFor(state.recent, name, RECENT.shown);
  if (picks.length) {
    const row = el('div', { class: 'qpicks', role: 'group', 'aria-label': t('recentGroup', { name }) });
    row.append(el('span', { class: 'qpicks-label', text: t('recentLabel') }));
    for (const v of picks) {
      row.append(el('button', { class: 'qpick', type: 'button', title: t('recentTitle', { v }),
        'aria-label': t('recentPick', { v }), text: v.length > 24 ? v.slice(0, 24) + '…' : v,
        onclick: () => { input.value = v; state.values[name] = v; renderPreview(); input.focus(); } }));
    }
    wrap.append(row);
  }
  return wrap;
}
function renderDetail() {
  const p = current();
  $('detailEmpty').hidden = !!p; $('detailBody').hidden = !p;
  if (!p) return;
  $('detailTitle').textContent = p.title;
  $('detailMeta').textContent = t('cardUse', { n: p.useCount }) + ' · ' + t('cardLast', { t: fmtTime(p.lastUsedAt) });
  const fb = $('favBtn');
  fb.textContent = p.favorite ? t('favRemove') : t('favAdd');
  fb.setAttribute('aria-pressed', String(!!p.favorite));
  const tg = $('detailTags'); tg.textContent = '';
  if (p.demo) tg.append(el('span', { class: 'chip demo', text: t('demoTag') }));
  (p.tags || []).forEach((x) => tg.append(tagFilterBtn(x)));
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
    form.append(el('fieldset', { class: 'fgroup' }, el('legend', { text: `${title} · ${t('varsCount', { n: names.length })}` }), grid));
  };
  group(multi ? t('varsDefault') : t('varsAll'), withDef);
  group(multi ? t('varsInput') : t('varsAll'), rest);

  renderPreview();
  renderRuns(p);
  renderHistory(p);
}
function renderPreview() {
  const p = current(); if (!p) return;
  highlight($('preview'), p.body, state.values);
  const s = textStats(renderTemplate(p.body, state.values));
  const blanks = extractVariables(p.body).filter((n) => !(typeof state.values[n] === 'string' && state.values[n] !== '')).length;
  $('countInfo').textContent = t('countInfo', { chars: fmtNum(s.chars), tok: fmtNum(s.tokens) }) + (blanks ? t('blanks', { n: blanks }) : '');
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
        el('button', { class: 'btn ghost sm', type: 'button', text: t('runDelete'), onclick: () => deleteRun(r.id) }))));
  }
}
function addRun(e) {
  e.preventDefault();
  const p = current(); if (!p) return;
  const r = addTestRun(p.testRuns || [], { model: $('runModel').value, result: $('runResult').value }, Date.now(), uid());
  $('runErr').textContent = r.error;
  if (!r.ok) { (r.error === t('errModelEmpty') || r.error === t('errModelLong') ? $('runModel') : $('runResult')).focus(); return; }
  p.testRuns = r.runs; save(); $('runResult').value = ''; render();
  toast(t('toastRunSaved'));
}
function deleteRun(id) {
  const p = current(); if (!p) return;
  p.testRuns = removeTestRun(p.testRuns || [], id); save(); render(); focusEl('#runModel'); toast(t('toastRunDel'));
}

/* version history */
function versionOptions(p) {
  const opts = [['cur', t('verCur')]];
  (p.history || []).forEach((h, i) => opts.push([String(i), t('verNth', { n: i + 1, t: fmtTime(h.savedAt) })]));
  return opts;
}
function fillSelect(sel, opts, wanted, fallback) {
  sel.textContent = '';
  for (const [v, tx] of opts) sel.append(el('option', { value: v, text: tx }));
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
  sum.textContent = add === 0 && del === 0 ? t('diffSame') : t('diffSum', { add, del });
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
  toast(t('toastRestored'));
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
  if (!ok) { toast(t('copyFail'), 'bad'); return; }
  p.useCount += 1; p.lastUsedAt = Date.now();
  const filled = {};
  for (const n of extractVariables(p.body)) if (typeof state.values[n] === 'string' && state.values[n] !== '') filled[n] = state.values[n];
  if (Object.keys(filled).length) { state.recent = rememberValues(state.recent, filled); saveRecent(); }
  save(); toast(t('toastCopied'));
  const btn = $('copyBtn');
  btn.textContent = t('copiedBtn'); btn.classList.add('done');
  setTimeout(() => { btn.textContent = t('copyBtn'); btn.classList.remove('done'); }, 1600);
  renderList(); renderTags();
  $('detailMeta').textContent = t('cardUse', { n: p.useCount }) + ' · ' + t('cardLast', { t: fmtTime(p.lastUsedAt) });
}

/* modal */
function openEdit(p) {
  state.editingId = p ? p.id : null;
  $('modalTitle').textContent = p ? t('modalEdit') : t('modalNew');
  $('fTitle').value = p ? p.title : ''; $('fTags').value = p ? p.tags.join(', ') : ''; $('fBody').value = p ? p.body : '';
  $('fDefaults').value = p ? formatDefaults(p.defaults) : '';
  for (const id of ['eTitle', 'eTags', 'eBody']) $(id).textContent = '';
  updateVarHint();
  $('modal').showModal(); $('fTitle').focus();
}
function updateVarHint() {
  const body = $('fBody').value;
  const v = extractVariables(body);
  $('varHint').textContent = v.length ? t('varHint', { list: v.map((x) => '{{' + x + '}}').join(', ') }) : t('varHintNone');
  const s = textStats(body);
  $('fCount').textContent = t('fCount', { chars: fmtNum(s.chars), tok: fmtNum(s.tokens) });
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
    if (!p) { $('modal').close(); render(); toast(t('toastBroken'), 'bad'); return; }
    const history = recordVersion(p, fields, now);
    Object.assign(p, fields, { history, updatedAt: now });
    state.values = defaultsOf(p);
    state.diff = { a: '0', b: 'cur' };
    toast(t('toastEdited'));
  } else {
    const p = { id: uid(), ...fields, favorite: false, useCount: 0, lastUsedAt: null, createdAt: now, updatedAt: now, demo: false, history: [], testRuns: [] };
    state.prompts.push(p); state.selected = p.id; state.values = defaultsOf(p);
    toast(t('toastSaved'));
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
  toast(t('toastExported', { n: state.prompts.length }));
}
function exportMarkdown() {
  const p = current(); if (!p) return;
  const base = p.title.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 40) || 'prompt';
  download(base + '.md', 'text/markdown;charset=utf-8', toMarkdown(p));
  toast(t('toastMd'));
}
function exportSelected() {
  const ids = new Set(state.checked);
  const list = state.prompts.filter((p) => ids.has(p.id));
  if (!list.length) { toast(t('exportNone'), 'bad'); return; }
  download('prompt-vault-selected-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json',
    JSON.stringify({ app: 'prompt-vault', version: 1, exportedAt: new Date().toISOString(), prompts: list }, null, 2));
  toast(t('toastExportSel', { n: list.length }));
}
async function importJson(file) {
  if (!file) return;
  let text;
  try { text = await file.text(); } catch { toast(t('fileRead'), 'bad'); return; }
  const r = parseExport(text);
  if (!r.ok) { toast(r.error, 'bad'); return; }
  const m = mergeImport(state.prompts, r.prompts);
  state.prompts = m.merged; save(); render();
  toast(t('toastImportDone', { added: m.added, skipped: m.skipped, invalid: r.invalid }));
}
function addDemo() {
  const m = mergeImport(state.prompts, demoPrompts());
  state.prompts = m.merged; save(); render();
  toast(m.added ? t('toastDemoAdded', { n: m.added }) : t('toastDemoHave'));
}
function toggleFavorite() {
  const p = current(); if (!p) return;
  p.favorite = !p.favorite; save(); render();
  toast(p.favorite ? t('toastFavOn') : t('toastFavOff'));
}
function duplicateCurrent() {
  const p = current(); if (!p) return;
  const copy = duplicatePrompt(p, { id: uid() });
  state.prompts.push(copy); state.selected = copy.id; state.values = defaultsOf(copy); state.diff = { a: '0', b: 'cur' };
  save(); render(); layout().classList.add('show-detail');
  toast(t('toastDup'));
}
async function bulkDelete() {
  const ids = [...state.checked];
  if (!ids.length) return;
  if (!(await ask(t('bulkDelTitle'), t('bulkDelMsg', { n: ids.length }), t('bulkDelOk')))) return;
  state.prompts = removeByIds(state.prompts, ids);
  if (ids.includes(state.selected)) state.selected = null;
  state.checked.clear(); state.bulk = false;
  save(); render(); focusEl('#listTitle'); toast(t('toastBulkDeleted', { n: ids.length }));
}

function render() {
  pruneChecked();
  if (state.selected && !current()) state.selected = null;
  renderTags(); renderList(); renderBulk(); renderDetail();
  if (!state.selected) layout().classList.remove('show-detail');
}

/* theme */
function currentTheme() {
  const th = document.documentElement.getAttribute('data-theme');
  if (th) return th;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function syncThemeBtn() {
  $('themeBtn').textContent = currentTheme() === 'dark' ? t('themeLight') : t('themeDark');
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  syncThemeBtn();
  try { localStorage.setItem('pv-theme', next); } catch {}
}

/* language */
function applyLanguage(code) {
  setLang(code);
  saveLang(code);
  applyI18n();
  document.title = t('docTitle');
  document.querySelector('meta[name="description"]').setAttribute('content', t('metaDesc'));
  $('langSelect').value = getLang();
  syncThemeBtn();
  render();
}

/* keyboard shortcuts (ignored while typing or while a dialog is open) */
function onGlobalKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tg = e.target;
  if (tg && (tg.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tg.tagName))) return;
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
setLang(detectLang(readSavedLang()));
{
  const sel = $('langSelect');
  sel.replaceChildren(...Object.entries(LANGS).map(([k, v]) => el('option', { value: k, text: v.name })));
  sel.value = getLang();
  sel.addEventListener('change', (e) => applyLanguage(e.target.value));
}
applyI18n();
document.title = t('docTitle');
document.querySelector('meta[name="description"]').setAttribute('content', t('metaDesc'));
state.prompts = load();
state.recent = loadRecent();
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
  if (!(await ask(t('delTitle'), t('delMsg', { title: p.title }), t('delOk')))) return;
  state.prompts = state.prompts.filter((x) => x.id !== p.id); state.selected = null; state.checked.delete(p.id);
  save(); render(); focusEl('#listTitle'); toast(t('toastDeleted'));
});
$('clearBtn').addEventListener('click', async () => {
  if (!state.prompts.length) { toast(t('toastClearNone'), 'bad'); return; }
  if (!(await ask(t('clearTitle'), t('clearMsg', { n: state.prompts.length }), t('clearOk')))) return;
  state.prompts = []; state.selected = null; state.tag = ''; state.fav = false; state.checked.clear(); state.bulk = false;
  save(); render(); focusEl('#listTitle'); toast(t('toastCleared'));
});
$('exportBtn').addEventListener('click', exportJson);
$('clearRecentBtn').addEventListener('click', () => {
  state.recent = {}; saveRecent(); renderDetail(); toast(t('toastRecentCleared'));
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => { importJson(e.target.files[0]); e.target.value = ''; });
document.addEventListener('keydown', onGlobalKey);
syncThemeBtn();
render();
