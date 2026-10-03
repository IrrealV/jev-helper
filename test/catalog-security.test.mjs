import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  selectJevRoute,
  clearCatalogCache,
  getCatalogPath,
} from '../skills/jev-route-selector/index.mjs';

const projectRoot = '/catalog-security-project';
const userRoot = '/catalog-security-user';
const projectPath = join(projectRoot, '.pi/jev-helper/route-catalog.json');
const userPath = join(userRoot, '.pi/jev-helper/route-catalog.json');
const defaultPath = fileURLToPath(new URL('../examples/route-catalog.json', import.meta.url));
const validCatalog = JSON.stringify({ version: '1.0.0', agents: {} });

function mockCatalogFiles(t, files) {
  clearCatalogCache();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    clearCatalogCache();
  });
  t.mock.method(os, 'homedir', () => userRoot);
  const exists = t.mock.method(fs, 'existsSync', path => files.has(resolve(path)));
  const read = t.mock.method(fs, 'readFileSync', path => {
    assert.equal(files.has(resolve(path)), true, `Unexpected catalog read: ${path}`);
    const content = files.get(resolve(path));
    if (content instanceof Error) throw content;
    return content;
  });
  // Update the loader's named built-in imports without touching the real filesystem.
  syncBuiltinESMExports();
  return { exists, read };
}

function catalogWithModel(model) {
  return JSON.stringify({
    version: '1.0.0',
    agents: {
      'security-test-agent': {
        identity: 'security-test-agent',
        description: 'Catalog identity fixture',
        routes: [{
          id: 'test-route',
          model,
          thinking: 'low',
          suitability: {
            description: 'Simple tasks',
            taskPatterns: [{ maxComplexity: 'simple' }],
          },
          cost: { tokensPerTask: 1000, relative: 'low' },
        }],
      },
    },
  });
}

function selectModel(projectRoot) {
  return selectJevRoute('security-test-agent', 'Fix typo', { projectRoot }).model;
}

function selectFromProject() {
  return selectJevRoute('security-test-agent', 'Test task', { projectRoot });
}

for (const [label, catalogPath] of [['project', projectPath], ['user', userPath]]) {
  for (const [failure, content, expected] of [
    ['malformed JSON', '{ broken JSON', /Failed to parse catalog/],
    ['invalid schema', JSON.stringify({ version: 'unsupported' }), /Invalid catalog/],
    ['overflowing token estimate', catalogWithModel('overflow-model').replace('"tokensPerTask":1000', '"tokensPerTask":1e309'),
      /Invalid catalog.*"tokensPerTask" must be a positive number/],
    ['read error', Object.assign(new Error('Permission denied'), { code: 'EACCES' }), { code: 'EACCES' }],
  ]) {
    test(`rejects ${failure} in ${label} catalog without falling back`, t => {
      const files = new Map([[userPath, validCatalog], [defaultPath, validCatalog]]);
      files.set(catalogPath, content);
      const { exists, read } = mockCatalogFiles(t, files);

      assert.throws(selectFromProject, expected);
      assert.equal(getCatalogPath(projectRoot), null);
      assert.deepEqual(read.mock.calls.map(call => call.arguments[0]), [catalogPath]);
      assert.deepEqual(exists.mock.calls.map(call => call.arguments[0]),
        label === 'project' ? [projectPath] : [projectPath, userPath]);
    });
  }
}

for (const [label, paths, selectedPath] of [
  ['project over user and default', [projectPath, userPath, defaultPath], projectPath],
  ['user when project is missing', [userPath, defaultPath], userPath],
  ['default when project and user are missing', [defaultPath], defaultPath],
]) {
  test(`loads ${label}`, t => {
    const { read } = mockCatalogFiles(t, new Map(paths.map(path => [path, validCatalog])));

    const result = selectFromProject();

    assert.equal(result.status, 'no-suitable-route');
    assert.equal(getCatalogPath(projectRoot), selectedPath);
    assert.deepEqual(read.mock.calls.map(call => call.arguments[0]), [selectedPath]);
  });
}

for (const projectFirst of [false, true]) {
  test(`keeps default-named project separate from no-project cache (${projectFirst ? 'project' : 'global'} first)`, t => {
    const localPath = resolve('default', '.pi/jev-helper/route-catalog.json');
    mockCatalogFiles(t, new Map([
      [userPath, catalogWithModel('global-model')],
      [localPath, catalogWithModel('project-model')],
    ]));

    if (projectFirst) {
      assert.equal(selectModel('default'), 'project-model');
      assert.equal(selectModel(), 'global-model');
    } else {
      assert.equal(selectModel(), 'global-model');
      assert.equal(selectModel('default'), 'project-model');
    }
    assert.equal(getCatalogPath(), userPath);
    assert.equal(getCatalogPath('default'), localPath);
    clearCatalogCache('default');
    assert.equal(getCatalogPath('default'), null);
    assert.equal(getCatalogPath(), userPath);
  });
}

test('resolves relative project cache keys against the current working directory', t => {
  const firstCwd = resolve('/virtual/first');
  const secondCwd = resolve('/virtual/second');
  const firstPath = join(firstCwd, 'project', '.pi/jev-helper/route-catalog.json');
  const secondPath = join(secondCwd, 'project', '.pi/jev-helper/route-catalog.json');
  mockCatalogFiles(t, new Map([
    [firstPath, catalogWithModel('first-model')],
    [secondPath, catalogWithModel('second-model')],
  ]));
  // Simulate chdir without changing process state or requiring real directories.
  let cwd = firstCwd;
  t.mock.method(process, 'cwd', () => cwd);

  assert.equal(selectModel('project'), 'first-model');
  cwd = secondCwd;
  assert.equal(selectModel('project'), 'second-model');
  assert.equal(getCatalogPath('project'), secondPath);
  assert.equal(getCatalogPath(join(firstCwd, 'project')), firstPath);

  clearCatalogCache('./project');
  assert.equal(getCatalogPath('project'), null);
  cwd = firstCwd;
  assert.equal(getCatalogPath('./project'), firstPath);
  assert.equal(selectModel('project'), 'first-model');
});

test('shares and clears a cache entry across equivalent absolute and relative paths', t => {
  const root = resolve('project');
  const localPath = join(root, '.pi/jev-helper/route-catalog.json');
  const files = new Map([[localPath, catalogWithModel('original-model')]]);
  mockCatalogFiles(t, files);

  assert.equal(selectModel('./project'), 'original-model');
  files.set(localPath, catalogWithModel('updated-model'));
  assert.equal(selectModel(root), 'original-model');
  assert.equal(getCatalogPath('project'), localPath);
  clearCatalogCache(root);
  assert.equal(getCatalogPath('./project'), null);
  assert.equal(selectModel('project'), 'updated-model');
  clearCatalogCache();
  assert.equal(getCatalogPath(root), null);
});

test('ignores a newly created higher-priority catalog until explicitly cleared', t => {
  const files = new Map([[userPath, catalogWithModel('user-model')]]);
  const { exists, read } = mockCatalogFiles(t, files);

  assert.equal(selectModel(projectRoot), 'user-model');
  assert.equal(selectModel(), 'user-model');
  const existsCalls = exists.mock.callCount();
  const readCalls = read.mock.callCount();

  files.set(projectPath, catalogWithModel('project-model'));
  assert.equal(selectModel(projectRoot), 'user-model');
  assert.equal(getCatalogPath(projectRoot), userPath);
  assert.equal(exists.mock.callCount(), existsCalls);
  assert.equal(read.mock.callCount(), readCalls);

  clearCatalogCache(projectRoot);
  assert.equal(getCatalogPath(projectRoot), null);
  assert.equal(getCatalogPath(), userPath);
  assert.equal(selectModel(projectRoot), 'project-model');
  assert.equal(getCatalogPath(projectRoot), projectPath);

  clearCatalogCache();
  assert.equal(getCatalogPath(projectRoot), null);
  assert.equal(getCatalogPath(), null);
});

for (const directory of ['my project', 'project #1 100% café']) {
  test(`loads bundled fallback from an installation path containing ${directory}`, t => {
    const packageRoot = resolve('/virtual', directory, 'node_modules/jev-helper');
    const bundledPath = join(packageRoot, 'examples/route-catalog.json');
    const installedModule = pathToFileURL(join(packageRoot, 'skills/jev-route-selector/index.mjs'));
    const sourceModule = new URL('../skills/jev-route-selector/index.mjs', import.meta.url).href;
    mockCatalogFiles(t, new Map([[bundledPath, catalogWithModel('bundled-model')]]));
    // Relocate only the loader's import.meta.url resolution, keeping real URL encoding.
    t.mock.method(globalThis, 'URL', class extends URL {
      constructor(input, base) {
        super(input, base === sourceModule ? installedModule : base);
      }
    });

    assert.equal(selectModel(), 'bundled-model');
    assert.equal(getCatalogPath(), bundledPath);
  });
}

test('throws when all catalog locations are missing', t => {
  const { read } = mockCatalogFiles(t, new Map());

  assert.throws(selectFromProject, /No valid route catalog found/);
  assert.equal(getCatalogPath(projectRoot), null);
  assert.equal(read.mock.callCount(), 0);
});
