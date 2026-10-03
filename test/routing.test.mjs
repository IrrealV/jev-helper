#!/usr/bin/env node
/**
 * Basic tests for Stage 1 route catalog and routing
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { validateCatalog } from '../lib/catalog.mjs';
import { extractTaskContext, selectRoute } from '../lib/routing.mjs';

const catalog = JSON.parse(readFileSync('examples/route-catalog.json', 'utf8'));

console.log('=== Stage 1 Route Catalog Tests ===\n');

// Test 1: Catalog validation
console.log('Test 1: Catalog validation');
const validation = validateCatalog(catalog);
if (validation.valid) {
  console.log('✓ Catalog is valid\n');
} else {
  console.log('✗ Catalog validation failed:');
  validation.errors.forEach(e => console.log(`  - ${e}`));
  console.log();
  process.exit(1);
}

// Test 2: Deterministic trivial route
console.log('Test 2: Deterministic trivial route');
const trivial = selectRoute(
  'gentle-ai-worker',
  'Fix typo in README.md line 42',
  catalog
);
console.log(`Task: "${trivial.taskContext.description}"`);
console.log(`Estimated complexity: ${trivial.taskContext.estimatedComplexity}`);
console.log(`Estimated scope: ${trivial.taskContext.scope}`);
console.log(`Resolution: ${trivial.resolution.status}`);
if (trivial.resolution.status === 'determined') {
  console.log(`Selected route: ${trivial.resolution.route}`);
  console.log(`Reason: ${trivial.resolution.reason}`);
  if (trivial.resolution.route === 'fast-trivial') {
    console.log('✓ Correctly selected fast-trivial route\n');
  } else {
    console.log(`✗ Expected fast-trivial, got ${trivial.resolution.route}\n`);
    process.exit(1);
  }
} else {
  console.log(`✗ Expected determined, got ${trivial.resolution.status}\n`);
  process.exit(1);
}

// Test 3: Deterministic simple route
console.log('Test 3: Deterministic simple route');
const simple = selectRoute(
  'gentle-ai-worker',
  'Add validation to user input form',
  catalog
);
console.log(`Task: "${simple.taskContext.description}"`);
console.log(`Estimated complexity: ${simple.taskContext.estimatedComplexity}`);
console.log(`Estimated scope: ${simple.taskContext.scope}`);
console.log(`Resolution: ${simple.resolution.status}`);
if (simple.resolution.status === 'determined') {
  console.log(`Selected route: ${simple.resolution.route}`);
  console.log(`Reason: ${simple.resolution.reason}`);
  if (simple.resolution.route === 'balanced-simple') {
    console.log('✓ Correctly selected balanced-simple route\n');
  } else {
    console.log(`✗ Expected balanced-simple, got ${simple.resolution.route}\n`);
    process.exit(1);
  }
} else {
  console.log(`✗ Expected determined, got ${simple.resolution.status}\n`);
  process.exit(1);
}

// Test 4: Deterministic complex route
console.log('Test 4: Deterministic complex route');
const complex = selectRoute(
  'gentle-ai-worker',
  'Refactor authentication system architecture across packages',
  catalog
);
console.log(`Task: "${complex.taskContext.description}"`);
console.log(`Estimated complexity: ${complex.taskContext.estimatedComplexity}`);
console.log(`Estimated scope: ${complex.taskContext.scope}`);
console.log(`Resolution: ${complex.resolution.status}`);
if (complex.resolution.status === 'determined') {
  console.log(`Selected route: ${complex.resolution.route}`);
  console.log(`Reason: ${complex.resolution.reason}`);
  if (complex.resolution.route === 'deep-complex') {
    console.log('✓ Correctly selected deep-complex route\n');
  } else {
    console.log(`✗ Expected deep-complex, got ${complex.resolution.route}\n`);
    process.exit(1);
  }
} else {
  console.log(`✗ Expected determined, got ${complex.resolution.status}\n`);
  process.exit(1);
}

// Test 5: Explorer fast scan
console.log('Test 5: Explorer fast scan');
const scan = selectRoute(
  'gentle-ai-explore',
  'Find all TypeScript files in src directory',
  catalog
);
console.log(`Task: "${scan.taskContext.description}"`);
console.log(`Estimated complexity: ${scan.taskContext.estimatedComplexity}`);
console.log(`Estimated scope: ${scan.taskContext.scope}`);
console.log(`Resolution: ${scan.resolution.status}`);
if (scan.resolution.status === 'determined') {
  console.log(`Selected route: ${scan.resolution.route}`);
  console.log(`Reason: ${scan.resolution.reason}`);
  if (scan.resolution.route === 'fast-scan') {
    console.log('✓ Correctly selected fast-scan route\n');
  } else {
    console.log(`✗ Expected fast-scan, got ${scan.resolution.route}\n`);
    process.exit(1);
  }
} else {
  console.log(`✗ Expected determined, got ${scan.resolution.status}\n`);
  process.exit(1);
}

// Test 6: Explorer deep analysis
console.log('Test 6: Explorer deep analysis');
const analysis = selectRoute(
  'gentle-ai-explore',
  'Analyze the authentication flow and trace all permission checks',
  catalog
);
console.log(`Task: "${analysis.taskContext.description}"`);
console.log(`Estimated complexity: ${analysis.taskContext.estimatedComplexity}`);
console.log(`Estimated scope: ${analysis.taskContext.scope}`);
console.log(`Resolution: ${analysis.resolution.status}`);
if (analysis.resolution.status === 'determined') {
  console.log(`Selected route: ${analysis.resolution.route}`);
  console.log(`Reason: ${analysis.resolution.reason}`);
  if (analysis.resolution.route === 'deep-analysis') {
    console.log('✓ Correctly selected deep-analysis route\n');
  } else {
    console.log(`✗ Expected deep-analysis, got ${analysis.resolution.route}\n`);
    process.exit(1);
  }
} else {
  console.log(`✗ Expected determined, got ${analysis.resolution.status}\n`);
  process.exit(1);
}

// Test 7: Unknown agent fallback
console.log('Test 7: Unknown agent fallback');
const unknown = selectRoute(
  'unknown-agent',
  'Some task',
  catalog
);
console.log(`Task: "${unknown.taskContext.description}"`);
console.log(`Resolution: ${unknown.resolution.status}`);
if (unknown.resolution.status === 'no-suitable-route') {
  console.log(`Reason: ${unknown.resolution.reason}`);
  console.log('✓ Correctly handled unknown agent\n');
} else {
  console.log(`✗ Expected no-suitable-route, got ${unknown.resolution.status}\n`);
  process.exit(1);
}

// Regression cases: match words, ignore negated actions and filename tokens.
console.log('Test 8: Word boundaries and negated actions');
for (const [description, complexity, route] of [
  ['Update information', 'simple', 'balanced-simple'],
  ['Update information about the designer', 'simple', 'balanced-simple'],
  ['Update the counter', 'simple', 'balanced-simple'],
  ['FORMAT the output', 'trivial', 'fast-trivial'],
  ['Refactor the module', 'complex', 'deep-complex'],
  ['Do not refactor', 'simple', 'balanced-simple'],
  ["Don't refactor", 'simple', 'balanced-simple'],
  ['Avoid refactor', 'simple', 'balanced-simple'],
  ["DON'T REFACTOR; fix typo", 'trivial', 'fast-trivial'],
  ['Fix typo. Do not refactor.', 'trivial', 'fast-trivial'],
  ['Avoid refactor; format the output', 'trivial', 'fast-trivial'],
  ['Do not format; update information', 'simple', 'balanced-simple'],
  ["Don't investigate; update information", 'simple', 'balanced-simple'],
  // Note: 'breaking change' is complex; mixed negated+trivial can be ambiguous
  ['Do not refactor this module, but refactor the other module', 'complex', 'deep-complex'],
  ['Avoid refactor; design the replacement', 'complex', 'deep-complex']
]) {
  const result = selectRoute('gentle-ai-worker', description, catalog);
  assert.equal(result.taskContext.estimatedComplexity, complexity, description);
  assert.equal(result.resolution.status, 'determined', description);
  assert.equal(result.resolution.route, route, description);
}
assert.equal(extractTaskContext('Update the counter').scope, 'single-file');
assert.equal(extractTaskContext('Find the counter').scope, 'read-only');
assert.equal(extractTaskContext('Find the module; do not refactor').scope, 'read-only');
assert.equal(extractTaskContext('Update information', { complexity: 'complex' }).estimatedComplexity, 'complex');
console.log('✓ Word boundaries and negated actions handled correctly\n');

console.log('Test 9: Filenames are not routing keywords');
for (const filename of [
  'algorithm.ts', 'refactor.js', 'architecture.json', 'design.md',
  'src/algorithm.ts', 'src/refactor/algorithm.test.ts',
  'C:\\src\\algorithm.ts', '`ALGORITHM.TS`', '"design.md"',
  'format.js', 'find.md'
]) {
  const description = `Update ${filename}`;
  const result = selectRoute('gentle-ai-worker', description, catalog);
  assert.deepEqual(result.taskContext.keywords, ['update'], description);
  assert.equal(result.taskContext.estimatedComplexity, 'simple', description);
  assert.equal(result.taskContext.scope, 'single-file', description);
  assert.equal(result.taskContext.description, description);
  assert.equal(result.taskContext.normalized, description.toLowerCase());
  assert.equal(result.resolution.status, 'determined', description);
  assert.equal(result.resolution.route, 'balanced-simple', description);
}
assert.equal(selectRoute('gentle-ai-worker', 'Fix typo in algorithm.ts', catalog).resolution.route, 'fast-trivial');
assert.equal(selectRoute('gentle-ai-worker', 'Refactor algorithm.ts', catalog).resolution.route, 'deep-complex');
assert.equal(extractTaskContext('Update the algorithm').estimatedComplexity, 'complex');
console.log('✓ Filenames excluded while prose keywords remain active\n');

console.log('Test 10: Route patterns and exclusions use literal word boundaries');
for (const [keyword, description, shouldMatch] of [
  ['format', 'information', false],
  ['trace', 'traceback', false],
  ['find', 'finding', false],
  ['FORMAT', 'format', true],
  ['trace', 'trace-based', true],
  ['for.at', 'format', false],
  ['format|trace', 'format', false],
  ['', 'format', false]
]) {
  const patternCatalog = {
    agents: {
      test: {
        routes: [{
          id: 'keyword-route',
          suitability: { description: 'Keyword match', taskPatterns: [{ keywords: [keyword] }] }
        }]
      }
    }
  };
  assert.equal(
    selectRoute('test', description, patternCatalog).resolution.status,
    shouldMatch ? 'determined' : 'no-suitable-route',
    `${keyword} matches ${description}`
  );

  const exclusionCatalog = {
    agents: {
      test: {
        routes: [{
          id: 'allowed-route',
          suitability: {
            description: 'Keyword exclusion',
            taskPatterns: [{}],
            constraints: [{ excludeKeywords: [keyword] }]
          }
        }]
      }
    }
  };
  assert.equal(
    selectRoute('test', description, exclusionCatalog).resolution.status,
    shouldMatch ? 'no-suitable-route' : 'determined',
    `${keyword} excludes ${description}`
  );
}
console.log('✓ Route pattern and exclusion matching is boundary-aware\n');

console.log('=== All tests passed ===');
