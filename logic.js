// Pure logic — no DOM.
export const LIMITS = { title: 80, body: 8000, tag: 24, tags: 12, defaultValue: 500, versions: 5, runs: 20, model: 40, result: 2000 };

const VAR_RE = /\{\{([^{}]+?)\}\}/g;
// Hangul, kana, CJK ideographs: roughly one token per character in most tokenizers.
const CJK_RE = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/g;

export function extractVariables(text) {
  if (typeof text !== 'string' || !text) return [];
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function renderTemplate(text, values = {}) {
  if (typeof text !== 'string') return '';
  return text.replace(VAR_RE, (full, raw) => {
    const name = raw.trim();
    const v = values[name];
    return typeof v === 'string' && v !== '' ? v : '{{' + name + '}}';
  });
}

export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const out = [];
  for (const t of list) {
    const tag = String(t).trim().replace(/\s+/g, ' ').toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Rough size of a text: characters (code points) and an estimated token count. */
export function textStats(text) {
  const s = typeof text === 'string' ? text : '';
  const chars = [...s].length;
  const cjk = (s.match(CJK_RE) || []).length;
  const other = chars - cjk;
  return { chars, tokens: Math.ceil(cjk + other / 4) };
}

export function searchPrompts(prompts, query = '', tag = '', onlyFav = false) {
  const q = String(query).normalize('NFC').trim().toLowerCase();
  return prompts.filter((p) => {
    if (onlyFav && !p.favorite) return false;
    if (tag && !(p.tags || []).includes(tag)) return false;
    if (!q) return true;
    const hay = [p.title, (p.tags || []).join(' '), p.body].join('\n').normalize('NFC').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

/** Favorites always come first. "recent" is ordered by lastUsedAt, which is set on every copy. */
export function sortPrompts(prompts, mode = 'recent') {
  const arr = [...prompts];
  const t = (v) => (typeof v === 'number' ? v : 0);
  const f = (p) => (p.favorite ? 1 : 0);
  if (mode === 'recent') arr.sort((a, b) => f(b) - f(a) || t(b.lastUsedAt) - t(a.lastUsedAt) || t(b.createdAt) - t(a.createdAt));
  else if (mode === 'count') arr.sort((a, b) => f(b) - f(a) || t(b.useCount) - t(a.useCount) || t(b.createdAt) - t(a.createdAt));
  else if (mode === 'title') arr.sort((a, b) => f(b) - f(a) || String(a.title).localeCompare(String(b.title), 'ko'));
  else arr.sort((a, b) => f(b) - f(a) || t(b.createdAt) - t(a.createdAt));
  return arr;
}

export function validatePrompt({ title, body, tags } = {}) {
  const errors = {};
  const ti = String(title ?? '').trim();
  const bo = String(body ?? '').trim();
  if (!ti) errors.title = '제목을 입력해 주세요.';
  else if (ti.length > LIMITS.title) errors.title = `제목은 ${LIMITS.title}자 이하여야 해요.`;
  if (!bo) errors.body = '본문을 입력해 주세요.';
  else if (bo.length > LIMITS.body) errors.body = `본문은 ${LIMITS.body}자 이하여야 해요.`;
  const tg = normalizeTags(tags);
  if (tg.length > LIMITS.tags) errors.tags = `태그는 최대 ${LIMITS.tags}개까지 가능해요.`;
  else if (tg.some((x) => x.length > LIMITS.tag)) errors.tags = `태그는 ${LIMITS.tag}자 이하여야 해요.`;
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Keeps only non-empty string defaults, keyed by trimmed variable name, sorted by name. */
function cleanDefaults(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const name = String(k).trim();
    if (!name || typeof v !== 'string' || v === '') continue;
    out[name] = v.slice(0, LIMITS.defaultValue);
  }
  return out;
}

/** Parses "name=value" lines. If `names` is given, unknown variable names are dropped. */
export function parseDefaults(text, names) {
  const allowed = names ? new Set(names) : null;
  const obj = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (!name || !value) continue;
    if (allowed && !allowed.has(name)) continue;
    obj[name] = value;
  }
  return cleanDefaults(obj);
}

export function formatDefaults(obj) {
  return Object.entries(cleanDefaults(obj)).map(([k, v]) => `${k}=${v}`).join('\n');
}

/** The editable content of a prompt (title, body, tags, defaults), normalized for comparison. */
function fieldsOf(x) {
  const d = cleanDefaults(x.defaults);
  return {
    title: String(x.title ?? '').trim(),
    body: String(x.body ?? ''),
    tags: normalizeTags(Array.isArray(x.tags) ? x.tags : []),
    defaults: Object.fromEntries(Object.entries(d).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

function sameContent(a, b) {
  return JSON.stringify(fieldsOf(a)) === JSON.stringify(fieldsOf(b));
}

/**
 * Version history, newest first, capped at LIMITS.versions.
 * Call before applying `next` to `p`: if the content differs, p's current content is recorded.
 */
export function recordVersion(p, next, now = Date.now()) {
  const prev = Array.isArray(p.history) ? p.history : [];
  if (sameContent(p, next)) return prev.slice();
  return [{ ...fieldsOf(p), savedAt: now }, ...prev].slice(0, LIMITS.versions);
}

/** Returns the fields to apply for restoring history[index]; the current content is recorded first. */
export function restoreVersion(p, index, now = Date.now()) {
  const hist = Array.isArray(p.history) ? p.history : [];
  const snap = hist[index];
  if (!snap) return null;
  const fields = fieldsOf(snap);
  return { ...fields, history: recordVersion(p, fields, now), updatedAt: now };
}

/** Line diff from a to b (LCS). Each item: { type: 'same' | 'add' | 'del', text }. */
export function diffLines(a, b) {
  const x = String(a ?? '').split('\n');
  const y = String(b ?? '').split('\n');
  const n = x.length, m = y.length;
  const out = [];
  if (n * m > 4000000) {
    for (const t of x) out.push({ type: 'del', text: t });
    for (const t of y) out.push({ type: 'add', text: t });
    return out;
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ type: 'same', text: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: x[i] }); i++; }
    else { out.push({ type: 'add', text: y[j] }); j++; }
  }
  while (i < n) out.push({ type: 'del', text: x[i++] });
  while (j < m) out.push({ type: 'add', text: y[j++] });
  return out;
}

/** Adds a test-run note (model name typed by the user + result). Newest first, capped at LIMITS.runs. */
export function addTestRun(runs, { model, result } = {}, now = Date.now(), id) {
  const current = Array.isArray(runs) ? runs : [];
  const mo = String(model ?? '').trim();
  const re = String(result ?? '').trim();
  if (!mo) return { ok: false, error: '모델 이름을 입력해 주세요.', runs: current };
  if (mo.length > LIMITS.model) return { ok: false, error: `모델 이름은 ${LIMITS.model}자 이하여야 해요.`, runs: current };
  if (!re) return { ok: false, error: '결과를 입력해 주세요.', runs: current };
  if (re.length > LIMITS.result) return { ok: false, error: `결과는 ${LIMITS.result}자 이하여야 해요.`, runs: current };
  const entry = { id: id || 'r-' + now.toString(36) + Math.random().toString(36).slice(2, 8), model: mo, result: re, at: now };
  return { ok: true, error: '', runs: [entry, ...current].slice(0, LIMITS.runs) };
}

export function removeTestRun(runs, id) {
  return (Array.isArray(runs) ? runs : []).filter((r) => r.id !== id);
}

function cleanHistory(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const h of list) {
    if (!h || typeof h !== 'object' || typeof h.body !== 'string') continue;
    out.push({ ...fieldsOf(h), savedAt: Number.isFinite(h.savedAt) ? h.savedAt : 0 });
  }
  return out.slice(0, LIMITS.versions);
}

function cleanRuns(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) continue;
    const model = typeof r.model === 'string' ? r.model.trim().slice(0, LIMITS.model) : '';
    const result = typeof r.result === 'string' ? r.result.trim().slice(0, LIMITS.result) : '';
    if (!model || !result) continue;
    out.push({ id: r.id, model, result, at: Number.isFinite(r.at) ? r.at : 0 });
  }
  return out.slice(0, LIMITS.runs);
}

function sanitizePrompt(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (typeof p.title !== 'string' || typeof p.body !== 'string') return null;
  // Clamp over-long titles and tags instead of dropping the whole prompt.
  const title = p.title.trim().slice(0, LIMITS.title);
  const tags = normalizeTags(Array.isArray(p.tags) ? p.tags.filter((x) => typeof x === 'string') : [])
    .filter((x) => x.length <= LIMITS.tag)
    .slice(0, LIMITS.tags);
  const v = validatePrompt({ title, body: p.body, tags });
  if (!v.ok) return null;
  const num = (x, d) => (Number.isFinite(x) && x >= 0 ? x : d);
  return {
    id: p.id,
    title,
    body: p.body,
    tags,
    useCount: Math.floor(num(p.useCount, 0)),
    lastUsedAt: p.lastUsedAt == null ? null : num(p.lastUsedAt, null),
    createdAt: num(p.createdAt, Date.now()),
    updatedAt: num(p.updatedAt, num(p.createdAt, Date.now())),
    demo: p.demo === true,
    favorite: p.favorite === true,
    defaults: cleanDefaults(p.defaults),
    history: cleanHistory(p.history),
    testRuns: cleanRuns(p.testRuns),
  };
}

export function parseExport(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'JSON 형식이 올바르지 않아요.', prompts: [] }; }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.prompts) ? data.prompts : null;
  if (!list) return { ok: false, error: '프롬프트 목록을 찾을 수 없어요.', prompts: [] };
  const prompts = [];
  let invalid = 0;
  for (const item of list) {
    const s = sanitizePrompt(item);
    if (s) prompts.push(s); else invalid++;
  }
  return { ok: true, prompts, invalid };
}

export function mergeImport(existing, incoming) {
  const ids = new Set(existing.map((p) => p.id));
  const merged = [...existing];
  let added = 0, skipped = 0;
  for (const p of incoming) {
    if (ids.has(p.id)) { skipped++; continue; }
    ids.add(p.id);
    merged.push(p);
    added++;
  }
  return { merged, added, skipped };
}

/** Copy of a prompt as a new, unused entry (no history, no test runs). The caller supplies the id. */
export function duplicatePrompt(p, { id, now = Date.now() } = {}) {
  const suffix = ' (사본)';
  const base = String(p.title ?? '').trim().slice(0, LIMITS.title - suffix.length);
  return {
    id: id || 'd-' + now.toString(36) + Math.random().toString(36).slice(2, 8),
    title: base + suffix,
    body: p.body,
    tags: [...(p.tags || [])],
    defaults: { ...cleanDefaults(p.defaults) },
    favorite: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    demo: false,
    history: [],
    testRuns: [],
  };
}

/** Markdown document for one prompt: title, tags, body, and variable list with defaults. */
export function toMarkdown(p) {
  const title = String(p.title ?? '').trim() || '제목 없음';
  const tags = (p.tags || []).map((t) => '#' + t).join(' ');
  const names = extractVariables(p.body);
  const defaults = cleanDefaults(p.defaults);
  const lines = ['# ' + title, ''];
  if (tags) lines.push('태그: ' + tags, '');
  lines.push('## 프롬프트', '', String(p.body ?? ''), '');
  if (names.length) {
    lines.push('## 변수', '');
    for (const n of names) lines.push('- `{{' + n + '}}`' + (defaults[n] ? ` (기본값: ${defaults[n]})` : ''));
    lines.push('');
  }
  return lines.join('\n');
}

export function removeByIds(prompts, ids) {
  const drop = new Set(ids);
  return prompts.filter((p) => !drop.has(p.id));
}

export function demoPrompts(now = Date.now()) {
  const mk = (i, title, tags, body, defaults = {}) => ({
    id: 'demo-' + i, title, tags, body, useCount: 0, lastUsedAt: null,
    createdAt: now - i * 60000, updatedAt: now - i * 60000, demo: true, favorite: i === 1, defaults,
  });
  return [
    mk(1, '블로그 글 개요 짜기', ['글쓰기', '블로그'], '당신은 경력 10년차 콘텐츠 에디터입니다.\n주제: {{주제}}\n독자: {{독자}}\n\n위 주제로 블로그 글 개요를 작성해 주세요. 제목 후보 3개, 소제목 5개, 각 소제목별 핵심 문장을 포함해 주세요. 톤은 {{톤}}으로 해 주세요.', { 톤: '친근하게' }),
    mk(2, '코드 리뷰 요청', ['개발', '리뷰'], '아래 {{언어}} 코드를 리뷰해 주세요. 버그, 가독성, 성능, 보안 순서로 짚어 주고 개선된 코드를 제시해 주세요.\n\n```\n{{코드}}\n```', { 언어: 'JavaScript' }),
    mk(3, '이메일 답장 작성', ['업무', '이메일'], '{{받는사람}}님께 보낼 답장을 작성해 주세요.\n받은 메일 요약: {{받은내용}}\n내가 전달할 핵심: {{핵심메시지}}\n정중하지만 간결하게, 3문단 이내로 부탁해요.'),
    mk(4, '회의록 요약', ['업무', '요약'], '다음 회의 내용을 결정사항, 할 일(담당자/기한), 미결 이슈로 나눠 요약해 주세요.\n\n{{회의내용}}'),
    mk(5, '영어 문장 교정', ['학습', '영어'], '다음 영어 문장을 {{레벨}} 수준에 맞게 자연스럽게 고치고, 바뀐 이유를 한국어로 설명해 주세요.\n\n{{문장}}', { 레벨: '중급' }),
  ];
}
