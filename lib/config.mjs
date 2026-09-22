import { constants, fstatSync, lstatSync, openSync, closeSync, readSync, writeFileSync, renameSync, mkdirSync, fsyncSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse, parseTree, modify, applyEdits } from 'jsonc-parser';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
export const DEFAULT_JEV = Object.freeze({
  semanticSearch: false, scriptEvaluation: true, allowedServers: [], model: 'jev-1.13.0',
  requestTimeoutMs: 10000, maxRetries: 0, maxStateBytes: 4096, maxQuestionsPerRequest: 3,
  maxEvaluationsPerScript: 1, maxEvaluationBytesPerScript: 16384, maxEvaluationTokensPerScript: 4096,
});
const ranges = {
  requestTimeoutMs: [100, 30000], maxRetries: [0, 2], maxStateBytes: [1, 1048576],
  maxQuestionsPerRequest: [1, 128], maxEvaluationsPerScript: [1, 32],
  maxEvaluationBytesPerScript: [1, 4194304], maxEvaluationTokensPerScript: [1, 1000000],
  semanticCandidateLimit: [2, 127],
};

function validateJev(value) {
  if (value === false || value === undefined) { return; }
  if (!object(value)) { fail('Invalid settings.jev.'); }
  for (const [key, item] of Object.entries(value)) {
    if (['semanticSearch', 'scriptEvaluation'].includes(key)) {
      if (typeof item !== 'boolean') { fail('Invalid Jev boolean.'); }
    } else if (key === 'model') {
      if (item !== 'jev-1.13.0') { fail('Unsupported Jev model.'); }
    } else if (key === 'allowedServers') {
      if (!Array.isArray(item) || item.length > 128 || item.some(name => typeof name !== 'string' || !name.trim() || name.length > 128) || new Set(item).size !== item.length) { fail('Invalid Jev sources.'); }
    } else if (key === 'semanticMinProbability') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) { fail('Invalid Jev probability.'); }
    } else if (Object.hasOwn(ranges, key)) {
      const [min, max] = ranges[key];
      if (!Number.isSafeInteger(item) || item < min || item > max) { fail('Invalid Jev limit.'); }
    } else { fail('Unknown Jev setting; refusing to copy it.'); }
  }
  if (value.scriptEvaluation === true && !Array.isArray(value.allowedServers)) { fail('Script evaluation requires explicit sources.'); }
}

/** Strict JSONC before the adapter's tolerant loader can discard invalid layers. */
export function parseConfig(text) {
  if (Buffer.byteLength(text) > 1048576) { fail('Config too large.'); }
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !object(value)) { fail('Invalid JSONC config.'); }
  const tree = parseTree(text);
  const stack = [tree];
  let count = 0;
  while (stack.length) {
    if (++count > 50000) { fail('Config too complex.'); }
    const node = stack.pop();
    if (node.type === 'object') {
      const names = node.children.map(child => child.children[0].value);
      if (new Set(names).size !== names.length || names.some(name => ['__proto__', 'constructor', 'prototype'].includes(name))) { fail('Ambiguous config keys.'); }
    }
    if (node.children) { stack.push(...node.children); }
  }
  if (value.settings !== undefined && !object(value.settings)) { fail('Invalid settings.'); }
  validateJev(value.settings?.jev);
  const importKinds = ['cursor', 'claude-code', 'claude-desktop', 'codex', 'opencode', 'windsurf', 'vscode'];
  if (value.imports !== undefined && (!Array.isArray(value.imports) || value.imports.some(kind => !importKinds.includes(kind)))) { fail('Invalid imports.'); }
  if (value.claudePlugins !== undefined && (!Array.isArray(value.claudePlugins) || value.claudePlugins.some(entry => !object(entry) || typeof entry.path !== 'string' || !entry.path.trim() || ![entry.mcp, entry.skills].every(flag => flag === undefined || typeof flag === 'boolean')))) { fail('Invalid plugin config.'); }
  for (const key of ['ancestorConfigRoots', 'agentPluginPaths']) {
    const paths = value.settings?.[key];
    if (paths !== undefined && (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path.trim()))) { fail('Invalid discovery paths.'); }
  }
  if (value.settings?.hostConfigDiscovery !== undefined && !['off', 'on', 'prompt'].includes(value.settings.hostConfigDiscovery)) { fail('Invalid host discovery mode.'); }
  if (value.settings?.scriptMode !== undefined && typeof value.settings.scriptMode !== 'boolean') { fail('Invalid script mode.'); }
  for (const key of ['mcpServers', 'mcp-servers']) {
    if (value[key] !== undefined && (!object(value[key]) || Object.values(value[key]).some(entry => !object(entry)))) { fail('Invalid server definitions.'); }
  }
  return value;
}

/** Refuse symlinks in any component, hard-linked files, and non-regular targets. */
export function assertSafePath(path) {
  const absolute = resolve(path);
  let current = absolute;
  for (let depth = 0; depth < 256; depth++) {
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink() || (current === absolute ? (!info.isFile() || info.nlink !== 1) : !info.isDirectory())) { fail('Unsafe config path.'); }
    } catch (error) {
      if (error.code !== 'ENOENT') { throw error; }
    }
    const parent = dirname(current);
    if (parent === current) { return absolute; }
    current = parent;
  }
  fail('Config path too deep.');
}

export function readBounded(path, max = 1048576) {
  assertSafePath(path);
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > max) { fail('Unsafe or oversized config file.'); }
    const buffer = Buffer.alloc(max + 1);
    let count = 0;
    while (count < buffer.length) {
      const bytes = readSync(fd, buffer, count, buffer.length - count, count);
      if (!bytes) { break; }
      count += bytes;
    }
    if (count > max) { fail('File too large.'); }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count));
  } catch (error) {
    if (error.code === 'ENOENT') { return undefined; }
    throw error;
  } finally { if (fd !== undefined) { closeSync(fd); } }
}

function snapshot(path) {
  const text = readBounded(path);
  return { path: resolve(path), text, value: text === undefined ? {} : parseConfig(text) };
}

/** Adapter APIs are synchronous. Warnings indicate a discarded/ambiguous source. */
function strictLoad(operation) {
  const original = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const result = operation();
    if (warned) { fail('Adapter rejected a config source; repair it before continuing.'); }
    return result;
  } catch { fail('Unable to validate adapter configuration; no changes made.'); }
  finally { console.warn = original; }
}

export function inspectConfig({ api, cwd, overridePath }) {
  const paths = strictLoad(() => api.getConfigDiscoveryPaths(overridePath, cwd));
  if (!Array.isArray(paths) || !paths.length || paths.length > 256) { fail('Ambiguous config discovery.'); }
  const snapshots = paths.map(entry => snapshot(entry.path));
  // Public loader also inspects imports/packages/plugins; any warning is fatal, never printed.
  const effective = strictLoad(() => api.loadMcpConfig(overridePath, cwd));
  if (!object(effective) || !object(effective.mcpServers)) { fail('Invalid effective config.'); }
  validateJev(effective.settings?.jev);
  assertUnchanged(snapshots);
  return { effective, snapshots };
}

export function planJev(effective, sources) {
  const existing = effective.settings?.jev;
  validateJev(existing);
  // Absence in an existing object preserves the adapter's credential-dependent policy.
  const { semanticSearch, ...defaults } = DEFAULT_JEV;
  const next = { ...defaults, ...(object(existing) ? existing : { semanticSearch }), scriptEvaluation: true };
  next.allowedServers = [...(sources ?? next.allowedServers)];
  validateJev(next);
  for (const name of next.allowedServers) {
    if (!Object.hasOwn(effective.mcpServers, name) || effective.mcpServers[name].disabled === true || effective.mcpServers[name].enabled === false) { fail('Jev sources must name known enabled servers.'); }
  }
  return next;
}

export function compatibilityWarnings(jev) {
  if (!object(jev)) { return []; }
  return ['maxStateBytes', 'maxQuestionsPerRequest', 'maxEvaluationBytesPerScript'].filter(key => jev[key] !== undefined && jev[key] < DEFAULT_JEV[key]).map(key => `${key} is below helper bounds; some specifications will be rejected.`);
}

function targetFor(options, snapshots) {
  const { scope, api, cwd, overridePath } = options;
  if (!['project', 'global'].includes(scope)) { fail('Explicit project or global scope required.'); }
  const target = resolve(scope === 'project' ? api.getProjectPiConfigPath(cwd) : api.getPiGlobalConfigPath(overridePath));
  const index = snapshots.findIndex(item => item.path === target);
  if (index < 0) { fail('Chosen scope is not an active config target (exclusive mode).'); }
  if (snapshots.slice(index + 1).some(item => Object.hasOwn(item.value.settings ?? {}, 'jev'))) { fail('Chosen Jev scope is shadowed by a higher-precedence config.'); }
  return snapshots[index];
}
const block = value => Object.hasOwn(value.settings ?? {}, 'jev') ? { present: true, value: value.settings.jev } : { present: false };
function assertUnchanged(snapshots) {
  for (const item of snapshots) {
    if (readBounded(item.path) !== item.text) { fail('Config changed concurrently; retry.'); }
  }
}
function atomicWrite(path, before, text, snapshots = []) {
  assertSafePath(path);
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertSafePath(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  // Never overwrite an existing staging path; failed writes remain for manual inspection.
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  assertUnchanged(snapshots);
  if (readBounded(path) !== before) { fail('Config changed concurrently; retry.'); }
  renameSync(temp, path);
}
function patch(text, value) {
  return applyEdits(text ?? '{}\n', modify(text ?? '{}\n', ['settings', 'jev'], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
}
function readRecord(path) {
  const text = readBounded(path);
  if (text === undefined) { return { text }; }
  const value = parseConfig(text);
  if (Object.keys(value).sort().join(',') !== 'expected,previous' || !object(value.previous) || typeof value.previous.present !== 'boolean') { fail('Invalid rollback record.'); }
  if (Object.keys(value.previous).sort().join(',') !== (value.previous.present ? 'present,value' : 'present')) { fail('Invalid rollback record.'); }
  validateJev(value.previous.value);
  validateJev(value.expected);
  if (!object(value.expected)) { fail('Invalid rollback record.'); }
  return { text, value };
}

export function setup(options) {
  if (!['project', 'global'].includes(options.scope)) { fail('Explicit project or global scope required.'); }
  if (!options.enable) { fail('Explicit enable confirmation required.'); }
  const state = inspectConfig(options);
  const target = targetFor(options, state.snapshots);
  const next = planJev(state.effective, options.sources);
  const previous = block(target.value);
  const recordPath = `${target.path}.jev-helper-rollback.json`;
  const record = readRecord(recordPath);
  if (record.value && !isDeepStrictEqual(previous, record.value.previous) && !isDeepStrictEqual(previous, { present: true, value: record.value.expected })) { fail('Jev rollback conflict; preserve the record and reconcile manually.'); }
  if (isDeepStrictEqual(previous, { present: true, value: next })) { return { changed: false, reloadRequired: true, warnings: compatibilityWarnings(next) }; }
  if (record.value && isDeepStrictEqual(previous, { present: true, value: record.value.expected })) { fail('Undo the existing setup before changing its sources.'); }
  const nextRecord = { previous, expected: next };
  // Write-ahead ownership: interruption leaves either previous or expected, both recoverable.
  atomicWrite(recordPath, record.text, `${JSON.stringify(nextRecord, null, 2)}\n`, state.snapshots);
  atomicWrite(target.path, target.text, patch(target.text, next), [...state.snapshots, { path: recordPath, text: `${JSON.stringify(nextRecord, null, 2)}\n` }]);
  return { changed: true, reloadRequired: true, warnings: compatibilityWarnings(next) };
}

export function undo(options) {
  if (!['project', 'global'].includes(options.scope)) { fail('Explicit project or global scope required.'); }
  const state = inspectConfig(options);
  const target = targetFor(options, state.snapshots);
  const recordPath = `${target.path}.jev-helper-rollback.json`;
  const record = readRecord(recordPath);
  if (!record.value) { return { changed: false, reloadRequired: false }; }
  const current = block(target.value);
  if (isDeepStrictEqual(current, record.value.previous)) { return { changed: false, reloadRequired: true }; }
  if (!isDeepStrictEqual(current, { present: true, value: record.value.expected })) { fail('Jev rollback conflict; refusing to overwrite user changes.'); }
  atomicWrite(target.path, target.text, patch(target.text, record.value.previous.present ? record.value.previous.value : undefined), [...state.snapshots, { path: recordPath, text: record.text }]);
  return { changed: true, reloadRequired: true };
}
