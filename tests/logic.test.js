import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVariables, renderTemplate, normalizeTags, searchPrompts, sortPrompts, validatePrompt, mergeImport, parseExport, demoPrompts, textStats, parseDefaults, formatDefaults, duplicatePrompt, toMarkdown, removeByIds, recordVersion, restoreVersion, diffLines, addTestRun, removeTestRun, LIMITS } from '../logic.js';

test('extractVariables: unique, in order', () => {
  assert.deepEqual(extractVariables('{{a}} {{b}} {{a}} {{c}}'), ['a', 'b', 'c']);
});
test('extractVariables: spaces and Korean names', () => {
  assert.deepEqual(extractVariables('{{ 주제 }} {{first name}} {{주제}}'), ['주제', 'first name']);
});
test('extractVariables: nested/odd braces', () => {
  assert.deepEqual(extractVariables('{{{x}}}'), ['x']);
  assert.deepEqual(extractVariables('{{a{{b}}'), ['b']);
  assert.deepEqual(extractVariables('{ {a} } {{}} {{  }}'), []);
});
test('extractVariables: empty / non-string', () => {
  assert.deepEqual(extractVariables(''), []);
  assert.deepEqual(extractVariables(null), []);
});
test('renderTemplate fills and keeps unfilled', () => {
  assert.equal(renderTemplate('안녕 {{이름}}, {{x}}', { 이름: '민수' }), '안녕 민수, {{x}}');
  assert.equal(renderTemplate('{{ a }}', { a: '' }), '{{a}}');
  assert.equal(renderTemplate('{{a}}{{a}}', { a: '1' }), '11');
  assert.equal(renderTemplate('', {}), '');
});
test('renderTemplate does not re-expand values', () => {
  assert.equal(renderTemplate('{{a}} {{b}}', { a: '{{b}}', b: 'X' }), '{{b}} X');
});
test('normalizeTags', () => {
  assert.deepEqual(normalizeTags(' AI, ai , Dev,,  글쓰기 ,DEV'), ['ai', 'dev', '글쓰기']);
  assert.deepEqual(normalizeTags(''), []);
  assert.deepEqual(normalizeTags(['A', 'a', ' b ']), ['a', 'b']);
});
const P = [
  { id: '1', title: '블로그 개요', tags: ['글쓰기'], body: 'Hello World', createdAt: 1, useCount: 5, lastUsedAt: 10 },
  { id: '2', title: 'Code Review', tags: ['dev'], body: '버그를 찾아줘', createdAt: 3, useCount: 1, lastUsedAt: 30 },
  { id: '3', title: 'Mail', tags: ['업무'], body: 'x', createdAt: 2, useCount: 9, lastUsedAt: null },
];
test('searchPrompts: Korean, case-insensitive, tags, body', () => {
  assert.deepEqual(searchPrompts(P, '블로그').map((p) => p.id), ['1']);
  assert.deepEqual(searchPrompts(P, 'CODE').map((p) => p.id), ['2']);
  assert.deepEqual(searchPrompts(P, '버그').map((p) => p.id), ['2']);
  assert.deepEqual(searchPrompts(P, '업무').map((p) => p.id), ['3']);
  assert.equal(searchPrompts(P, '').length, 3);
  assert.deepEqual(searchPrompts(P, '', 'dev').map((p) => p.id), ['2']);
  assert.deepEqual(searchPrompts(P, 'hello world').map((p) => p.id), ['1']);
});
test('searchPrompts: NFD input matches NFC text', () => {
  assert.equal(searchPrompts(P, '블로그'.normalize('NFD')).length, 1);
});
test('sortPrompts modes, no mutation', () => {
  const copy = [...P];
  assert.deepEqual(sortPrompts(P, 'recent').map((p) => p.id), ['2', '1', '3']);
  assert.deepEqual(sortPrompts(P, 'count').map((p) => p.id), ['3', '1', '2']);
  assert.deepEqual(sortPrompts(P, 'newest').map((p) => p.id), ['2', '3', '1']);
  assert.deepEqual(P, copy);
});
test('validatePrompt', () => {
  assert.equal(validatePrompt({ title: '', body: 'x' }).ok, false);
  assert.ok(validatePrompt({ title: 't', body: ' ' }).errors.body);
  assert.ok(validatePrompt({ title: 'a'.repeat(81), body: 'x' }).errors.title);
  assert.ok(validatePrompt({ title: 't', body: 'a'.repeat(8001) }).errors.body);
  assert.ok(validatePrompt({ title: 't', body: 'x', tags: 'a'.repeat(30) }).errors.tags);
  assert.equal(validatePrompt({ title: 't', body: 'x', tags: 'a,b' }).ok, true);
  assert.equal(validatePrompt().ok, false);
});
test('parseExport rejects malformed JSON and shapes', () => {
  assert.equal(parseExport('{not json').ok, false);
  assert.equal(parseExport('{"a":1}').ok, false);
  assert.equal(parseExport('42').ok, false);
  assert.equal(parseExport('').ok, false);
});
test('parseExport accepts array or {prompts}, counts invalid', () => {
  const good = { id: 'a', title: 'T', body: 'B', tags: ['X', 'x'] };
  const r = parseExport(JSON.stringify({ prompts: [good, { id: 'b' }, null, { id: 'c', title: '', body: 'x' }] }));
  assert.equal(r.ok, true);
  assert.equal(r.prompts.length, 1);
  assert.equal(r.invalid, 3);
  assert.deepEqual(r.prompts[0].tags, ['x']);
  assert.equal(parseExport(JSON.stringify([good])).prompts.length, 1);
});
test('mergeImport skips duplicate ids', () => {
  const ex = [{ id: 'a', title: 'old' }];
  const r = mergeImport(ex, [{ id: 'a', title: 'new' }, { id: 'b' }, { id: 'b' }]);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.merged.length, 2);
  assert.equal(r.merged[0].title, 'old');
});
test('demoPrompts: 5 valid labeled demos', () => {
  const d = demoPrompts();
  assert.equal(d.length, 5);
  assert.ok(d.every((p) => p.demo && validatePrompt(p).ok && extractVariables(p.body).length > 0));
});
test('searchPrompts: onlyFav filter', () => {
  const F = [{ id: 'a', title: 'x', tags: [], body: 'y', favorite: true }, { id: 'b', title: 'x', tags: [], body: 'y' }];
  assert.deepEqual(searchPrompts(F, '', '', true).map((p) => p.id), ['a']);
  assert.equal(searchPrompts(F).length, 2);
});
test('sortPrompts: favorites come first in every mode', () => {
  const F = [{ id: 'x', createdAt: 5, useCount: 9, lastUsedAt: 9 }, { id: 'y', createdAt: 1, useCount: 0, lastUsedAt: null, favorite: true }];
  for (const mode of ['recent', 'count', 'newest']) assert.deepEqual(sortPrompts(F, mode).map((p) => p.id), ['y', 'x']);
});
test('textStats: chars and rough token estimate', () => {
  assert.deepEqual(textStats(''), { chars: 0, tokens: 0 });
  assert.deepEqual(textStats(null), { chars: 0, tokens: 0 });
  assert.deepEqual(textStats('abcd'), { chars: 4, tokens: 1 });
  assert.deepEqual(textStats('안녕'), { chars: 2, tokens: 2 });
  assert.equal(textStats('a'.repeat(9)).tokens, 3);
});
test('parseDefaults and formatDefaults', () => {
  assert.deepEqual(
    parseDefaults('언어=한국어\n톤 = 친근 \n=없음\n잘못\n주제=a=b\n모름=x', ['언어', '톤', '주제']),
    { 언어: '한국어', 톤: '친근', 주제: 'a=b' },
  );
  assert.equal(formatDefaults({ b: '2', a: '1' }), 'b=2\na=1');
  assert.deepEqual(parseDefaults(formatDefaults({ a: '1' })), { a: '1' });
});
test('duplicatePrompt: new id, unused, title suffix within limit', () => {
  const src = { id: 'a', title: 'T'.repeat(80), body: 'B {{x}}', tags: ['t'], defaults: { x: '1' }, favorite: true, useCount: 4, lastUsedAt: 9, createdAt: 1, updatedAt: 1, demo: true };
  const d = duplicatePrompt(src, { id: 'b', now: 100 });
  assert.equal(d.id, 'b');
  assert.ok(d.title.endsWith(' (사본)'));
  assert.ok(d.title.length <= 80);
  assert.equal(d.body, src.body);
  assert.deepEqual(d.defaults, { x: '1' });
  assert.notStrictEqual(d.tags, src.tags);
  assert.equal(d.favorite, false);
  assert.equal(d.useCount, 0);
  assert.equal(d.lastUsedAt, null);
  assert.equal(d.demo, false);
  assert.equal(d.createdAt, 100);
  assert.ok(validatePrompt(d).ok);
});
test('toMarkdown: title, tags, body, variables with defaults', () => {
  const md = toMarkdown({ title: '개요', tags: ['글쓰기'], body: '주제: {{주제}}', defaults: { 주제: 'AI' } });
  assert.ok(md.startsWith('# 개요\n'));
  assert.ok(md.includes('태그: #글쓰기'));
  assert.ok(md.includes('주제: {{주제}}'));
  assert.ok(md.includes('- `{{주제}}` (기본값: AI)'));
});
test('removeByIds', () => {
  assert.deepEqual(removeByIds([{ id: '1' }, { id: '2' }, { id: '3' }], ['1', '3']).map((p) => p.id), ['2']);
});
test('parseExport keeps favorite and defaults, drops junk defaults', () => {
  const r = parseExport(JSON.stringify([{ id: 'f', title: 'T', body: 'B {{x}}', favorite: true, defaults: { x: '1', '': '2', y: 3 } }]));
  assert.equal(r.prompts[0].favorite, true);
  assert.deepEqual(r.prompts[0].defaults, { x: '1' });
  const old = parseExport(JSON.stringify([{ id: 'o', title: 'T', body: 'B' }])).prompts[0];
  assert.equal(old.favorite, false);
  assert.deepEqual(old.defaults, {});
});
test('parseExport clamps over-long title and tags instead of dropping the prompt', () => {
  const item = { id: 'l', title: 'T'.repeat(90), body: 'B', tags: Array.from({ length: 15 }, (_, i) => 't' + i) };
  const r = parseExport(JSON.stringify([item]));
  assert.equal(r.prompts.length, 1);
  assert.equal(r.prompts[0].title.length, LIMITS.title);
  assert.equal(r.prompts[0].tags.length, LIMITS.tags);
});
test('sortPrompts: title mode (Korean collation), favorites still first', () => {
  const T = [{ id: 'b', title: '나' }, { id: 'a', title: '가' }, { id: 'c', title: '다', favorite: true }];
  assert.deepEqual(sortPrompts(T, 'title').map((p) => p.id), ['c', 'a', 'b']);
});
test('recordVersion: records previous content only when it changed, newest first, capped', () => {
  const p = { title: 'T', body: 'A', tags: ['x'], defaults: {}, history: [] };
  assert.deepEqual(recordVersion(p, { title: 'T', body: 'A', tags: ['x'], defaults: {} }, 5), []);
  const h1 = recordVersion(p, { title: 'T', body: 'B', tags: ['x'], defaults: {} }, 5);
  assert.equal(h1.length, 1);
  assert.equal(h1[0].body, 'A');
  assert.equal(h1[0].savedAt, 5);
  let cur = { ...p, history: h1 };
  for (let i = 0; i < 10; i++) {
    const next = { title: 'T', body: 'v' + i, tags: ['x'], defaults: {} };
    cur = { ...cur, ...next, history: recordVersion(cur, next, i) };
  }
  assert.equal(cur.history.length, LIMITS.versions);
  assert.equal(cur.history[0].body, 'v8');
});
test('restoreVersion: applies snapshot and records the current content', () => {
  const p = { title: 'New', body: 'B', tags: [], defaults: {}, history: [{ title: 'Old', body: 'A', tags: ['t'], defaults: { x: '1' }, savedAt: 1 }] };
  const r = restoreVersion(p, 0, 9);
  assert.equal(r.title, 'Old');
  assert.equal(r.body, 'A');
  assert.deepEqual(r.tags, ['t']);
  assert.deepEqual(r.defaults, { x: '1' });
  assert.equal(r.history[0].body, 'B');
  assert.equal(r.updatedAt, 9);
  assert.equal(restoreVersion(p, 3, 9), null);
});
test('diffLines: same, add, del', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nc\nd'), [
    { type: 'same', text: 'a' },
    { type: 'del', text: 'b' },
    { type: 'same', text: 'c' },
    { type: 'add', text: 'd' },
  ]);
  assert.ok(diffLines('x', 'x').every((l) => l.type === 'same'));
  assert.deepEqual(diffLines('', ''), [{ type: 'same', text: '' }]);
});
test('addTestRun validates, prepends, caps; removeTestRun deletes by id', () => {
  const bad1 = addTestRun([], { model: ' ', result: 'r' }, 1, 'x');
  assert.equal(bad1.ok, false);
  assert.equal(addTestRun([], { model: 'm', result: '' }, 1, 'x').ok, false);
  assert.equal(addTestRun([], { model: 'm'.repeat(LIMITS.model + 1), result: 'r' }, 1, 'x').ok, false);
  const ok = addTestRun([], { model: ' my-model ', result: '좋아요' }, 7, 'a');
  assert.equal(ok.ok, true);
  assert.equal(ok.runs[0].model, 'my-model');
  assert.equal(ok.runs[0].at, 7);
  let runs = [];
  for (let i = 0; i < LIMITS.runs + 3; i++) runs = addTestRun(runs, { model: 'm', result: 'r' + i }, i, 'id' + i).runs;
  assert.equal(runs.length, LIMITS.runs);
  assert.equal(runs[0].result, 'r' + (LIMITS.runs + 2));
  assert.equal(removeTestRun(runs, 'id' + (LIMITS.runs + 2)).length, LIMITS.runs - 1);
});
test('parseExport keeps history and testRuns, drops malformed entries', () => {
  const item = {
    id: 'h', title: 'T', body: 'B',
    history: [{ title: 'O', body: 'old', tags: [], defaults: {}, savedAt: 3 }, { title: 'x' }],
    testRuns: [{ id: 'r', model: ' m ', result: 'ok', at: 4 }, { id: 'q', model: '', result: 'x' }],
  };
  const p = parseExport(JSON.stringify([item])).prompts[0];
  assert.equal(p.history.length, 1);
  assert.equal(p.history[0].body, 'old');
  assert.deepEqual(p.testRuns.map((r) => r.model), ['m']);
  const old = parseExport(JSON.stringify([{ id: 'o', title: 'T', body: 'B' }])).prompts[0];
  assert.deepEqual(old.history, []);
  assert.deepEqual(old.testRuns, []);
});


test('canonically equivalent Korean variable names share input and defaults', () => {
  const composed = '주제';
  const decomposed = composed.normalize('NFD');
  assert.deepEqual(extractVariables(`{{${composed}}} {{ ${decomposed} }}`), [composed]);
  assert.equal(renderTemplate(`{{${decomposed}}}`, { [composed]: '우주' }), '우주');
  assert.equal(renderTemplate(`{{${composed}}}`, { [decomposed]: '바다' }), '바다');
  assert.deepEqual(parseDefaults(`${decomposed}=우주`, [composed]), { [composed]: '우주' });
});

test('defaults support CR and CRLF lines and literal special property names', () => {
  const defaults = parseDefaults('__proto__=literal\r주제=우주\r\nconstructor=작성자');
  assert.equal(Object.getPrototypeOf(defaults), Object.prototype);
  assert.equal(Object.hasOwn(defaults, '__proto__'), true);
  assert.equal(renderTemplate('{{__proto__}} / {{주제}} / {{constructor}}', defaults), 'literal / 우주 / 작성자');
  assert.equal(formatDefaults(defaults), '__proto__=literal\n주제=우주\nconstructor=작성자');
  assert.equal(renderTemplate('{{title}}', Object.create({ title: 'inherited' })), '{{title}}');
});


test('blank template markers retain their literal spelling', () => {
  assert.equal(renderTemplate('before {{   }} and {{\t}} after'), 'before {{   }} and {{\t}} after');
  assert.deepEqual(extractVariables('{{   }} {{\t}}'), []);
});
test('JSON prompt backups with a UTF-8 BOM import like ordinary backups', () => {
  const text = JSON.stringify([{ id: 'bom', title: '한글', body: '{{주제}}' }]);
  assert.deepEqual(parseExport('\uFEFF' + text), parseExport(text));
});
