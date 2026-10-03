import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '../lib/catalog.mjs';

function makeCatalog() {
  return {
    version: '1.0.0',
    agents: {
      worker: {
        identity: 'worker',
        description: 'Test worker',
        defaultRoute: 'standard',
        routes: [{
          id: 'standard',
          model: 'test-model',
          suitability: {
            description: 'Test suitability',
            taskPatterns: [{ keywords: ['test'] }],
          },
          cost: { relative: 'low' },
        }],
      },
    },
  };
}

for (const [label, route] of [
  ['null', null],
  ['undefined', undefined],
  ['number', 42],
  ['string', 'string'],
]) {
  test(`rejects ${label} routes without throwing`, () => {
    const catalog = makeCatalog();
    catalog.agents.worker.routes = [route];

    const result = validateCatalog(catalog);

    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('Agent "worker": routes[0]: must be an object'));
  });
}

for (const [label, pattern, error] of [
  ['array', [], 'must be an object'],
  ['null', null, 'must be an object'],
  ['empty object', {}, 'must specify at least one criterion'],
  ['string', 'string', 'must be an object'],
  ['unknown criterion', { unknown: 'test' }, 'must specify at least one criterion'],
]) {
  test(`rejects ${label} task patterns`, () => {
    const catalog = makeCatalog();
    catalog.agents.worker.routes[0].suitability.taskPatterns = [pattern];

    const result = validateCatalog(catalog);

    assert.deepEqual(result, {
      valid: false,
      errors: [`Agent "worker": routes[0]: suitability: taskPatterns[0]: ${error}`],
    });
  });
}

for (const [label, requiresScope, error] of [
  ['empty', [], '"requiresScope" array cannot be empty'],
  ['null item', [null], '"requiresScope" must contain only: read-only, single-file, multi-file, cross-package'],
  ['empty string item', [''], '"requiresScope" must contain only: read-only, single-file, multi-file, cross-package'],
]) {
  test(`rejects ${label} required scopes`, () => {
    const catalog = makeCatalog();
    catalog.agents.worker.routes[0].suitability.constraints = [{ requiresScope }];

    const result = validateCatalog(catalog);

    assert.deepEqual(result, {
      valid: false,
      errors: [`Agent "worker": routes[0]: suitability: constraints[0]: ${error}`],
    });
  });
}

for (const pattern of [
  { keywords: ['test'] },
  { maxComplexity: 'simple' },
  { requiresComplexity: 'moderate' },
  { scope: ['read-only'] },
  { priority: ['normal'] },
]) {
  test(`accepts a pattern with only ${Object.keys(pattern)[0]} and a nonempty required scope`, () => {
    const catalog = makeCatalog();
    catalog.agents.worker.routes[0].suitability.taskPatterns = [pattern];
    catalog.agents.worker.routes[0].suitability.constraints = [{ requiresScope: ['read-only'] }];

    assert.deepEqual(validateCatalog(catalog), { valid: true, errors: [] });
  });
}

for (const [label, tokensPerTask] of [
  ['NaN', NaN],
  ['positive infinity', Infinity],
  ['negative infinity', -Infinity],
  ['zero', 0],
  ['negative', -1],
  ['numeric string', '1000'],
  ['null', null],
  ['boolean', true],
  ['object', {}],
  ['array', []],
]) {
  test(`rejects ${label} token estimates`, () => {
    const catalog = makeCatalog();
    catalog.agents.worker.routes[0].cost.tokensPerTask = tokensPerTask;

    assert.deepEqual(validateCatalog(catalog), {
      valid: false,
      errors: ['Agent "worker": routes[0]: cost: "tokensPerTask" must be a positive number'],
    });
  });
}

for (const tokensPerTask of [Number.MIN_VALUE, 0.5, 1000, Number.MAX_VALUE]) {
  test(`accepts finite positive token estimate ${tokensPerTask}`, () => {
    const catalog = makeCatalog();
    catalog.agents.worker.routes[0].cost.tokensPerTask = tokensPerTask;

    assert.deepEqual(validateCatalog(catalog), { valid: true, errors: [] });
  });
}

test('accepts omitted token estimates', () => {
  assert.deepEqual(validateCatalog(makeCatalog()), { valid: true, errors: [] });
});

test('still detects duplicate route IDs and missing default routes', () => {
  const catalog = makeCatalog();
  catalog.agents.worker.routes.push(structuredClone(catalog.agents.worker.routes[0]));
  catalog.agents.worker.defaultRoute = 'missing';

  assert.deepEqual(validateCatalog(catalog), {
    valid: false,
    errors: [
      'Agent "worker": routes[1]: duplicate route id "standard"',
      'Agent "worker": defaultRoute "missing" not found in routes',
    ],
  });
});
