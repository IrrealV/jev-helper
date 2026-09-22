import test from 'node:test';
import assert from 'node:assert/strict';
import { runPrioritization } from '../lib/prioritize.mjs';
import { runEvaluation } from '../lib/decisions.mjs';

const spec = () => ({
  mode: 'prioritize', tool: { path: 'synthetic.search', server: 'synthetic', args: { query: 'public fixture' } },
  resultPath: ['data', 'items'], fields: { id: 'id', text: 'snippet', reference: 'uri' },
  task: 'Choose the next reversible read about parsing.', mandatoryIds: [],
});
const rows = count => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, snippet: `Synthetic candidate ${i}`, uri: `fixture://r${i}`, body: 'UNPROJECTED BODY' }));
function offline(items, choice = 'c0') {
  const calls = { tool: [], evaluation: [] };
  return {
    calls,
    tools: { call: async (...args) => { calls.tool.push(args); return { ok: true, data: { items } }; } },
    jev: { evaluate: async request => {
      calls.evaluation.push(request);
      const question = request.questions.next;
      if (Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key)) || !question.criteria) {
        return { ok: false, error: { code: 'invalid_request' } };
      }
      const probabilities = Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0]));
      return { ok: true, data: { model: 'offline-fake', answers: { next: { type: 'choice', choice, confidence: 1, probabilities } }, usage: { inputTokens: 5, outputTokens: 1 } } };
    } },
  };
}

test('offline MCP prioritization fetches once, preserves mandatory evidence and omitted references', async () => {
  const input = spec();
  input.mandatoryIds = ['r7'];
  const fake = offline(rows(8));
  const result = await runPrioritization(input, fake.tools, fake.jev, runEvaluation);
  assert.equal(result.status, 'ok');
  assert.equal(result.selected.id, 'r7');
  assert.deepEqual(result.mandatory.map(row => row.id), ['r7']);
  assert.equal(result.mandatory[0].text, 'Synthetic candidate 7');
  assert.equal(result.omitted.length, 7);
  assert.deepEqual(result.omitted.find(row => row.id === 'r6'), { id: 'r6', reference: 'fixture://r6', reason: 'not_evaluated' });
  assert.deepEqual(result.recovery, { tool: input.tool, resultPath: input.resultPath, fields: input.fields });
  assert.equal(result.coverage.omittedFromEvaluation, 2);
  assert.equal(result.coverage.total, 8);
  assert.deepEqual(fake.calls.tool, [['synthetic.search', { query: 'public fixture' }]]);
  assert.equal(fake.calls.evaluation.length, 1);
  assert.deepEqual(fake.calls.evaluation[0].sources, ['synthetic']);
  assert.equal(JSON.stringify(result).includes('UNPROJECTED BODY'), false);
  assert.equal(JSON.stringify(fake.calls.evaluation).includes('UNPROJECTED BODY'), false);
});

for (const count of [0, 1]) {
  test(`skips Jev deterministically for ${count} candidate(s)`, async () => {
    const fake = offline(rows(count));
    const result = await runPrioritization(spec(), fake.tools, fake.jev, runEvaluation);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, count === 0 ? 'empty' : 'single_candidate');
    assert.equal(result.selected?.id ?? null, count === 0 ? null : 'r0');
    assert.equal(fake.calls.evaluation.length, 0);
    assert.equal(result.coverage.projected, count);
    assert.equal(result.coverage.evaluated, 0);
    assert.equal(result.coverage.omittedFromEvaluation, count);
  });
}

for (const choice of ['none', 'insufficient']) {
  test(`retains explicit ${choice} without inventing a next action`, async () => {
    const input = spec();
    input.mandatoryIds = ['r1'];
    const fake = offline(rows(2), choice);
    const result = await runPrioritization(input, fake.tools, fake.jev, runEvaluation);
    assert.equal(result.status, 'ok');
    assert.equal(result.choice, choice);
    assert.equal(result.selected, null);
    assert.equal(result.mandatory[0].id, 'r1');
    assert.equal(result.omitted[0].id, 'r0');
  });
}

for (const result of [{}, { data: { items: [] } }, { ok: true, data: { isError: true, items: [] } }, { content: [{ type: 'text', text: '[]' }] }, { data: { items: {} } }, { ok: false, data: { items: [] } }, { isError: true, data: { items: [] } }]) {
  test(`rejects unknown or failed MCP envelope ${JSON.stringify(result)}`, async () => {
    let evaluations = 0;
    const actual = await runPrioritization(spec(), { call: async () => result }, { evaluate: async () => { evaluations += 1; } }, runEvaluation);
    assert.equal(actual.status, 'fallback');
    assert.equal(actual.code, 'invalid_tool_result');
    assert.equal(evaluations, 0);
  });
}

test('bounds Unicode projections and marks truncation honestly', async () => {
  const items = rows(8).map(row => ({ ...row, snippet: '😀\n'.repeat(1000) }));
  const fake = offline(items);
  const result = await runPrioritization(spec(), fake.tools, fake.jev, runEvaluation);
  assert.equal(result.status, 'ok');
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.coverage.omittedFromEvaluation, 2);
  assert.equal(result.selected.truncated, true);
  const state = fake.calls.evaluation[0].state;
  assert.equal(state.candidates.length, 6);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) <= 4096);
  assert.ok(state.candidates.every(row => Buffer.byteLength(row.text) <= 400));
  assert.equal(state.candidates.some(row => row.text.includes('\ufffd')), false);
});

test('retains mandatory evidence and recovery on Jev failure', async () => {
  const input = spec();
  input.mandatoryIds = ['r1'];
  const fake = offline(rows(2));
  fake.jev.evaluate = async () => { throw Error('PRIVATE ERROR'); };
  const result = await runPrioritization(input, fake.tools, fake.jev, runEvaluation);
  assert.equal(result.status, 'fallback');
  assert.equal(result.code, 'evaluation_failed');
  assert.equal(result.mandatory[0].text, 'Synthetic candidate 1');
  assert.equal(result.selected, null);
  assert.equal(result.omitted[0].reason, 'not_evaluated');
  assert.equal(result.coverage.projected, 2);
  assert.equal(result.coverage.evaluated, 0);
  assert.equal(result.coverage.omittedFromEvaluation, 2);
  assert.equal(JSON.stringify(result).includes('PRIVATE ERROR'), false);
  assert.equal(result.recovery.tool.path, 'synthetic.search');
});

test('fails safely for missing mandatory IDs, duplicate IDs, and oversized result lists', async () => {
  for (const [input, items, code] of [
    [{ ...spec(), mandatoryIds: ['absent'] }, rows(2), 'mandatory_missing'],
    [spec(), [rows(1)[0], rows(1)[0]], 'invalid_tool_result'],
    [spec(), rows(129), 'invalid_tool_result'],
  ]) {
    const fake = offline(items);
    const result = await runPrioritization(input, fake.tools, fake.jev, runEvaluation);
    assert.equal(result.status, 'fallback');
    assert.equal(result.code, code);
    assert.equal(fake.calls.evaluation.length, 0);
  }
});

test('rejects undeclared server, unsafe paths, and excessive limits before tool calls', async () => {
  for (const mutate of [
    input => { delete input.tool.server; },
    input => { input.resultPath = ['items']; },
    input => { input.resultPath = ['data', '__proto__']; },
    input => { input.limits = { candidates: 7 }; },
    input => { input.limits = { textBytes: 401 }; },
    input => { input.limits = { totalBytes: 4097 }; },
    input => { input.fields.text = 'constructor'; },
    input => { Object.setPrototypeOf(input.tool, { constructor: Object }); },
  ]) {
    const input = spec();
    mutate(input);
    const fake = offline(rows(2));
    const result = await runPrioritization(input, fake.tools, fake.jev, runEvaluation);
    assert.equal(result.code, 'invalid_request');
    assert.equal(fake.calls.tool.length, 0);
  }
});

test('sanitizes tool throws and rejects projected getters without executing them', async () => {
  const throwing = await runPrioritization(spec(), { call: async () => { throw Error('PRIVATE BODY'); } }, {}, runEvaluation);
  assert.equal(throwing.code, 'tool_failed');
  assert.equal(JSON.stringify(throwing).includes('PRIVATE BODY'), false);
  let reads = 0;
  const item = rows(1)[0];
  Object.defineProperty(item, 'snippet', { get() { reads += 1; return 'PRIVATE BODY'; } });
  const fake = offline([item]);
  assert.equal((await runPrioritization(spec(), fake.tools, fake.jev, runEvaluation)).code, 'invalid_tool_result');
  assert.equal(reads, 0);
});
