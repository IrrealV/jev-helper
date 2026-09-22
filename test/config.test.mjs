import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectConfig, setup, undo, parseConfig, planJev } from '../lib/config.mjs';

function fixture(text = '{\n // keep comment\n "settings": {"other": 42}, "mcpServers": {}\n}') {
  const root = mkdtempSync(join(tmpdir(), 'jev-config-'));
  const global = join(root, 'global.json');
  const project = join(root, 'project.json');
  writeFileSync(global, '{"settings":{"jev":{"semanticSearch":true,"maxRetries":1,"maxStateBytes":2000}},"mcpServers":{"docs":{"command":"fake"}}}');
  writeFileSync(project, text);
  const api = {
    getConfigDiscoveryPaths: () => [{ path: global }, { path: project }],
    getPiGlobalConfigPath: () => global,
    getProjectPiConfigPath: () => project,
    loadMcpConfig: () => {
      const a = parseConfig(readFileSync(global, 'utf8'));
      const b = parseConfig(readFileSync(project, 'utf8'));
      return { mcpServers: { ...a.mcpServers, ...b.mcpServers }, settings: { ...a.settings, ...b.settings } };
    },
  };
  return { api, cwd: root, global, project };
}

test('setup requires scope and explicit enable without touching config', () => {
  const f = fixture();
  const before = readFileSync(f.project, 'utf8');
  assert.throws(() => setup({ ...f, scope: 'project' }), /enable/);
  assert.throws(() => setup({ ...f, enable: true }), /scope/);
  assert.equal(readFileSync(f.project, 'utf8'), before);
});

test('setup seeds the entire effective Jev block, preserves comments and is idempotent', () => {
  const f = fixture();
  const globalBefore = readFileSync(f.global, 'utf8');
  const result = setup({ ...f, scope: 'project', enable: true, sources: ['docs'] });
  assert.equal(result.changed, true);
  const after = readFileSync(f.project, 'utf8');
  assert.match(after, /keep comment/);
  const value = parseConfig(after);
  assert.equal(value.settings.other, 42);
  assert.equal(value.settings.jev.semanticSearch, true);
  assert.equal(value.settings.jev.maxRetries, 1);
  assert.equal(value.settings.jev.maxStateBytes, 2000);
  assert.equal(value.settings.jev.scriptEvaluation, true);
  assert.deepEqual(value.settings.jev.allowedServers, ['docs']);
  assert.equal(setup({ ...f, scope: 'project', enable: true, sources: ['docs'] }).changed, false);
  assert.equal(readFileSync(f.project, 'utf8'), after);
  assert.equal(readFileSync(f.global, 'utf8'), globalBefore);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(`${f.project}.jev-helper-rollback.json`, 'utf8'))).sort(), ['expected', 'previous']);
});

test('setup preserves inherited implicit semantic search and can undo the seeded object', () => {
  const f = fixture();
  const original = '{"settings":{"jev":{"maxRetries":1}},"mcpServers":{}}';
  writeFileSync(f.global, original);
  const options = { ...f, scope: 'project', enable: true };
  assert.equal(setup(options).changed, true);
  const seeded = parseConfig(readFileSync(f.project, 'utf8')).settings.jev;
  assert.equal(Object.hasOwn(seeded, 'semanticSearch'), false);
  assert.equal(seeded.maxRetries, 1);
  assert.equal(seeded.scriptEvaluation, true);
  assert.equal(setup(options).changed, false);
  assert.equal(undo(options).changed, true);
  assert.deepEqual(inspectConfig(f).effective.settings.jev, { maxRetries: 1 });
  assert.equal(readFileSync(f.global, 'utf8'), original);
});

test('semantic search defaults false only for new or previously disabled Jev settings', () => {
  for (const existing of [undefined, false]) {
    const next = planJev({ settings: { jev: existing }, mcpServers: {} });
    assert.equal(next.semanticSearch, false);
  }
  for (const existing of [{}, { maxRetries: 1 }]) {
    const next = planJev({ settings: { jev: existing }, mcpServers: {} });
    assert.equal(Object.hasOwn(next, 'semanticSearch'), false);
  }
  for (const semanticSearch of [true, false]) {
    const next = planJev({ settings: { jev: { semanticSearch } }, mcpServers: {} });
    assert.equal(next.semanticSearch, semanticSearch);
  }
});

test('undo restores only owned Jev and preserves unrelated later edits', () => {
  const f = fixture();
  setup({ ...f, scope: 'project', enable: true });
  writeFileSync(f.project, readFileSync(f.project, 'utf8').replace('42', '99'));
  assert.equal(undo({ ...f, scope: 'project' }).changed, true);
  const restored = parseConfig(readFileSync(f.project, 'utf8'));
  assert.equal(Object.hasOwn(restored.settings, 'jev'), false);
  assert.equal(restored.settings.other, 99);
  assert.equal(undo({ ...f, scope: 'project' }).changed, false);
});

test('undo refuses a conflicting Jev edit', () => {
  const f = fixture();
  setup({ ...f, scope: 'project', enable: true });
  writeFileSync(f.project, readFileSync(f.project, 'utf8').replace('"scriptEvaluation": true', '"scriptEvaluation": false'));
  assert.throws(() => undo({ ...f, scope: 'project' }), /conflict/);
});

test('config rejects malformed and duplicate JSONC keys and invalid Jev settings', () => {
  for (const text of ['{', '[]', '{"settings":false}', '{"settings":{},"settings":{}}', '{"settings":{"jev":{"apiKey":"never copy"}}}']) {
    assert.throws(() => parseConfig(text));
  }
  const f = fixture();
  writeFileSync(f.global, '{broken');
  assert.throws(() => inspectConfig(f));
});

test('sources require known enabled servers; defaults are synthetic only', () => {
  const config = { mcpServers: { docs: {}, off: { disabled: true } } };
  assert.deepEqual(planJev(config).allowedServers, []);
  assert.equal(planJev(config).semanticSearch, false);
  assert.throws(() => planJev(config, ['off']), /sources/);
  assert.throws(() => planJev(config, ['unknown']), /sources/);
  assert.deepEqual(planJev(config, ['docs']).allowedServers, ['docs']);
});

test('setup refuses symlink config and global settings shadowed by project Jev', () => {
  const f = fixture();
  const linked = join(f.cwd, 'link.json');
  symlinkSync(f.project, linked);
  assert.throws(() => inspectConfig({ ...f, api: { ...f.api, getConfigDiscoveryPaths: () => [{ path: linked }] } }), /path/);
  setup({ ...f, scope: 'project', enable: true });
  assert.throws(() => setup({ ...f, scope: 'global', enable: true }), /shadow/);
});

test('interrupted write-ahead setup can be undone harmlessly or resumed', () => {
  const f = fixture();
  const before = readFileSync(f.project, 'utf8');
  setup({ ...f, scope: 'project', enable: true });
  writeFileSync(f.project, before); // Simulate failure after sidecar, before config replacement.
  assert.equal(undo({ ...f, scope: 'project' }).changed, false);
  assert.equal(setup({ ...f, scope: 'project', enable: true }).changed, true);
  assert.equal(undo({ ...f, scope: 'project' }).changed, true);
  assert.equal(Object.hasOwn(parseConfig(readFileSync(f.project, 'utf8')).settings, 'jev'), false);
});

test('config refuses malformed imported-source warnings without disclosing them', () => {
  const f = fixture();
  const originalWarn = console.warn;
  const api = { ...f.api, loadMcpConfig: () => { console.warn('secret path and token'); return { mcpServers: {} }; } };
  assert.throws(() => inspectConfig({ ...f, api }), /Unable to validate/);
  assert.equal(console.warn, originalWarn);
});

test('config notices concurrent changes during public config loading', () => {
  const f = fixture();
  const api = { ...f.api, loadMcpConfig: () => {
    const result = f.api.loadMcpConfig();
    writeFileSync(f.project, '{"settings":{"other":101}}');
    return result;
  } };
  assert.throws(() => setup({ ...f, api, scope: 'project', enable: true }), /concurrent/);
  assert.equal(parseConfig(readFileSync(f.project, 'utf8')).settings.other, 101);
});

test('config refuses invalid imports and discovery settings rather than accepting adapter normalization', () => {
  for (const value of [{ imports: false }, { imports: ['unknown-host'] }, { settings: { hostConfigDiscovery: 'yes' } }, { settings: { ancestorConfigRoots: false } }, { claudePlugins: false }]) {
    assert.throws(() => parseConfig(JSON.stringify(value)));
  }
});

test('exclusive config refuses a project scope that is not the active target', () => {
  const f = fixture();
  const api = { ...f.api, getConfigDiscoveryPaths: () => [{ path: f.global }] };
  assert.throws(() => setup({ ...f, api, scope: 'project', enable: true }), /active/);
});
