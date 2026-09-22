import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { runEvaluation } from '../lib/decisions.mjs';

const request = () => ({ state: { evidence: 'Synthetic evidence' }, questions: { supported: { type: 'noul', instructions: 'Does the evidence support the claim?' } }, sources: [] });
const response = (answers = { supported: { type: 'noul', noul: 0.1 } }) => ({ ok: true, data: { model: 'jev-1.13.0', answers, usage: { inputTokens: 10, outputTokens: 1 } } });
const evaluate = (input, result = response()) => runEvaluation(input, { evaluate: async () => result });

function assertFallback(result, code) {
  assert.deepEqual(result, { status: 'fallback', code, next: 'Continue ordinary investigation with original sources; this result is not evidence or authority.' });
}

test('returns a compact low Noul answer without echoing state', async () => {
  const result = await evaluate(request());
  assert.deepEqual(result, { status: 'ok', ...response().data });
  assert.equal(result.answers.supported.noul, 0.1);
  assert.equal(Object.hasOwn(result, 'state'), false);
});

test('preserves Choice insufficient, zero-based Score distributions and caller rubric', async () => {
  const input = request();
  input.questions = {
    next: { type: 'choice', instructions: 'Choose a next read or insufficient.', options: { a: 'Read A', insufficient: 'Insufficient evidence' } },
    quality: { type: 'score', instructions: 'Rate support.', levels: ['Unsupported', 'Partial', 'Supported'] },
  };
  const answers = {
    next: { type: 'choice', choice: 'insufficient', confidence: 0.8, probabilities: { a: 0.2, insufficient: 0.8 } },
    quality: { type: 'score', score: 0, confidence: 0.7, probabilities: { 0: 0.7, 1: 0.2, 2: 0.1 } },
  };
  const result = await evaluate(input, response(answers));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.answers, answers);
  assert.deepEqual(result.rubrics, { quality: ['Unsupported', 'Partial', 'Supported'] });
});

test('translates all three helper question types to strict adapter criteria', async () => {
  const input = request();
  input.sources = ['synthetic'];
  input.questions = {
    supported: { type: 'noul', instructions: 'Supported?', true: 'Evidence supports it', false: 'Evidence contradicts it' },
    next: { type: 'choice', instructions: 'Choose.', options: { a: 'Read A', insufficient: 'Need evidence' } },
    quality: { type: 'score', instructions: 'Rate.', levels: ['Low', 'High'] },
  };
  const expected = {
    state: input.state, sources: ['synthetic'], questions: {
      supported: { type: 'noul', instructions: 'Supported?', criteria: { true: 'Evidence supports it', false: 'Evidence contradicts it' } },
      next: { type: 'choice', instructions: 'Choose.', criteria: { a: 'Read A', insufficient: 'Need evidence' } },
      quality: { type: 'score', instructions: 'Rate.', criteria: ['Low', 'High'] },
    },
  };
  let received;
  const result = await runEvaluation(input, { evaluate: async wire => {
    received = wire;
    // Like adapter 2.36, reject helper-only question keys at the wire boundary.
    try { assert.deepEqual(wire, expected); }
    catch { return { ok: false, error: { code: 'invalid_request' } }; }
    return response({
      supported: { type: 'noul', noul: 0.1 },
      next: { type: 'choice', choice: 'insufficient', confidence: 1, probabilities: { a: 0, insufficient: 1 } },
      quality: { type: 'score', score: 0.5, confidence: 0.5, probabilities: { 0: 0.5, 1: 0.5 } },
    });
  } });
  assert.deepEqual(received, expected);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.rubrics, { quality: ['Low', 'High'] });
  assert.equal(Object.hasOwn(input.questions.quality, 'criteria'), false);
});

test('calls the existing evaluator once and accepts cross-realm JSON', async () => {
  const input = vm.runInNewContext(`(${JSON.stringify(request())})`);
  let calls = 0;
  const result = await runEvaluation(input, { evaluate: async value => {
    calls += 1;
    assert.deepEqual(JSON.parse(JSON.stringify(value)), request());
    return vm.runInNewContext(`(${JSON.stringify(response())})`);
  } });
  assert.equal(result.status, 'ok');
  assert.equal(calls, 1);
});

test('accepts optional Noul criteria and all supported question counts', async () => {
  const input = request();
  input.questions.supported.true = 'Supported';
  input.questions.supported.false = 'Not supported';
  assert.equal((await evaluate(input)).status, 'ok');
  for (const count of [2, 3]) {
    input.questions = Object.fromEntries(Array.from({ length: count }, (_, i) => [`q${i}`, request().questions.supported]));
    const answers = Object.fromEntries(Object.keys(input.questions).map(id => [id, { type: 'noul', noul: 0 }]));
    assert.equal((await evaluate(input, response(answers))).status, 'ok');
  }
});

const invalidInputs = {
  'missing sources': value => { delete value.sources; },
  'non-array sources': value => { value.sources = {}; },
  'blank source': value => { value.sources = [' ']; },
  'non-string source': value => { value.sources = [{ server: 'synthetic' }]; },
  'duplicate source': value => { value.sources = ['synthetic', 'synthetic']; },
  'empty questions': value => { value.questions = {}; },
  'too many questions': value => { value.questions = Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, request().questions.supported])); },
  'blank instructions': value => { value.questions.supported.instructions = ' '; },
  'boolean criterion': value => { value.questions.supported.true = true; },
  'unknown type': value => { value.questions.supported.type = 'boolean'; },
  'nonfinite number': value => { value.state.n = Infinity; },
  'undefined': value => { value.state.n = undefined; },
  'bigint': value => { value.state.n = 1n; },
  'function': value => { value.state.n = () => 1; },
  'cycle': value => { value.state.self = value; },
  'prototype poison': value => { value.state = JSON.parse('{"__proto__":{"polluted":true}}'); },
  'custom prototype': value => { value.state = Object.create({ evidence: 'inherited' }); },
  'spoofed ordinary prototype': value => { value.state = Object.create({ constructor: Object, evidence: 'inherited' }); },
  'date': value => { value.state = new Date(0); },
  'sparse array': value => { value.state = Array(2); },
  'symbol': value => { value.state[Symbol('hidden')] = 1; },
};
for (const [name, mutate] of Object.entries(invalidInputs)) {
  test(`rejects ${name} before inference`, async () => {
    const input = request();
    mutate(input);
    let calls = 0;
    assertFallback(await runEvaluation(input, { evaluate: async () => { calls += 1; return response(); } }), 'invalid_request');
    assert.equal(calls, 0);
  });
}

test('rejects getters without executing them or leaking exception text', async () => {
  let reads = 0;
  const input = request();
  Object.defineProperty(input.state, 'secret', { enumerable: true, get() { reads += 1; throw Error('private state'); } });
  assertFallback(await evaluate(input), 'invalid_request');
  assert.equal(reads, 0);
});

test('enforces UTF-8 serialized state and whole-request byte limits', async () => {
  const input = request();
  input.state = 'a'.repeat(4094);
  assert.equal((await evaluate(input)).status, 'ok');
  input.state += 'a';
  assertFallback(await evaluate(input), 'invalid_request');
  input.state = '😀'.repeat(1023) + 'aa';
  assert.equal((await evaluate(input)).status, 'ok');
  input.state += 'é';
  assertFallback(await evaluate(input), 'invalid_request');
  input.state = '';
  input.questions.supported.instructions = 'x'.repeat(16000);
  input.questions.supported.instructions += 'x'.repeat(16384 - Buffer.byteLength(JSON.stringify(input)));
  assert.equal(Buffer.byteLength(JSON.stringify(input)), 16384);
  assert.equal((await evaluate(input)).status, 'ok');
  input.questions.supported.instructions += 'x';
  assertFallback(await evaluate(input), 'invalid_request');
});

for (const count of [1, 129]) {
  test(`rejects Choice with ${count} options`, async () => {
    const input = request();
    input.questions.supported = { type: 'choice', instructions: 'Choose.', options: Object.fromEntries(Array.from({ length: count }, (_, i) => [`a${i}`, `Option ${i}`])) };
    assertFallback(await evaluate(input), 'invalid_request');
  });
}
for (const count of [1, 11]) {
  test(`rejects Score with ${count} levels`, async () => {
    const input = request();
    input.questions.supported = { type: 'score', instructions: 'Rate.', levels: Array(count).fill('Level') };
    assertFallback(await evaluate(input), 'invalid_request');
  });
}

const invalidResponses = {
  'wrong envelope': value => { value.data = { result: value.data }; },
  'empty model': value => { value.data.model = ''; },
  'missing answer': value => { value.data.answers = {}; },
  'extra answer': value => { value.data.answers.extra = { type: 'noul', noul: 1 }; },
  'wrong answer type': value => { value.data.answers.supported = { type: 'score', score: 1 }; },
  'NaN': value => { value.data.answers.supported.noul = NaN; },
  'out of bounds': value => { value.data.answers.supported.noul = 1.1; },
  'raw explanation': value => { value.data.answers.supported.explanation = 'untrusted'; },
  'negative usage': value => { value.data.usage.inputTokens = -1; },
  'fractional usage': value => { value.data.usage.outputTokens = 0.5; },
  'snake case usage': value => { value.data.usage = { input_tokens: 10, output_tokens: 1 }; },
};
for (const [name, mutate] of Object.entries(invalidResponses)) {
  test(`rejects response with ${name}`, async () => {
    const result = response();
    mutate(result);
    assertFallback(await evaluate(request(), result), 'invalid_response');
  });
}

test('rejects malformed distributions, selections, confidences, and one-based scores', async () => {
  for (const answer of [
    { type: 'choice', choice: 'a', confidence: 0.9, probabilities: { a: 0.9 } },
    { type: 'choice', choice: 'a', confidence: 0.9, probabilities: { a: 0.9, b: 0.9 } },
    { type: 'choice', choice: 'a', confidence: Infinity, probabilities: { a: 0.9, b: 0.1 } },
    { type: 'choice', choice: 'c', confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } },
    { type: 'choice', choice: 'a', confidence: 0.9, probabilities: { a: 1.1, b: -0.1 } },
    { type: 'score', score: 2, confidence: 0.9, probabilities: { 0: 0.1, 1: 0.9 } },
    { type: 'score', score: 1, confidence: 0.9, probabilities: { 1: 0.1, 2: 0.9 } },
    { type: 'score', score: -0.5, confidence: 0.9, probabilities: { 0: 0.1, 1: 0.9 } },
  ]) {
    const input = request();
    input.questions.supported = answer.type === 'score'
      ? { type: 'score', instructions: 'Rate.', levels: ['Low', 'High'] }
      : { type: 'choice', instructions: 'Choose.', options: { a: 'A', b: 'B' } };
    assertFallback(await evaluate(input, response({ supported: answer })), 'invalid_response');
  }
});

for (const code of ['disabled', 'invalid_request', 'data_policy_denied', 'budget_exhausted', 'credential_missing', 'credential_unavailable', 'authentication_failed', 'timeout', 'aborted', 'rate_limited', 'service_unavailable', 'invalid_response']) {
  test(`returns safe ${code} fallback without remote message`, async () => {
    assertFallback(await evaluate(request(), { ok: false, error: { code, message: 'PRIVATE STATE' } }), code);
  });
}

test('accepts finite fractional Scores and maximum supported option and level counts', async () => {
  for (const count of [2, 10]) {
    const input = request();
    input.questions.supported = { type: 'score', instructions: 'Rate.', levels: Array.from({ length: count }, (_, i) => `Level ${i}`) };
    const probabilities = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), 1 / count]));
    const answer = { type: 'score', score: (count - 1) / 2, confidence: 1 / count, probabilities };
    const result = await evaluate(input, response({ supported: answer }));
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.answers.supported, answer);
  }
  const input = request();
  input.questions.supported = { type: 'choice', instructions: 'Choose.', options: Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`a${i}`, `Option ${i}`])) };
  const probabilities = Object.fromEntries(Object.keys(input.questions.supported.options).map(key => [key, 1 / 128]));
  assert.equal((await evaluate(input, response({ supported: { type: 'choice', choice: 'a127', confidence: 1 / 128, probabilities } }))).status, 'ok');
});

test('sanitizes unknown errors and thrown exceptions without retrying', async () => {
  assertFallback(await evaluate(request(), { ok: false, error: { code: 'PRIVATE STATE', message: 'PRIVATE STATE' } }), 'evaluation_failed');
  let calls = 0;
  assertFallback(await runEvaluation(request(), { evaluate: async () => { calls += 1; throw Error('PRIVATE STATE'); } }), 'evaluation_failed');
  assert.equal(calls, 1);
});
