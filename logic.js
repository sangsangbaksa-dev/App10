// Pure logic — no DOM.
export const LIMITS = { title: 80, body: 8000, tag: 24, tags: 12 };

const VAR_RE = /\{\{([^{}]+?)\}\}/g;

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

export function searchPrompts(prompts, query = '', tag = '') {
  const q = String(query).normalize('NFC').trim().toLowerCase();
  return prompts.filter((p) => {
    if (tag && !(p.tags || []).includes(tag)) return false;
    if (!q) return true;
    const hay = [p.title, (p.tags || []).join(' '), p.body].join('\n').normalize('NFC').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

export function sortPrompts(prompts, mode = 'recent') {
  const arr = [...prompts];
  const t = (v) => (typeof v === 'number' ? v : 0);
  if (mode === 'recent') arr.sort((a, b) => t(b.lastUsedAt) - t(a.lastUsedAt) || t(b.createdAt) - t(a.createdAt));
  else if (mode === 'count') arr.sort((a, b) => t(b.useCount) - t(a.useCount) || t(b.createdAt) - t(a.createdAt));
  else arr.sort((a, b) => t(b.createdAt) - t(a.createdAt));
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

function sanitizePrompt(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (typeof p.title !== 'string' || typeof p.body !== 'string') return null;
  const tags = normalizeTags(Array.isArray(p.tags) ? p.tags.filter((x) => typeof x === 'string') : []);
  const v = validatePrompt({ title: p.title, body: p.body, tags });
  if (!v.ok) return null;
  const num = (x, d) => (Number.isFinite(x) && x >= 0 ? x : d);
  return {
    id: p.id,
    title: p.title.trim(),
    body: p.body,
    tags,
    useCount: Math.floor(num(p.useCount, 0)),
    lastUsedAt: p.lastUsedAt == null ? null : num(p.lastUsedAt, null),
    createdAt: num(p.createdAt, Date.now()),
    updatedAt: num(p.updatedAt, num(p.createdAt, Date.now())),
    demo: p.demo === true,
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

export function demoPrompts(now = Date.now()) {
  const mk = (i, title, tags, body) => ({
    id: 'demo-' + i, title, tags, body, useCount: 0, lastUsedAt: null,
    createdAt: now - i * 60000, updatedAt: now - i * 60000, demo: true,
  });
  return [
    mk(1, '블로그 글 개요 짜기', ['글쓰기', '블로그'], '당신은 경력 10년차 콘텐츠 에디터입니다.\n주제: {{주제}}\n독자: {{독자}}\n\n위 주제로 블로그 글 개요를 작성해 주세요. 제목 후보 3개, 소제목 5개, 각 소제목별 핵심 문장을 포함해 주세요. 톤은 {{톤}}으로 해 주세요.'),
    mk(2, '코드 리뷰 요청', ['개발', '리뷰'], '아래 {{언어}} 코드를 리뷰해 주세요. 버그, 가독성, 성능, 보안 순서로 짚어 주고 개선된 코드를 제시해 주세요.\n\n```\n{{코드}}\n```'),
    mk(3, '이메일 답장 작성', ['업무', '이메일'], '{{받는사람}}님께 보낼 답장을 작성해 주세요.\n받은 메일 요약: {{받은내용}}\n내가 전달할 핵심: {{핵심메시지}}\n정중하지만 간결하게, 3문단 이내로 부탁해요.'),
    mk(4, '회의록 요약', ['업무', '요약'], '다음 회의 내용을 결정사항, 할 일(담당자/기한), 미결 이슈로 나눠 요약해 주세요.\n\n{{회의내용}}'),
    mk(5, '영어 문장 교정', ['학습', '영어'], '다음 영어 문장을 {{레벨}} 수준에 맞게 자연스럽게 고치고, 바뀐 이유를 한국어로 설명해 주세요.\n\n{{문장}}'),
  ];
}
