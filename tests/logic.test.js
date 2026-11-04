import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVariables, renderTemplate, normalizeTags, searchPrompts, sortPrompts, validatePrompt, mergeImport, parseExport, demoPrompts } from '../logic.js';

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
