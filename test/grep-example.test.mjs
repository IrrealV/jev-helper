import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function run({ data, choice = 'c1', failure = false }) {
  const code = await readFile(new URL('../examples/grep-prioritize.mjs', import.meta.url), 'utf8');
  const calls = []; const requests = []; const output = [];
  await runInNewContext(`(async () => { ${code}\n })()`, {
    tools: { call: async (...args) => { calls.push(args); return { ok: true, data }; } },
    jev: { evaluate: async request => { requests.push(request); return failure ? { ok: false, error: { message: 'private error' } } : { ok: true, data: { answers: { next: { type: 'choice', choice, confidence: 0.7, probabilities: { [choice]: 0.7 } } }, usage: { inputTokens: 123, outputTokens: 12 } } }; } },
    emit: value => output.push(value),
  });
  return { calls, requests, output: JSON.parse(JSON.stringify(output)) };
}
function data(count = 10) { return { content: Array.from({ length: count }, (_, i) => ({ type: 'text', text: `Repository: modelcontextprotocol/typescript-sdk\nPath: src/${i}.ts\nURL: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/${i}.ts\nLicense: MIT\nSnippets:\n${'Evidence about isError: true. '.repeat(40)}` })) }; }

test('grep recipe calls the actual tool once, projects six snippets, retains all references and usage', async () => {
  const result = await run({ data: data() });
  assert.equal(result.calls[0][0], 'grep_searchGitHub');
  assert.equal(result.calls.length, 1);
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.deepEqual(Array.from(request.sources), ['grep']);
  assert.equal(request.state.candidates.length, 6);
  assert.equal(Buffer.byteLength(JSON.stringify(request.state)) <= 4096, true);
  assert.equal(request.questions.next.criteria.none.length > 0, true);
  assert.equal(request.questions.next.criteria.insufficient.length > 0, true);
  const output = result.output[0];
  assert.equal(output.references.length, 10);
  assert.equal(output.coverage.considered, 6);
  assert.equal(output.coverage.omitted, 4);
  assert.equal(output.selected.reference.endsWith('/src/1.ts'), true);
  assert.deepEqual(output.usage, { inputTokens: 123, outputTokens: 12 });
  assert.equal(JSON.stringify(output).includes('Repository:'), false);
});

for (const choice of ['none', 'insufficient']) {
  test(`grep recipe preserves explicit ${choice}`, async () => {
    const result = await run({ data: data(), choice });
    assert.equal(result.output[0].decision, choice);
    assert.equal(result.output[0].selected, null);
  });
}

test('grep recipe skips inference for malformed/native-error/singleton data and masks remote errors', async () => {
  for (const input of [{}, { isError: true, ...data() }, { content: [{ type: 'text', text: 'not mapped' }] }, data(1)]) {
    const result = await run({ data: input });
    assert.equal(result.requests.length, 0);
  }
  const failed = await run({ data: data(), failure: true });
  assert.equal(failed.output[0].status, 'evaluation_unavailable');
  assert.equal(failed.output[0].references.length, 10);
  assert.equal(JSON.stringify(failed.output).includes('private error'), false);
});
