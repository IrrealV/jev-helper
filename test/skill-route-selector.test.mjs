#!/usr/bin/env node
/**
 * Tests for jev-route-selector skill
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectJevRoute, clearCatalogCache, getCatalogPath } from '../skills/jev-route-selector/index.mjs';

console.log('=== jev-route-selector Skill Tests ===\n');

// Test 1: Catalog loading
console.log('Test 1: Catalog loading');
clearCatalogCache();
try {
  const result = selectJevRoute('gentle-ai-worker', 'Test task');
  const catalogPath = getCatalogPath(); // No projectRoot = uses 'default'
  console.log(`✓ Catalog loaded from: ${catalogPath}\n`);
} catch (error) {
  console.log(`✗ Failed to load catalog: ${error.message}\n`);
  process.exit(1);
}

// Test 2: Determined route with full details
console.log('Test 2: Determined route with full details');
const trivialResult = selectJevRoute(
  'gentle-ai-worker',
  'Fix typo in README.md line 42'
);
console.log(`Status: ${trivialResult.status}`);
console.log(`Route: ${trivialResult.route}`);
console.log(`Model: ${trivialResult.model}`);
console.log(`Thinking: ${trivialResult.thinking}`);
console.log(`Estimated tokens: ${trivialResult.estimatedTokens}`);
console.log(`Reason: ${trivialResult.reason}`);

if (trivialResult.status === 'determined' && 
    trivialResult.route === 'fast-trivial' &&
    trivialResult.model &&
    trivialResult.thinking === 'low' &&
    trivialResult.estimatedTokens === 5000) {
  console.log('✓ Correct determined route with complete details\n');
} else {
  console.log('✗ Unexpected result structure\n');
  process.exit(1);
}

// Test 3: Complex route
console.log('Test 3: Complex route selection');
const complexResult = selectJevRoute(
  'gentle-ai-worker',
  'Refactor authentication system architecture across packages'
);
console.log(`Status: ${complexResult.status}`);
console.log(`Route: ${complexResult.route}`);
console.log(`Thinking: ${complexResult.thinking}`);
console.log(`Estimated tokens: ${complexResult.estimatedTokens}`);

if (complexResult.status === 'determined' && 
    complexResult.route === 'deep-complex' &&
    complexResult.thinking === 'high') {
  console.log('✓ Correct complex route selected\n');
} else {
  console.log('✗ Unexpected complex route\n');
  process.exit(1);
}

// Test 4: Explorer agent
console.log('Test 4: Explorer agent routing');
const exploreResult = selectJevRoute(
  'gentle-ai-explore',
  'Find all TypeScript files in src directory'
);
console.log(`Status: ${exploreResult.status}`);
console.log(`Route: ${exploreResult.route}`);
console.log(`Agent: ${exploreResult.agent}`);

if (exploreResult.status === 'determined' && 
    exploreResult.route === 'fast-scan' &&
    exploreResult.agent === 'gentle-ai-explore') {
  console.log('✓ Correct explorer route selected\n');
} else {
  console.log('✗ Unexpected explorer route\n');
  process.exit(1);
}

// Test 5: Task context extraction
console.log('Test 5: Task context extraction');
const contextResult = selectJevRoute(
  'gentle-ai-worker',
  'Add validation to user input form'
);
console.log(`Task context:`, contextResult.taskContext);

if (contextResult.taskContext.keywords.length > 0 &&
    contextResult.taskContext.estimatedComplexity &&
    contextResult.taskContext.scope &&
    contextResult.taskContext.priority) {
  console.log('✓ Complete task context extracted\n');
} else {
  console.log('✗ Incomplete task context\n');
  process.exit(1);
}

// Test 6: Unknown agent handling
console.log('Test 6: Unknown agent handling');
const unknownResult = selectJevRoute(
  'unknown-agent',
  'Some task'
);
console.log(`Status: ${unknownResult.status}`);
console.log(`Reason: ${unknownResult.reason}`);

if (unknownResult.status === 'no-suitable-route') {
  console.log('✓ Unknown agent handled correctly\n');
} else {
  console.log('✗ Unexpected unknown agent handling\n');
  process.exit(1);
}

// Test 7: Catalog caching
console.log('Test 7: Catalog caching');
const catalogPath1 = getCatalogPath(); // No projectRoot = 'default'
selectJevRoute('gentle-ai-worker', 'Another task');
const catalogPath2 = getCatalogPath(); // No projectRoot = 'default'

if (catalogPath1 === catalogPath2) {
  console.log(`✓ Catalog cached correctly (${catalogPath1})\n`);
} else {
  console.log('✗ Catalog not cached properly\n');
  process.exit(1);
}

console.log('=== Legacy skill checks passed ===');

for (const nested of [false, true]) {
  const api = nested ? 'nested' : 'direct';

  test(`${api} complexity hints select the complex route for a simple description`, () => {
    const hints = { complexity: 'complex' };
    const result = selectJevRoute(
      'gentle-ai-worker', 'Update the module', nested ? { hints } : hints
    );

    assert.equal(result.route, 'deep-complex');
    assert.equal(result.status, 'determined');
    assert.equal(result.taskContext.estimatedComplexity, 'complex');
  });

  test(`${api} scope and priority hints are preserved`, () => {
    const hints = { scope: 'cross-package', priority: 'high' };
    const result = selectJevRoute(
      'gentle-ai-worker', 'Investigate the module', nested ? { hints } : hints
    );

    assert.equal(result.route, 'deep-complex');
    assert.equal(result.status, 'determined');
    assert.equal(result.taskContext.scope, 'cross-package');
    assert.equal(result.taskContext.priority, 'high');
  });

  for (const complexity of ['COMPLEX', 'INVALID', null, 42, undefined]) {
    test(`${api} API rejects invalid complexity ${JSON.stringify(complexity)}`, () => {
      const hints = { complexity };
      assert.throws(
        () => selectJevRoute('gentle-ai-worker', 'Update the module', nested ? { hints } : hints),
        { name: 'TypeError', message: /complexity.*trivial.*simple.*moderate.*complex/i }
      );
    });
  }
}

test('nested hints take precedence over direct hints without merging', () => {
  const result = selectJevRoute('gentle-ai-worker', 'Update the module', {
    complexity: 'simple',
    priority: 'high',
    hints: { complexity: 'complex' }
  });

  assert.equal(result.route, 'deep-complex');
  assert.equal(result.taskContext.estimatedComplexity, 'complex');
  assert.equal(result.taskContext.priority, 'normal');
});
