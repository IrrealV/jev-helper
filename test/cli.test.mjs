import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import vm from 'node:vm';
import { main } from '../bin/jev-helper.mjs';

function offlineFile(text, { size = Buffer.byteLength(text), regular = true } = {}) {
  const bytes = Buffer.from(text);
  const output = { stdout: '', stderr: '', closed: false, readBytes: 0, paths: [] };
  return {
    output,
    io: {
      stdout: { write: value => { output.stdout += value; } },
      stderr: { write: value => { output.stderr += value; } },
      openFile: async path => {
        output.paths.push(path);
        return {
          stat: async () => ({ size, isFile: () => regular }),
          read: async (buffer, offset, length, position) => {
            const count = bytes.copy(buffer, offset, position, position + length);
            output.readBytes += count;
            return { bytesRead: count };
          },
          close: async () => { output.closed = true; },
        };
      },
    },
  };
}

test('CLI help and version work as executable Node entry points', () => {
  for (const [args, expected] of [[['--help'], /script <spec.json>/], [['--version'], /^0\.1\.0\n$/]]) {
    const result = spawnSync(process.execPath, ['bin/jev-helper.mjs', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, expected);
    assert.equal(result.stderr, '');
  }
});

test('CLI runs when Node enters through a symlink like an installed npm bin', { skip: process.platform !== 'linux' }, () => {
  // procfs provides a symlink to this exact file without writing a test fixture.
  const descriptor = openSync('bin/jev-helper.mjs', 'r');
  try {
    const result = spawnSync(process.execPath, ['/proc/self/fd/3', '--version'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe', descriptor] });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '0.1.0\n');
    assert.equal(result.stderr, '');
  } finally {
    closeSync(descriptor);
  }
});

test('CLI reads only the named bounded file and outputs executable script without running it', async () => {
  const input = { mode: 'evaluate', request: { state: 'offline', questions: { q: { type: 'noul', instructions: 'Supported?' } }, sources: [] } };
  const fake = offlineFile(JSON.stringify(input));
  assert.equal(await main(['script', 'chosen.json'], fake.io), 0);
  assert.deepEqual(fake.output.paths, ['chosen.json']);
  assert.equal(fake.output.closed, true);
  assert.equal(fake.output.stderr, '');
  const emitted = [];
  await vm.runInNewContext(`(async () => { ${fake.output.stdout} })()`, { jev: { evaluate: async () => ({ ok: false, error: { code: 'disabled' } }) }, emit: result => emitted.push(result) });
  assert.equal(emitted[0].code, 'disabled');
});

test('CLI rejects excessive file size, post-stat growth, directories, malformed JSON and excess arguments', async () => {
  for (const fake of [
    offlineFile('PRIVATE', { size: 32769 }),
    offlineFile('x'.repeat(32770), { size: 1 }),
    offlineFile('{}', { regular: false }),
    offlineFile('PRIVATE MALFORMED JSON'),
  ]) {
    assert.equal(await main(['script', 'chosen.json'], fake.io), 1);
    assert.equal(fake.output.stdout, '');
    assert.equal(fake.output.stderr, 'Unable to build script: use a regular UTF-8 JSON specification of at most 32768 bytes.\n');
    assert.equal(fake.output.closed, true);
    assert.ok(fake.output.readBytes <= 32769);
  }
  const fake = offlineFile('{}');
  assert.equal(await main(['script', 'a', 'b'], fake.io), 1);
  assert.equal(fake.output.paths.length, 0);
});

test('CLI masks file errors and malformed UTF-8 without echoing source content', async () => {
  const fake = offlineFile('{}');
  fake.io.openFile = async () => { throw Error('PRIVATE PATH'); };
  assert.equal(await main(['script', 'chosen.json'], fake.io), 1);
  assert.equal(fake.output.stderr.includes('PRIVATE'), false);
  const bad = offlineFile('');
  bad.io.openFile = async () => ({
    stat: async () => ({ size: 1, isFile: () => true }),
    read: async (buffer, offset, length, position) => { if (position > 0) { return { bytesRead: 0 }; } buffer[offset] = 0xff; return { bytesRead: 1 }; },
    close: async () => {},
  });
  assert.equal(await main(['script', 'chosen.json'], bad.io), 1);
});
