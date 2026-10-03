import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const skillPath = new URL('../skills/jev-decisions/SKILL.md', import.meta.url);
const skillDir = dirname(fileURLToPath(skillPath));

test('skill keeps valid frontmatter, stays manually invokable and within the compact size guard', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /^---\nname: jev-decisions\ndescription: "/);
  assert.match(skill, /\nlicense: MIT\n/);
  assert.match(skill, /\nmetadata:\n/);
  assert.equal(skill.includes('disable-model-invocation: true'), false);
  const bytes = Buffer.byteLength(skill, 'utf8');
  assert.ok(bytes <= 4000, `skill body must stay <= 4000 UTF-8 bytes for this phase, got ${bytes}`);
});

test('every relative reference in the skill resolves on disk', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const links = [...skill.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]).filter(link => !/^https?:/.test(link));
  assert.ok(links.length >= 1, `expected at least one documented reference, found ${links.length}`);
  for (const link of links) {
    assert.equal(existsSync(resolve(skillDir, link.split('#')[0])), true, `unresolved reference: ${link}`);
  }
});

async function skillWireCode(planLiteral) {
  const skill = await readFile(skillPath, 'utf8');
  const marker = skill.indexOf('## Wire contract');
  assert.notEqual(marker, -1, 'skill must document a self-sufficient wire contract');
  const block = skill.slice(marker).match(/```js\n([\s\S]*?)```/);
  assert.ok(block, 'skill wire contract snippet is missing');
  assert.ok(block[1].includes('__PLAN__'), 'skill snippet must expose the inspected-binding precondition');
  return block[1].replace('const p = __PLAN__', 'const p = ' + planLiteral);
}

function planLiteral({ candidates, originals, mandatoryIds = [] }) {
  // `originals` is the complete pre-projection manifest; `candidates` are the evaluated subset.
  // Positive fixtures carry originals so the contract can derive references/coverage from the full manifest.
  const manifest = originals ?? candidates.map(({ id, reference }) => ({ id, reference }));
  return JSON.stringify({ task: 'Choose one next read.', sources: ['fixture-server'], mandatoryIds, originals: manifest, candidates });
}

function rawPlanLiteral({ candidates, mandatoryIds = [] }) {
  return JSON.stringify({ task: 'Choose one next read.', sources: ['fixture-server'], mandatoryIds, candidates });
}

function candidateList(ids = ['a', 'b', 'c']) {
  return ids.map(id => ({ id, reference: `fixture://source/${id}`, text: `bounded excerpt ${id}` }));
}

async function runSkillWire({ plan, choice = 'a', jevResult = null, jevThrows = false }) {
  const code = await skillWireCode(plan);
  const requests = []; const output = [];
  const jev = { evaluate: async request => {
    const wire = JSON.parse(JSON.stringify(request));
    requests.push(wire);
    assert.equal(wire.questions.next.type, 'choice');
    assert.ok(wire.questions.next.criteria, 'wire request must carry criteria');
    assert.equal(Object.hasOwn(wire.questions.next, 'options'), false, 'wire request must not carry helper options');
    assert.ok(Array.isArray(wire.sources));
    if (jevThrows) { throw Error('PRIVATE skill failure'); }
    if (jevResult) { return jevResult; }
    const probabilities = Object.fromEntries(Object.keys(wire.questions.next.criteria).map(key => [key, key === choice ? 1 : 0]));
    return { ok: true, data: { model: 'offline-fake', usage: { inputTokens: 5, outputTokens: 2 },
      answers: { next: { type: 'choice', choice, confidence: 1, probabilities } } } };
  } };
  await runInNewContext(`(async () => { ${code} })()`, { jev, emit: value => output.push(JSON.parse(JSON.stringify(value))) }, { timeout: 1000 });
  return { requests, output };
}

test('skill wire contract derives criteria from real candidates and maps only returned original references', async () => {
  const injected = candidateList(['a', 'b']);
  const result = await runSkillWire({ plan: planLiteral({ candidates: injected, mandatoryIds: ['b'] }), choice: 'a' });
  assert.equal(result.requests.length, 1);
  assert.deepEqual(Object.keys(result.requests[0].questions.next.criteria).sort(), ['a', 'b', 'insufficient', 'none']);
  assert.deepEqual(result.requests[0].state.candidates, injected);
  const output = result.output[0];
  assert.equal(output.status, 'ok');
  assert.equal(output.decision, 'a');
  assert.deepEqual(output.selected, { id: 'a', reference: 'fixture://source/a' });
  assert.deepEqual(output.references, [
    { id: 'a', reference: 'fixture://source/a' },
    { id: 'b', reference: 'fixture://source/b' },
  ]);
  assert.equal(output.coverage.returned, 2);
  assert.deepEqual(output.usage, { inputTokens: 5, outputTokens: 2 });
  assert.ok(Object.hasOwn(output, 'distribution'));
  const injectedById = new Map(injected.map(row => [row.id, row.reference]));
  assert.equal(injectedById.get(output.selected.id), output.selected.reference);
});

for (const choice of ['none', 'insufficient']) {
  test(`skill wire contract abstains on ${choice} without selecting`, async () => {
    const result = await runSkillWire({ plan: planLiteral({ candidates: candidateList() }), choice });
    assert.equal(result.output[0].status, 'ok');
    assert.equal(result.output[0].decision, choice);
    assert.equal(result.output[0].selected, null);
  });
}

test('skill wire contract fails closed before Jev on empty, singleton, malformed, duplicate or missing-mandatory data', async () => {
  const cases = [
    ['empty', planLiteral({ candidates: [] })],
    ['singleton', planLiteral({ candidates: candidateList(['a']) })],
    ['malformed', planLiteral({ candidates: [{ id: 'a', reference: 1, text: 'x' }, { id: 'b', reference: 'r', text: 'y' }] })],
    ['duplicate ids', planLiteral({ candidates: [{ id: 'a', reference: 'r', text: 'x' }, { id: 'a', reference: 'r2', text: 'y' }] })],
    ['missing mandatory', planLiteral({ candidates: candidateList(['a', 'b']), mandatoryIds: ['z'] })],
  ];
  for (const [label, plan] of cases) {
    const result = await runSkillWire({ plan });
    assert.equal(result.requests.length, 0, `${label} must not call Jev`);
    assert.equal(result.output[0].status, 'unavailable', `${label} must be an abstention`);
    assert.equal(Object.hasOwn(result.output[0], 'decision'), false, `${label} must not select`);
  }
  const missing = await runSkillWire({ plan: planLiteral({ candidates: candidateList(['a', 'b']), mandatoryIds: ['z'] }) });
  assert.deepEqual(missing.output[0].missingIds, ['z']);
});

test('skill wire contract masks evaluation failures and rejects answers outside the returned IDs', async () => {
  const plan = planLiteral({ candidates: candidateList() });
  for (const options of [
    { plan, jevResult: { ok: false, error: { code: 'disabled', message: 'PRIVATE' } } },
    { plan, jevThrows: true },
    { plan, choice: 'not-a-returned-id' },
  ]) {
    const result = await runSkillWire(options);
    assert.equal(result.output[0].status, 'unavailable');
    assert.equal(Object.hasOwn(result.output[0], 'decision'), false);
    assert.equal(JSON.stringify(result.output).includes('PRIVATE'), false);
  }
});

const ORIGINAL_IDS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];

function originalsFor(ids) {
  return ids.map(id => ({ id, reference: `fixture://source/${id}` }));
}

// Regression: the pre-projection manifest is authoritative for references and coverage.returned.
// `result.requests.length` counts LOCAL jev.evaluate invocations in the sandbox stub; it is not
// proof about remote dispatch and must not be reported as such.
test('skill wire contract keeps all original references and reports returned/evaluated/omitted from the full manifest', async () => {
  const originals = originalsFor(ORIGINAL_IDS);
  const candidates = candidateList(ORIGINAL_IDS.slice(0, 6));
  const result = await runSkillWire({ plan: planLiteral({ originals, candidates }), choice: 'r1' });
  assert.equal(result.requests.length, 1);
  const output = result.output[0];
  assert.equal(output.status, 'ok');
  assert.deepEqual(output.references, originals);
  assert.equal(output.references.length, 8);
  assert.equal(output.coverage.returned, 8);
  assert.equal(output.coverage.evaluated, 6);
  assert.equal(output.coverage.omitted, 2);
  assert.deepEqual([...output.coverage.omittedIds].sort(), ['r6', 'r7']);
  assert.deepEqual(output.selected, { id: 'r1', reference: 'fixture://source/r1' });
});

test('skill wire contract fails closed when the original manifest is missing', async () => {
  const result = await runSkillWire({ plan: rawPlanLiteral({ candidates: candidateList() }) });
  assert.equal(result.requests.length, 0, 'missing originals must not reach jev.evaluate');
  assert.equal(result.output[0].status, 'unavailable');
  assert.equal(Object.hasOwn(result.output[0], 'decision'), false);
  assert.equal(result.output[0].coverage.returned, 'unknown');
});

test('skill wire contract fails closed when a candidate reference disagrees with the original manifest', async () => {
  const originals = originalsFor(['r0', 'r1']);
  const candidates = [
    { id: 'r0', reference: 'fixture://tampered/r0', text: 'bounded excerpt r0' },
    { id: 'r1', reference: 'fixture://source/r1', text: 'bounded excerpt r1' },
  ];
  const result = await runSkillWire({ plan: planLiteral({ originals, candidates }), choice: 'r0' });
  assert.equal(result.requests.length, 0, 'reference mismatch must not reach jev.evaluate');
  assert.equal(result.output[0].status, 'unavailable');
  assert.deepEqual(result.output[0].references, originals);
});

test('skill wire contract rejects blank and reserved sentinel IDs before jev.evaluate', async () => {
  for (const bad of ['', '   ', 'none', 'insufficient']) {
    const candidates = candidateList(['a', 'b']);
    const originals = originalsFor(['a', 'b']);
    candidates[0] = { ...candidates[0], id: bad };
    originals[0] = { ...originals[0], id: bad };
    const result = await runSkillWire({ plan: planLiteral({ originals, candidates }) });
    assert.equal(result.requests.length, 0, `id ${JSON.stringify(bad)} must be rejected before jev.evaluate`);
    assert.equal(result.output[0].status, 'unavailable');
    assert.equal(Object.hasOwn(result.output[0], 'decision'), false);
  }
});

// Regression: a reference is identity-as-locator; blank or whitespace-only references in BOTH the
// original manifest and the candidate are not a mismatch, so they need their own fail-closed guard.
test('skill wire contract rejects blank and whitespace-only references before jev.evaluate', async () => {
  for (const bad of ['', '   ', '\t\n']) {
    const originals = originalsFor(['a', 'b']);
    const candidates = candidateList(['a', 'b']);
    originals[0] = { ...originals[0], reference: bad };
    candidates[0] = { ...candidates[0], reference: bad };
    const result = await runSkillWire({ plan: planLiteral({ originals, candidates }) });
    assert.equal(result.requests.length, 0, `reference ${JSON.stringify(bad)} must not reach jev.evaluate`);
    assert.equal(result.output[0].status, 'unavailable');
    assert.equal(Object.hasOwn(result.output[0], 'decision'), false);
    assert.equal(typeof result.output[0].next, 'string');
    assert.ok(result.output[0].next.length > 0);
  }
});

test('skill wire contract fails closed on candidates over the six-candidate cap without widening', async () => {
  const originals = originalsFor(ORIGINAL_IDS);
  const candidates = candidateList(ORIGINAL_IDS.slice(0, 7));
  const result = await runSkillWire({ plan: planLiteral({ originals, candidates }), choice: 'r1' });
  assert.equal(result.requests.length, 0, 'over-cap candidates must not reach jev.evaluate');
  assert.equal(result.output[0].status, 'unavailable');
  assert.equal(Object.hasOwn(result.output[0], 'decision'), false);
  assert.deepEqual(result.output[0].references, originals);
  assert.equal(result.output[0].references.length, 8);
  assert.equal(typeof result.output[0].next, 'string');
  assert.ok(result.output[0].next.length > 0);
});

test('skill wire contract keeps usable references and a recovery pointer when evaluation fails, without retrying', async () => {
  const originals = originalsFor(ORIGINAL_IDS);
  const candidates = candidateList(ORIGINAL_IDS.slice(0, 6));
  const result = await runSkillWire({ plan: planLiteral({ originals, candidates }), jevResult: { ok: false, error: { code: 'disabled', message: 'PRIVATE' } } });
  assert.equal(result.requests.length, 1, 'one local jev.evaluate invocation only; no retry');
  const output = result.output[0];
  assert.equal(output.status, 'unavailable');
  assert.deepEqual(output.references, originals);
  assert.equal(output.references.length, 8);
  assert.equal(typeof output.next, 'string');
  assert.ok(output.next.length > 0);
  assert.equal(JSON.stringify(output).includes('PRIVATE'), false);
});

// Offline in-script construction: build the manifest and a projected subset the way a bounded
// source script would, with no network and no Jev call. This is fixture construction, not a real
// source integration or remote-dispatch claim.
test('skill wire contract retains every sourced reference when candidates are a projected subset of offline construction', async () => {
  const sourced = rows(8);
  const originals = sourced.map(({ id, reference }) => ({ id, reference }));
  const candidates = sourced.slice(0, 6).map(({ id, reference, text }) => ({ id, reference, text: text.slice(0, 400) }));
  const result = await runSkillWire({ plan: planLiteral({ originals, candidates }), choice: 'r1' });
  assert.equal(result.output[0].status, 'ok');
  assert.deepEqual(result.output[0].references, originals);
  assert.equal(result.output[0].references.length, 8);
  assert.equal(result.output[0].coverage.returned, 8);
  assert.equal(result.output[0].coverage.evaluated, 6);
});

const BINDINGS = `({ name: 'fixture-server', task: 'Choose one useful next read about the formed hypothesis.',
  mandatoryIds: ['r7'], search: { path: 'fixture.search', args: { query: 'bounded' } },
  rows: data => data.items,
  read: { path: 'fixture.read', args: (id, reference) => ({ id, reference }), extract: data => data.text } })`;

function bindingsFor(mandatoryIds) {
  return BINDINGS.replace("mandatoryIds: ['r7']", `mandatoryIds: ${JSON.stringify(mandatoryIds)}`);
}

function rows(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    reference: `fixture://source/${index}/${'x'.repeat(450)}`,
    text: `candidate ${index} bounded evidence. ${'y'.repeat(500)}`,
  }));
}

async function docsSnippetCode(mandatoryIds = ['r7']) {
  const doc = await readFile(new URL('../docs/examples.md', import.meta.url), 'utf8');
  const marker = doc.indexOf('## Compact in-script source decision');
  assert.notEqual(marker, -1, 'documented compact source decision section is missing');
  const block = doc.slice(marker).match(/```js\n([\s\S]*?)```/);
  assert.ok(block, 'documented compact source decision snippet is missing');
  assert.ok(block[1].includes('__SOURCE_BINDINGS__'), 'snippet must expose the inspected-binding precondition');
  return block[1].replace('const source = __SOURCE_BINDINGS__;', `const source = ${bindingsFor(mandatoryIds)};`);
}

test('documented snippets assume only mcpScript globals, not Node APIs', async () => {
  for (const code of [await skillWireCode(planLiteral({ candidates: candidateList() })), await docsSnippetCode()]) {
    assert.equal(/\bBuffer\b|\bprocess\b|require\(|node:|import\s/.test(code), false, 'snippets must not assume Node globals or modules');
  }
});

async function runSnippet({ items = rows(), choice = 'r1', jevResult = null, jevThrows = false,
  searchResult = null, searchThrows = false, readText = 'ORIGINAL selected source text', readResult = null, readThrows = false,
  mandatoryIds = ['r7'] } = {}) {
  const code = await docsSnippetCode(mandatoryIds);
  const calls = []; const requests = []; const output = [];
  const tools = { call: async (path, args) => {
    calls.push({ path, args });
    if (path === 'fixture.search') {
      if (searchThrows) { throw Error('PRIVATE transport detail'); }
      return searchResult ?? { ok: true, data: { items } };
    }
    if (path === 'fixture.read') {
      if (readThrows) { throw Error('PRIVATE read detail'); }
      return readResult ?? { ok: true, data: { text: readText } };
    }
    return { ok: false };
  } };
  const jev = { evaluate: async request => {
    const wire = JSON.parse(JSON.stringify(request));
    requests.push(wire);
    const question = wire.questions.next;
    assert.equal(question.type, 'choice');
    assert.ok(question.criteria, 'wire request must carry criteria');
    assert.equal(Object.hasOwn(question, 'options'), false, 'wire request must not carry helper options');
    assert.deepEqual(wire.sources, ['fixture-server']);
    assert.ok(Buffer.byteLength(JSON.stringify(wire.state), 'utf8') <= 4096);
    if (jevThrows) { throw Error('PRIVATE evaluation failure'); }
    if (jevResult) { return jevResult; }
    const probabilities = Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0]));
    return { ok: true, data: { model: 'offline-fake', usage: { inputTokens: 11, outputTokens: 3 },
      answers: { next: { type: 'choice', choice, confidence: 1, probabilities } } } };
  } };
  await runInNewContext(`(async () => { ${code} })()`, { tools, jev, emit: value => output.push(JSON.parse(JSON.stringify(value))) }, { timeout: 1000 });
  return { calls, requests, output };
}

test('documented snippet projects bounded candidates, wires criteria and preserves references', async () => {
  const result = await runSnippet({ choice: 'r1' });
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.equal(request.state.candidates.length, 6);
  assert.ok(request.state.candidates.every(row => Buffer.byteLength(row.excerpt, 'utf8') <= 400));
  assert.equal(request.questions.next.criteria.none.length > 0, true);
  assert.equal(request.questions.next.criteria.insufficient.length > 0, true);
  const output = result.output[0];
  assert.equal(output.status, 'ok');
  assert.equal(output.decision, 'r1');
  assert.deepEqual(output.usage, { inputTokens: 11, outputTokens: 3 });
  assert.equal(output.references.length, 8);
  assert.equal(output.coverage.considered, 6);
  assert.equal(output.coverage.omitted, 2);
  assert.equal(output.selected.id, 'r1');
  assert.equal(output.selected.reference.startsWith('fixture://source/1/'), true);
  assert.equal(output.selected.text, 'ORIGINAL selected source text');
  assert.equal(output.selected.truncated, false);
  assert.equal(output.selected.bytes, 29);
  assert.deepEqual(result.calls.map(call => call.path), ['fixture.search', 'fixture.read']);
  assert.equal(result.calls[1].args.id, 'r1');
  assert.equal(output.mandatory?.[0]?.id, 'r7');
  assert.equal(JSON.stringify(output).includes('y'.repeat(500)), false);
});

for (const choice of ['none', 'insufficient']) {
  test(`documented snippet preserves explicit ${choice} without reading the source`, async () => {
    const result = await runSnippet({ choice });
    assert.equal(result.output[0].status, 'ok');
    assert.equal(result.output[0].decision, choice);
    assert.equal(result.output[0].selected, null);
    assert.deepEqual(result.calls.map(call => call.path), ['fixture.search']);
  });
}

test('documented snippet fails closed before Jev when mandatory evidence exceeds the cap', async () => {
  const mandatoryIds = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  const result = await runSnippet({ mandatoryIds });
  assert.equal(result.requests.length, 0);
  assert.equal(result.output[0].status, 'mandatory_over_cap');
  assert.equal(result.output[0].mandatory, 7);
  assert.equal(result.output[0].cap, 6);
  assert.equal(result.output[0].references.length, 8);
});

test('documented snippet keeps tail mandatory evidence inside the fitting cap', async () => {
  const result = await runSnippet({ mandatoryIds: ['r7', 'r6'], choice: 'r1' });
  assert.equal(result.requests.length, 1);
  const planned = result.requests[0].state.candidates.map(row => row.id);
  assert.equal(planned.includes('r7'), true);
  assert.equal(planned.includes('r6'), true);
  assert.deepEqual(result.output[0].mandatory.map(row => row.id).sort(), ['r6', 'r7']);
  assert.equal(result.output[0].coverage.considered, 6);
});

test('documented snippet rejects nested native read errors and never presents error text as evidence', async () => {
  const result = await runSnippet({ choice: 'r1', readResult: { ok: true, data: { isError: true, text: 'PRIVATE error text' } } });
  assert.equal(result.output[0].status, 'ok');
  assert.equal(result.output[0].selected.reference.startsWith('fixture://source/1/'), true);
  assert.equal(Object.hasOwn(result.output[0].selected, 'text'), false);
  assert.equal(JSON.stringify(result.output).includes('PRIVATE'), false);
});

test('documented snippet reports selected-source truncation at non-ASCII byte boundaries', async () => {
  const emoji = await runSnippet({ choice: 'r1', readText: '😀'.repeat(150) });
  assert.equal(emoji.output[0].selected.text, '😀'.repeat(100));
  assert.equal(emoji.output[0].selected.bytes, 400);
  assert.equal(emoji.output[0].selected.truncated, true);
  const split = await runSnippet({ choice: 'r1', readText: 'a'.repeat(399) + '😀' });
  assert.equal(split.output[0].selected.text, 'a'.repeat(399));
  assert.equal(split.output[0].selected.bytes, 399);
  assert.equal(split.output[0].selected.truncated, true);
});

test('documented snippet masks evaluation failures and rejects answers outside the returned IDs', async () => {
  for (const options of [
    { jevResult: { ok: false, error: { code: 'disabled', message: 'PRIVATE' } } },
    { jevThrows: true },
    { choice: 'not-a-returned-id' },
  ]) {
    const result = await runSnippet(options);
    assert.equal(result.requests.length, 1);
    assert.equal(result.calls.length, 1);
    assert.equal(['evaluation_unavailable', 'invalid_response'].includes(result.output[0].status), true);
    assert.equal(JSON.stringify(result.output).includes('PRIVATE'), false);
  }
});

test('documented snippet fails closed on malformed, native-error, empty, singleton, missing and transport results', async () => {
  const malformed = await runSnippet({ searchResult: { ok: true, data: { isError: true, items: rows() } } });
  assert.equal(malformed.output[0].status, 'source_shape_unsupported');
  const transport = await runSnippet({ searchThrows: true });
  assert.equal(transport.output[0].status, 'source_unavailable');
  assert.equal(JSON.stringify(transport.output).includes('PRIVATE'), false);
  const empty = await runSnippet({ items: [], mandatoryIds: [] });
  assert.equal(empty.output[0].status, 'deterministic');
  assert.equal(empty.output[0].reason, 'empty');
  const single = await runSnippet({ items: rows(1), mandatoryIds: [] });
  assert.equal(single.output[0].reason, 'single_candidate');
  const missing = await runSnippet({ items: rows(4).filter(row => row.id !== 'r7') });
  assert.equal(missing.output[0].status, 'mandatory_missing');
  assert.deepEqual(missing.output[0].missingIds, ['r7']);
  for (const result of [malformed, transport, empty, single, missing]) {
    assert.equal(result.requests.length, 0);
  }
});

test('optional read failure keeps the selected original reference without inventing evidence', async () => {
  const result = await runSnippet({ choice: 'r2', readThrows: true });
  assert.equal(result.output[0].status, 'ok');
  assert.equal(result.output[0].selected.id, 'r2');
  assert.equal(result.output[0].selected.reference.startsWith('fixture://source/2/'), true);
  assert.equal(Object.hasOwn(result.output[0].selected, 'text'), false);
});
