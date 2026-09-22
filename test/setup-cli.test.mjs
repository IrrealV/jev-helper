import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../bin/jev-helper.mjs';

function output() { let text = ''; return { write: value => { text += value; }, get text() { return text; } }; }
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'jev-cli-'));
  const target = join(cwd, 'config.json');
  writeFileSync(target, '{"mcpServers":{}}');
  const api = { getConfigDiscoveryPaths: () => [{ path: target }], getProjectPiConfigPath: () => target, getPiGlobalConfigPath: () => target, loadMcpConfig: () => JSON.parse(readFileSync(target, 'utf8')) };
  return { cwd, target, resolveRuntime: async () => ({ api, adapter: { version: '2.36.0', loaded: false }, piVersion: '0.86.1' }) };
}

test('CLI setup requires scope and enable; setup/doctor/undo work offline with injected adapter boundary', async () => {
  const f = fixture(); const stdout = output(); const stderr = output();
  for (const args of [['setup'], ['setup', 'project'], ['setup', '--enable'], ['undo'], ['setup', 'project', '--enable', '--unknown']]) {
    assert.equal(await main(args, { ...f, stdout, stderr }), 1);
  }
  assert.equal(readFileSync(f.target, 'utf8'), '{"mcpServers":{}}');
  assert.equal(await main(['setup', 'project', '--enable'], { ...f, stdout, stderr }), 0);
  assert.equal(JSON.parse(readFileSync(f.target, 'utf8')).settings.jev.scriptEvaluation, true);
  const doctorOut = output();
  assert.equal(await main(['doctor'], { ...f, stdout: doctorOut, stderr }), 0);
  assert.equal(JSON.parse(doctorOut.text).runtime, 'not_loaded');
  assert.equal(await main(['undo', 'project'], { ...f, stdout, stderr }), 0);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(f.target, 'utf8')).settings, 'jev'), false);
});

test('CLI masks OS and adapter errors and passes explicit root/config options', async () => {
  const stdout = output(); const stderr = output();
  let received;
  const code = await main(['doctor', '--adapter-root', '/explicit', '--mcp-config', '/config'], {
    stdout, stderr, resolveRuntime: async options => { received = options; throw Error('secret value /private/path'); },
  });
  assert.equal(code, 1);
  assert.equal(received.explicitRoot, '/explicit');
  assert.equal(received.overridePath, '/config');
  assert.equal(stderr.text.includes('secret'), false);
  assert.equal(stdout.text, '');
});
