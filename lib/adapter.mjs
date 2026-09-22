import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readBounded } from './config.mjs';

const NAME = 'pi-mcp-adapter';
function manifestAt(root) {
  const text = readBounded(join(root, 'package.json'), 65536);
  if (text === undefined) { return undefined; }
  const manifest = JSON.parse(text);
  return manifest.name === NAME ? { root, manifest, version: /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version) ? manifest.version : 'unknown' } : undefined;
}
function ancestorPackage(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) { return undefined; }
  let directory = dirname(path);
  for (let index = 0; index < 12; index++) {
    const found = manifestAt(directory);
    if (found) { return found; }
    const parent = dirname(directory);
    if (parent === directory) { break; }
    directory = parent;
  }
  return undefined;
}

/** Only metadata identifies the loaded instance. A conventional install is not activation. */
export function discoverAdapter({ tools = [], commands = [], cwd, agentDir, configDirName, explicitRoot }) {
  const loaded = new Map();
  // Skill/prompt provenance identifies resources, not a loaded extension factory.
  const extensionCommands = commands.filter(command => command.source === 'extension');
  for (const entry of [...tools, ...extensionCommands]) {
    const found = ancestorPackage(entry.sourceInfo?.path);
    if (found) {
      // SDK/wrapper factories may carry hidden programmatic config; never infer disk authority.
      if (entry.sourceInfo.source === 'sdk' || resolve(entry.sourceInfo.path) !== join(found.root, 'index.ts')) { throw Error('Programmatic adapter provenance is unsupported.'); }
      loaded.set(found.root, found);
    } else if (entry.name === 'mcpScript') { throw Error('Unknown mcpScript provenance; cannot determine adapter config.'); }
  }
  if (loaded.size > 1) { throw Error('Ambiguous loaded adapters.'); }
  const current = [...loaded.values()][0];
  if (current) {
    if (explicitRoot && resolve(explicitRoot) !== current.root) { throw Error('Explicit adapter root conflicts with loaded provenance.'); }
    return { ...current, loaded: true };
  }
  if (explicitRoot) {
    const found = manifestAt(resolve(cwd, explicitRoot));
    if (!found) { throw Error('Explicit root is not pi-mcp-adapter.'); }
    return { ...found, loaded: false };
  }
  if (!agentDir || !configDirName) { throw Error('Pi config helpers unavailable; provide --adapter-root for a known installation.'); }
  const found = [join(cwd, configDirName, 'npm/node_modules', NAME), join(agentDir, 'npm/node_modules', NAME)].map(manifestAt).filter(Boolean);
  if (found.length > 1) { throw Error('Ambiguous installed adapters; select --adapter-root or use the loaded Pi command.'); }
  if (!found.length) { throw Error('Adapter not found. Check pi list and pi config before installing a duplicate.'); }
  return { ...found[0], loaded: false };
}

/** Resolve the installed package's public export; never import its extension/transport. */
export async function loadAdapterConfig(adapter) {
  const require = createRequire(join(adapter.root, 'package.json'));
  const path = require.resolve(`${NAME}/config`);
  const inside = relative(adapter.root, path);
  if (inside.startsWith('..') || isAbsolute(inside)) { throw Error('Config export escaped the adapter installation.'); }
  return import(pathToFileURL(path).href);
}

export function configOverride(argv, flag, cwd) {
  const values = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--mcp-config') { values.push(argv[++index]); }
    else if (argv[index].startsWith('--mcp-config=')) { values.push(argv[index].slice(13)); }
  }
  if (values.length > 1) { throw Error('Ambiguous --mcp-config.'); }
  const literal = value => typeof value === 'string' && value.trim() && !/[\x00-\x1f$~]/.test(value) && !value.startsWith('!') && !value.startsWith('--');
  if (values.some(value => !literal(value)) || (flag !== undefined && flag !== false && !literal(flag))) { throw Error('Use one literal --mcp-config path without environment expansion.'); }
  if (values.length && flag && resolve(cwd, values[0]) !== resolve(cwd, flag)) { throw Error('Ambiguous adapter config override.'); }
  const selected = values[0] ?? (flag || undefined);
  return selected === undefined ? undefined : resolve(cwd, selected);
}
