import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAdapter, loadAdapterConfig, configOverride } from '../lib/adapter.mjs';
import { diagnose } from '../lib/doctor.mjs';

function installed() {
  const root = mkdtempSync(join(tmpdir(), 'jev-adapter-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'pi-mcp-adapter', version: '2.36.0', type: 'module', exports: { './config': './public.mjs' }, bin: { 'pi-mcp-adapter': 'cli.js' } }));
  writeFileSync(join(root, 'index.ts'), '');
  writeFileSync(join(root, 'public.mjs'), 'export const publicOnly = true;');
  return root;
}
const source = root => ({ path: join(root, 'index.ts'), source: 'npm:pi-mcp-adapter@2.36.0', scope: 'user', origin: 'package', baseDir: root });

test('discovers adapter ownership by source metadata and resolves its public config export', async () => {
  const root = installed();
  const adapter = discoverAdapter({ tools: [{ name: 'mcpScript', sourceInfo: source(root) }], commands: [], cwd: root });
  assert.equal(adapter.root, root);
  assert.equal(adapter.loaded, true);
  assert.equal(adapter.version, '2.36.0');
  assert.equal((await loadAdapterConfig(adapter)).publicOnly, true);
});

test('commands locate loaded adapter even when script tool is disabled', () => {
  const root = installed();
  assert.equal(discoverAdapter({ commands: [{ name: 'mcp', source: 'extension', sourceInfo: source(root) }], cwd: root }).loaded, true);
});

test('adapter skills and prompt templates do not masquerade as wrapped extension commands', () => {
  const root = installed();
  const commands = [
    { name: 'mcp', source: 'extension', sourceInfo: source(root) },
    { name: 'skill:mcp-scripting', source: 'skill', sourceInfo: { ...source(root), path: join(root, 'skills/mcp-scripting/SKILL.md') } },
    { name: 'mcp-example', source: 'prompt', sourceInfo: { ...source(root), path: join(root, 'prompts/mcp-example.md') } },
  ];
  const adapter = discoverAdapter({ tools: [{ name: 'mcpScript', sourceInfo: source(root) }], commands, cwd: root });
  assert.equal(adapter.loaded, true);
  assert.equal(adapter.root, root);
  assert.equal(discoverAdapter({ commands: commands.slice(1), explicitRoot: root, cwd: root }).loaded, false);
});

test('extension command provenance still rejects SDK and wrapper factories', () => {
  const root = installed();
  for (const sourceInfo of [
    { ...source(root), source: 'sdk' },
    { ...source(root), path: join(root, 'wrapper.ts') },
  ]) {
    assert.throws(() => discoverAdapter({ commands: [{ name: 'mcp', source: 'extension', sourceInfo }], cwd: root }), /Programmatic adapter provenance/);
  }
});

test('fallback finds separately installed package but never claims it loaded', () => {
  const root = mkdtempSync(join(tmpdir(), 'jev-fallback-'));
  const adapterRoot = join(root, '.pi/npm/node_modules/pi-mcp-adapter');
  mkdirSync(adapterRoot, { recursive: true });
  writeFileSync(join(adapterRoot, 'package.json'), '{"name":"pi-mcp-adapter","version":"2.36.0"}');
  assert.equal(discoverAdapter({ cwd: root, configDirName: '.pi', agentDir: join(root, 'global') }).loaded, false);
});

test('refuses conflicting installations and wrapper provenance', () => {
  const a = installed(); const b = installed();
  assert.throws(() => discoverAdapter({ tools: [{ sourceInfo: source(a) }, { sourceInfo: source(b) }], cwd: a }), /ambiguous/i);
  assert.throws(() => discoverAdapter({ explicitRoot: a, tools: [{ name: 'mcpScript', sourceInfo: { path: join(a, 'wrapper.ts'), source: 'sdk' } }], cwd: a }), /programmatic|provenance/i);
});

test('config override accepts a single literal path and rejects ambiguity', () => {
  assert.equal(configOverride(['--mcp-config', 'custom.json'], undefined, '/work'), '/work/custom.json');
  assert.equal(configOverride([], 'custom.json', '/work'), '/work/custom.json');
  // Pi returns undefined for another extension's flag; no empty-string default is registered.
  assert.equal(configOverride([], undefined, '/work'), undefined);
  assert.throws(() => configOverride([], '', '/work'), /literal/);
  assert.throws(() => configOverride(['--mcp-config', ''], undefined, '/work'), /literal/);
  assert.throws(() => configOverride(['--mcp-config', 'a', '--mcp-config', 'b'], undefined, '/work'));
  assert.throws(() => configOverride(['--mcp-config', 'a'], 'b', '/work'));
  assert.throws(() => configOverride(['--mcp-config', '$SECRET'], undefined, '/work'));
});

test('doctor separates disk enablement from inactive or missing runtime and does not echo config', () => {
  const root = installed();
  const adapter = { root, version: '2.36.0', loaded: true };
  const tools = [{ name: 'mcpScript', sourceInfo: source(root), description: 'do not emit this' }];
  const report = diagnose({ adapter, tools, activeTools: [], piVersion: '0.86.1', effective: { settings: { jev: { scriptEvaluation: true, allowedServers: [], maxStateBytes: 100 } }, mcpServers: { private: { env: { SECRET: 'hidden' } } } } });
  assert.equal(report.runtime, 'inactive');
  assert.equal(report.disk.scriptEvaluation, true);
  assert.equal(report.ready, false);
  assert.equal(report.keyStatus, 'not_checked');
  assert.equal(report.warnings.some(w => w.includes('maxStateBytes')), true);
  assert.equal(JSON.stringify(report).includes('hidden'), false);
  assert.equal(JSON.stringify(report).includes(root), false);
  assert.equal(JSON.stringify(report).includes('do not emit'), false);
});

test('doctor warns unknown versions and cannot certify loaded runtime Jev settings', () => {
  const report = diagnose({ adapter: { version: '9.0.0', loaded: true }, tools: [{ name: 'mcpScript' }], activeTools: ['mcpScript'], piVersion: '9.0.0', effective: { settings: {}, mcpServers: {} } });
  assert.equal(report.warnings.filter(w => w.includes('Untested')).length, 2);
  assert.equal(report.runtimeJev, 'unknown; reload after disk changes');
  assert.equal(report.ready, false);
});
