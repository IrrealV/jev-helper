#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { constants, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildScript } from '../lib/script.mjs';
import { resolve } from 'node:path';
import { discoverAdapter, loadAdapterConfig, configOverride } from '../lib/adapter.mjs';
import { inspectConfig, setup, undo } from '../lib/config.mjs';
import { diagnose } from '../lib/doctor.mjs';

const HELP = `jev-helper 0.1.0
Usage: jev-helper script <spec.json>
       jev-helper doctor [--adapter-root PATH] [--mcp-config PATH]
       jev-helper setup project|global --enable [--sources name,name] [--adapter-root PATH] [--mcp-config PATH]
       jev-helper undo project|global [--adapter-root PATH] [--mcp-config PATH]
       jev-helper --help
       jev-helper --version

Builds JavaScript for the adapter's mcpScript tool. Does not execute it.
The specification must be a regular UTF-8 JSON file of at most 32768 bytes.
Modes: evaluate ({ mode, request }) or prioritize ({ mode, tool, resultPath,
fields, task, mandatoryIds, limits? }). Adapter installation is separate.
`;

/** Injectable I/O keeps file-limit tests offline without creating fixture files. */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr, openFile = open, cwd = process.cwd(), resolveRuntime = resolveCliRuntime } = {}) {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0]))) {
    stdout.write(HELP);
    return 0;
  }
  if (argv.length === 1 && ['--version', '-v', 'version'].includes(argv[0])) {
    stdout.write('0.1.0\n');
    return 0;
  }
  if (['setup', 'doctor', 'undo'].includes(argv[0])) {
    try {
      const options = parseOptions(argv, cwd);
      const runtime = await resolveRuntime(options);
      const input = { ...options, ...runtime };
      const result = argv[0] === 'setup' ? setup(input) : argv[0] === 'undo' ? undo(input)
        : diagnose({ ...runtime, effective: inspectConfig(input).effective });
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch {
      stderr.write('Unable to complete scoped configuration command. Check explicit scope/--enable, adapter root, config validity, shadowing and rollback conflicts. No credentials or raw config are printed.\n');
      return 1;
    }
  }
  if (argv.length !== 2 || argv[0] !== 'script' || !argv[1]) {
    stderr.write('Usage: jev-helper script <spec.json> | --help | --version\n');
    return 1;
  }
  try {
    stdout.write(await readScript(argv[1], openFile));
    return 0;
  } catch {
    stderr.write('Unable to build script: use a regular UTF-8 JSON specification of at most 32768 bytes.\n');
    return 1;
  }
}

export async function readScript(path, openFile = open) {
  let handle;
  try {
    // Nonblocking open avoids hanging on a named pipe before the regular-file check.
    handle = await openFile(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 32768) { throw Error('Invalid file'); }
    const buffer = Buffer.alloc(32769);
    let position = 0;
    while (position < buffer.length) {
      const { bytesRead } = await handle.read(buffer, position, buffer.length - position, position);
      if (bytesRead === 0) { break; }
      position += bytesRead;
    }
    if (position > 32768) { throw Error('File too large'); }
    const json = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, position));
    const script = buildScript(JSON.parse(json));
    await handle.close();
    handle = undefined;
    return script;
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* A failed close must not expose a path or raw OS error. */ }
    }
  }
}

export function parseOptions(argv, cwd) {
  const [command, ...rest] = argv;
  const options = { cwd };
  if (command !== 'doctor') {
    options.scope = rest.shift();
    if (!['project', 'global'].includes(options.scope)) { throw Error('Explicit scope required.'); }
  }
  const seen = new Set();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (seen.has(flag)) { throw Error('Duplicate option.'); }
    seen.add(flag);
    if (flag === '--enable' && command === 'setup') { options.enable = true; continue; }
    if (!['--adapter-root', '--mcp-config', ...(command === 'setup' ? ['--sources'] : [])].includes(flag)) { throw Error('Unknown option.'); }
    const value = rest[++index];
    if (!value || value.startsWith('--')) { throw Error('Missing option value.'); }
    if (flag === '--sources') { options.sources = value === '[]' ? [] : value.split(','); }
    if (flag === '--adapter-root') { options.explicitRoot = resolve(cwd, value); }
    if (flag === '--mcp-config') { options.overridePath = configOverride(['--mcp-config', value], undefined, cwd); }
  }
  if (command === 'setup' && !options.enable) { throw Error('Explicit --enable required.'); }
  return options;
}

async function resolveCliRuntime(options) {
  let helpers = {};
  try {
    const pi = await import('@earendil-works/pi-coding-agent');
    helpers = { agentDir: pi.getAgentDir(), configDirName: pi.CONFIG_DIR_NAME, piVersion: pi.VERSION };
  } catch {
    if (!options.explicitRoot) { throw Error('Provide --adapter-root when the optional Pi peer cannot be resolved by Node.'); }
  }
  const adapter = discoverAdapter({ ...options, ...helpers });
  return { adapter, api: await loadAdapterConfig(adapter), piVersion: helpers.piVersion ?? 'unknown' };
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
