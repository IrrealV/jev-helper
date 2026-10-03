import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import {
  selectJevRoute,
  clearCatalogCache,
  getCatalogPath,
} from '../skills/jev-route-selector/index.mjs';

const projectRoot = '/catalog-security-project';
const userRoot = '/catalog-security-user';
const projectPath = join(projectRoot, '.pi/jev-helper/route-catalog.json');
const userPath = join(userRoot, '.pi/jev-helper/route-catalog.json');
const defaultPath = new URL('../examples/route-catalog.json', import.meta.url).pathname;
const validCatalog = JSON.stringify({ version: '1.0.0', agents: {} });

function mockCatalogFiles(t, files) {
  clearCatalogCache();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    clearCatalogCache();
  });
  t.mock.method(os, 'homedir', () => userRoot);
  const exists = t.mock.method(fs, 'existsSync', path => files.has(path));
  const read = t.mock.method(fs, 'readFileSync', path => {
    assert.equal(files.has(path), true, `Unexpected catalog read: ${path}`);
    const content = files.get(path);
    if (content instanceof Error) throw content;
    return content;
  });
  // Update the loader's named built-in imports without touching the real filesystem.
  syncBuiltinESMExports();
  return { exists, read };
}

function selectFromProject() {
  return selectJevRoute('security-test-agent', 'Test task', { projectRoot });
}

for (const [label, catalogPath] of [['project', projectPath], ['user', userPath]]) {
  for (const [failure, content, expected] of [
    ['malformed JSON', '{ broken JSON', /Failed to parse catalog/],
    ['invalid schema', JSON.stringify({ version: 'unsupported' }), /Invalid catalog/],
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

test('throws when all catalog locations are missing', t => {
  const { read } = mockCatalogFiles(t, new Map());

  assert.throws(selectFromProject, /No valid route catalog found/);
  assert.equal(getCatalogPath(projectRoot), null);
  assert.equal(read.mock.callCount(), 0);
});
