import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildScript } from '../lib/script.mjs';

const spec = () => ({ mode: 'evaluate', request: { state: 'public synthetic state', sources: [], questions: { q: { type: 'noul', instructions: 'Is it supported?' } } } });
const answer = { ok: true, data: { model: 'offline-fake', answers: { q: { type: 'noul', noul: 0.1 } }, usage: { inputTokens: 1, outputTokens: 1 } } };

test('generated evaluation runs with only supported globals and preserves escaped text', async () => {
  const input = spec();
  input.request.state = '</script>\u2028\u2029"\\\n` ${globalThis.injected = true} 😀';
  const emitted = [];
  let received;
  const context = vm.createContext({ jev: { evaluate: async request => { received = request; return answer; } }, emit: value => emitted.push(value) });
  const script = buildScript(input);
  assert.equal(script.includes('</script>'), false);
  assert.equal(vm.runInContext('typeof Buffer + ":" + typeof TextEncoder + ":" + typeof process', context), 'undefined:undefined:undefined');
  // mcpScript executes an async function body, not a REPL that awaits the last expression.
  await vm.runInContext(`(async () => { ${script} })()`, context, { timeout: 1000 });
  assert.equal(received.state, input.request.state);
  assert.equal(emitted.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(emitted[0])), { status: 'ok', ...answer.data });
  assert.equal(vm.runInContext('globalThis.injected', context), undefined);
});

test('generated prioritization fetches through tools inside the script, not the builder', async () => {
  const input = {
    mode: 'prioritize', tool: { server: 'synthetic', path: 'synthetic.search', args: {} },
    resultPath: ['data'], fields: { id: 'id', text: 'text', reference: 'ref' },
    task: 'Choose next read.', mandatoryIds: [],
  };
  let calls = 0;
  const script = buildScript(input);
  const emitted = [];
  assert.equal(calls, 0);
  await vm.runInNewContext(`(async () => { ${script} })()`, {
    tools: { call: async (path, args) => {
      calls += 1;
      assert.equal(path, 'synthetic.search');
      assert.deepEqual(JSON.parse(JSON.stringify(args)), {});
      return { ok: true, data: [{ id: 'one', text: 'Offline excerpt', ref: 'fixture://one' }] };
    } },
    jev: { evaluate: async () => { throw Error('Must skip evaluation'); } },
    emit: value => emitted.push(value),
  }, { timeout: 1000 });
  assert.equal(calls, 1);
  assert.equal(emitted[0].selected.reference, 'fixture://one');
  assert.equal(emitted[0].status, 'skipped');
});

test('generated evaluation sends strict criteria for Noul, Choice and Score', async () => {
  const input = spec();
  input.request.questions = {
    n: { type: 'noul', instructions: 'Supported?', true: 'Yes', false: 'No' },
    c: { type: 'choice', instructions: 'Choose.', options: { a: 'A', b: 'B' } },
    s: { type: 'score', instructions: 'Rate.', levels: ['Low', 'High'] },
  };
  let wire;
  const emitted = [];
  await vm.runInNewContext(`(async () => { ${buildScript(input)} })()`, {
    jev: { evaluate: async request => {
      wire = JSON.parse(JSON.stringify(request));
      if (Object.values(wire.questions).some(question => Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key)))) {
        return { ok: false, error: { code: 'invalid_request' } };
      }
      return { ok: true, data: { model: 'offline-fake', usage: { inputTokens: 2, outputTokens: 3 }, answers: {
        n: { type: 'noul', noul: 0.1 },
        c: { type: 'choice', choice: 'b', confidence: 1, probabilities: { a: 0, b: 1 } },
        s: { type: 'score', score: 0.5, confidence: 0.5, probabilities: { 0: 0.5, 1: 0.5 } },
      } } };
    } }, emit: value => emitted.push(JSON.parse(JSON.stringify(value))),
  });
  assert.deepEqual(wire.questions, {
    n: { type: 'noul', instructions: 'Supported?', criteria: { true: 'Yes', false: 'No' } },
    c: { type: 'choice', instructions: 'Choose.', criteria: { a: 'A', b: 'B' } },
    s: { type: 'score', instructions: 'Rate.', criteria: ['Low', 'High'] },
  });
  assert.equal(emitted[0].status, 'ok');
  assert.deepEqual(emitted[0].rubrics, { s: ['Low', 'High'] });
});

const prioritizeSpec = () => ({
  mode: 'prioritize', tool: { server: 'synthetic', path: 'synthetic.search', args: {} },
  resultPath: ['data', 'items'], fields: { id: 'id', text: 'text', reference: 'ref' },
  task: 'Choose next read.', mandatoryIds: [],
});

test('generated multi-candidate prioritization obeys the strict adapter wire contract', async () => {
  const input = prioritizeSpec();
  input.mandatoryIds = ['two'];
  const emitted = [];
  let calls = 0;
  let wire;
  await vm.runInNewContext(`(async () => { ${buildScript(input)} })()`, {
    tools: { call: async () => ({ ok: true, data: { items: [
      { id: 'one', text: 'First excerpt', ref: 'fixture://one' },
      { id: 'two', text: 'Mandatory excerpt', ref: 'fixture://two' },
    ] } }) },
    jev: { evaluate: async request => {
      calls += 1;
      wire = JSON.parse(JSON.stringify(request));
      const question = wire.questions.next;
      if (!question.criteria || Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key))) {
        return { ok: false, error: { code: 'invalid_request' } };
      }
      const probabilities = Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === 'c1' ? 1 : 0]));
      return { ok: true, data: { model: 'offline-fake', usage: { inputTokens: 2, outputTokens: 1 }, answers: { next: { type: 'choice', choice: 'c1', confidence: 1, probabilities } } } };
    } }, emit: value => emitted.push(JSON.parse(JSON.stringify(value))),
  });
  assert.equal(calls, 1);
  assert.deepEqual(wire.sources, ['synthetic']);
  assert.deepEqual(Object.keys(wire.questions.next).sort(), ['criteria', 'instructions', 'type']);
  assert.equal(emitted[0].status, 'ok');
  assert.equal(emitted[0].selected.id, 'one');
  assert.equal(emitted[0].mandatory[0].id, 'two');
});

test('generated prioritization preserves mandatory references while shrinking escaped projections', async () => {
  const input = prioritizeSpec();
  input.mandatoryIds = ['r7'];
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: `r${index}`, text: '\n'.repeat(400), ref: `fixture://${index}/${'x'.repeat(450)}`, body: 'DO NOT PROJECT',
  }));
  const emitted = [];
  let sent;
  await vm.runInNewContext(`(async () => { ${buildScript(input)} })()`, {
    tools: { call: async () => ({ ok: true, data: { items } }) },
    jev: { evaluate: async request => {
      sent = JSON.parse(JSON.stringify(request));
      if (!sent.questions.next.criteria || Object.hasOwn(sent.questions.next, 'options')) {
        return { ok: false, error: { code: 'invalid_request' } };
      }
      const probabilities = Object.fromEntries(Object.keys(sent.questions.next.criteria).map(key => [key, key === 'insufficient' ? 1 : 0]));
      return { ok: true, data: { model: 'offline-fake', usage: { inputTokens: 2, outputTokens: 1 }, answers: { next: { type: 'choice', choice: 'insufficient', confidence: 1, probabilities } } } };
    } }, emit: value => emitted.push(JSON.parse(JSON.stringify(value))),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(sent.state), 'utf8') <= 4096);
  assert.ok(sent.state.candidates.every(row => Buffer.byteLength(row.text, 'utf8') <= 400));
  assert.equal(emitted[0].status, 'ok');
  assert.equal(emitted[0].selected, null);
  assert.equal(emitted[0].mandatory[0].reference, items[7].ref);
  assert.equal(emitted[0].mandatory[0].truncated, true);
  assert.equal(emitted[0].coverage.projected, 6);
  assert.equal(emitted[0].coverage.omittedFromEvaluation, 2);
  assert.equal(JSON.stringify(sent).includes('DO NOT PROJECT'), false);
  assert.equal(JSON.stringify(emitted).includes('DO NOT PROJECT'), false);
});

test('generated prioritization rejects host/native MCP errors without evaluation', async () => {
  for (const result of [{ data: { items: [] } }, { ok: false, data: { items: [] } }, { ok: true, data: { isError: true, items: [] } }]) {
    let calls = 0;
    const emitted = [];
    await vm.runInNewContext(`(async () => { ${buildScript(prioritizeSpec())} })()`, {
      tools: { call: async () => result },
      jev: { evaluate: async () => { calls += 1; throw Error('Must not evaluate'); } },
      emit: value => emitted.push(value),
    });
    assert.equal(emitted[0].status, 'fallback');
    assert.equal(emitted[0].code, 'invalid_tool_result');
    assert.equal(calls, 0);
  }
});

test('builder validates sources and prioritization configuration before producing scripts', () => {
  for (const sources of [[' '], ['a', 'a'], [1]]) {
    const input = spec();
    input.request.sources = sources;
    assert.throws(() => buildScript(input), { message: 'Invalid script specification.' });
  }
  const input = prioritizeSpec();
  input.limits = { textBytes: 401 };
  assert.throws(() => buildScript(input), { message: 'Invalid script specification.' });
});

test('minimal generated scripts fit explicit UTF-8 overhead budgets', t => {
  const evaluateBytes = Buffer.byteLength(buildScript(spec()), 'utf8');
  const prioritizeBytes = Buffer.byteLength(buildScript(prioritizeSpec()), 'utf8');
  t.diagnostic(`evaluate=${evaluateBytes} UTF-8 bytes; prioritize=${prioritizeBytes} UTF-8 bytes`);
  assert.ok(evaluateBytes <= 2500, `evaluate script is ${evaluateBytes} bytes`);
  assert.ok(prioritizeBytes <= 8000, `prioritize script is ${prioritizeBytes} bytes`);
});

test('builder rejects non-JSON, poisonous, oversized, and unknown specs safely', () => {
  const cyclic = spec();
  cyclic.self = cyclic;
  let getterReads = 0;
  const getter = spec();
  Object.defineProperty(getter, 'toJSON', { get() { getterReads += 1; throw Error('PRIVATE'); } });
  const spoofed = Object.assign(Object.create({ constructor: Object }), spec());
  for (const input of [cyclic, getter, spoofed, { mode: 'other' }, { ...spec(), extra: Infinity }, { ...spec(), extra: 'x'.repeat(32769) }, JSON.parse('{"mode":"evaluate","__proto__":{}}')]) {
    assert.throws(() => buildScript(input), { message: 'Invalid script specification.' });
  }
  assert.equal(getterReads, 0);
});

test('builder rejects invalid requests locally; generated scripts sanitize adapter errors', async () => {
  const input = spec();
  input.request.state = '😀'.repeat(1024);
  assert.throws(() => buildScript(input), { message: 'Invalid script specification.' });
  const emitted = [];
  await vm.runInNewContext(`(async () => { ${buildScript(spec())} })()`, { jev: { evaluate: async () => ({ ok: false, error: { code: 'disabled', message: 'PRIVATE' } }) }, emit: value => emitted.push(value) });
  assert.equal(emitted[0].code, 'disabled');
  assert.equal(JSON.stringify(emitted).includes('PRIVATE'), false);
});
