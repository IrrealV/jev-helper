import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import extension from '../extensions/jev-helper.ts';

const skillFile = fileURLToPath(new URL('../skills/jev-decisions/SKILL.md', import.meta.url));

function host() {
  const commands = new Map(); const messages = []; const sentOptions = []; const notices = [];
  const cwd = mkdtempSync(join(tmpdir(), 'jev-extension-'));
  const pi = {
    registerCommand: (name, command) => commands.set(name, command),
    getAllTools: () => [], getCommands: () => [], getActiveTools: () => [], getFlag: () => undefined,
    sendUserMessage: (message, options) => { messages.push(message); sentOptions.push(options); },
  };
  const ctx = { cwd, hasUI: true, isIdle: () => true, isProjectTrusted: () => true, ui: { notify: message => notices.push(message), confirm: async () => false } };
  return { pi, ctx, commands, messages, sentOptions, notices, cwd };
}

function configureRun(h) {
  const root = join(h.cwd, 'adapter');
  mkdirSync(root);
  writeFileSync(join(root, 'package.json'), '{"name":"pi-mcp-adapter","version":"2.36.0","type":"module","exports":{"./config":"./config.mjs"}}');
  const target = join(h.cwd, 'mcp.json');
  writeFileSync(target, '{"settings":{"jev":{"scriptEvaluation":true,"allowedServers":[]}},"mcpServers":{}}');
  writeFileSync(join(root, 'config.mjs'), `export const getConfigDiscoveryPaths = () => [{path:${JSON.stringify(target)}}]; export const loadMcpConfig = () => (${JSON.stringify({ settings: { jev: { scriptEvaluation: true, allowedServers: [] } }, mcpServers: {} })});`);
  h.pi.getAllTools = () => [{ name: 'mcpScript', sourceInfo: { path: join(root, 'index.ts'), source: 'npm:pi-mcp-adapter', scope: 'user', origin: 'package' } }];
  h.pi.getActiveTools = () => ['mcpScript'];
  const spec = join(h.cwd, 'spec.json');
  writeFileSync(spec, JSON.stringify({ mode: 'evaluate', request: { state: { evidence: 'synthetic only' }, sources: [], questions: { next: { type: 'noul', instructions: 'Does the supplied evidence support the claim?' } } } }));
  return spec;
}

function plantFile(target, contents = 'fixture') {
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

const SKILL_COMMAND = { name: 'skill:jev-decisions', source: 'skill', sourceInfo: { path: skillFile } };
const FOREIGN_COMMAND = { name: 'skill:jev-decisions', source: 'skill', sourceInfo: { path: '/opt/other/skills/jev-decisions/SKILL.md' } };

test('extension registers only four commands; installation does not call tools or send context', () => {
  const h = host();
  extension(h.pi);
  assert.deepEqual([...h.commands.keys()].sort(), ['jev-doctor', 'jev-run', 'jev-setup', 'jev-undo']);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.notices, []);
});

test('run refuses inactive tools without reading the specification or enabling anything', async () => {
  const h = host(); extension(h.pi);
  await h.commands.get('jev-run').handler('does-not-exist.json', h.ctx);
  assert.equal(h.messages.length, 0);
  assert.match(h.notices[0], /mcpScript.*unavailable/);
});

test('setup needs explicit scope and UI confirmation; cancellation never resolves configuration', async () => {
  const h = host();
  extension(h.pi, async () => { throw Error('must not resolve'); });
  await h.commands.get('jev-setup').handler('', h.ctx);
  await h.commands.get('jev-setup').handler('project', h.ctx);
  assert.equal(h.messages.length, 0);
  assert.equal(h.notices.some(text => text.includes('must not resolve')), false);
});

test('run sends only a validated script request on explicit command, through the existing tool', async () => {
  const h = host();
  const spec = configureRun(h);
  extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));
  await h.commands.get('jev-run').handler('spec.json', h.ctx);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0], /mcpScript/);
  assert.match(h.messages[0], /jev.evaluate/);
  assert.match(h.messages[0], /untrusted/);
  assert.equal(h.messages[0].startsWith('/skill:'), false);
  assert.equal(h.sentOptions[0]?.expandPromptTemplates === true, false);
  assert.equal(h.messages[0].includes(h.cwd), false);
  assert.equal(h.messages[0].includes(spec), false);
});

test('run expands the discovered jev-decisions skill for complete prepared code only', async () => {
  const h = host();
  const spec = configureRun(h);
  h.pi.getCommands = () => [SKILL_COMMAND, { name: 'skill:other', source: 'skill', sourceInfo: { path: '/opt/other/SKILL.md' } }];
  extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));
  await h.commands.get('jev-run').handler('spec.json', h.ctx);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].startsWith('/skill:jev-decisions '), true);
  assert.equal(h.sentOptions[0]?.expandPromptTemplates, true);
  assert.match(h.messages[0], /complete/i);
  assert.match(h.messages[0], /prepared/i);
  assert.match(h.messages[0], /mcpScript/);
  assert.match(h.messages[0], /jev\.evaluate/);
  assert.match(h.messages[0], /untrusted/);
  assert.equal(h.messages[0].includes(h.cwd), false);
  assert.equal(h.messages[0].includes(spec), false);
  assert.match(h.messages[0], /do not\s+re-read|skip optional/i);
});

for (const [label, commands] of [
  ['absent', []],
  ['only an extension command', [{ name: 'jev-decisions', source: 'extension', sourceInfo: { path: '/opt/jev-decisions.ts' } }]],
  ['a differently named skill', [{ name: 'skill:other', source: 'skill', sourceInfo: { path: '/opt/other/SKILL.md' } }]],
]) {
  test(`run falls back to a plain guarded prepared request when the skill is ${label}`, async () => {
    const h = host();
    configureRun(h);
    h.pi.getCommands = () => commands;
    extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));
    await h.commands.get('jev-run').handler('spec.json', h.ctx);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].startsWith('/skill:'), false);
    assert.equal(h.sentOptions[0]?.expandPromptTemplates === true, false);
    assert.match(h.messages[0], /mcpScript/);
    assert.match(h.messages[0], /jev\.evaluate/);
    assert.match(h.messages[0], /untrusted/);
  });
}

test('run rejects a foreign package skill that only shares the directory suffix', async () => {
  const h = host();
  configureRun(h);
  const foreign = plantFile(join(h.cwd, 'foreign', 'skills', 'jev-decisions', 'SKILL.md'));
  h.pi.getCommands = () => [{ ...FOREIGN_COMMAND, sourceInfo: { path: foreign } }];
  extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));
  await h.commands.get('jev-run').handler('spec.json', h.ctx);
  assert.equal(h.messages[0].startsWith('/skill:'), false);
  assert.equal(h.sentOptions[0]?.expandPromptTemplates === true, false);
});

test('run rejects a misleading not-skills suffix that is not this package', async () => {
  const h = host();
  configureRun(h);
  const misleading = plantFile(join(h.cwd, 'not-skills', 'jev-decisions', 'SKILL.md'));
  h.pi.getCommands = () => [{ ...FOREIGN_COMMAND, sourceInfo: { path: misleading } }];
  extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));
  await h.commands.get('jev-run').handler('spec.json', h.ctx);
  assert.equal(h.messages[0].startsWith('/skill:'), false);
  assert.equal(h.sentOptions[0]?.expandPromptTemplates === true, false);
});

for (const [label, build] of [
  ['two same-name foreign entries', h => [
    { ...FOREIGN_COMMAND, sourceInfo: { path: plantFile(join(h.cwd, 'a', 'skills', 'jev-decisions', 'SKILL.md')) } },
    { ...FOREIGN_COMMAND, sourceInfo: { path: plantFile(join(h.cwd, 'b', 'skills', 'jev-decisions', 'SKILL.md')) } },
  ]],
  ['the genuine entry plus a foreign duplicate', h => [
    SKILL_COMMAND,
    { ...FOREIGN_COMMAND, sourceInfo: { path: plantFile(join(h.cwd, 'a', 'skills', 'jev-decisions', 'SKILL.md')) } },
  ]],
]) {
  test(`run fails closed on ${label}`, async () => {
    const h = host();
    configureRun(h);
    h.pi.getCommands = () => build(h);
    extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));
    await h.commands.get('jev-run').handler('spec.json', h.ctx);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].startsWith('/skill:'), false);
    assert.equal(h.sentOptions[0]?.expandPromptTemplates === true, false);
  });
}

test('run expands a symlink that resolves to this package skill', async () => {
  const h = host();
  configureRun(h);
  const link = join(h.cwd, 'skill-link.md');
  symlinkSync(skillFile, link);
  h.pi.getCommands = () => [{ ...SKILL_COMMAND, sourceInfo: { path: link } }];
  extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));
  await h.commands.get('jev-run').handler('spec.json', h.ctx);
  assert.equal(h.messages[0].startsWith('/skill:jev-decisions '), true);
  assert.equal(h.sentOptions[0]?.expandPromptTemplates, true);
});

test('doctor and confirmed setup accept a standard adapter alongside its skills and prompts', async () => {
  const h = host();
  const { mkdirSync, readFileSync } = await import('node:fs');
  const root = join(h.cwd, 'adapter');
  mkdirSync(root);
  writeFileSync(join(root, 'package.json'), '{"name":"pi-mcp-adapter","version":"2.36.0","type":"module","exports":{"./config":"./config.mjs"}}');
  const target = join(h.cwd, 'mcp.json');
  writeFileSync(target, '{"settings":{"jev":{"maxRetries":1}},"mcpServers":{}}');
  writeFileSync(join(root, 'config.mjs'), `import { readFileSync } from 'node:fs';
    const target = ${JSON.stringify(target)};
    export const getConfigDiscoveryPaths = () => [{path:target}];
    export const getPiGlobalConfigPath = () => target;
    export const loadMcpConfig = () => JSON.parse(readFileSync(target, 'utf8'));`);
  const sourceInfo = { path: join(root, 'index.ts'), source: 'npm:pi-mcp-adapter@2.36.0', scope: 'user', origin: 'package', baseDir: root };
  h.pi.getAllTools = () => [{ name: 'mcp', sourceInfo }, { name: 'mcpScript', sourceInfo }];
  h.pi.getCommands = () => [
    { name: 'mcp', source: 'extension', sourceInfo },
    { name: 'skill:mcp-scripting', source: 'skill', sourceInfo: { ...sourceInfo, path: join(root, 'skills/mcp-scripting/SKILL.md') } },
    { name: 'mcp-example', source: 'prompt', sourceInfo: { ...sourceInfo, path: join(root, 'prompts/mcp-example.md') } },
  ];
  h.pi.getActiveTools = () => ['mcp', 'mcpScript'];
  h.ctx.ui.confirm = async () => true;
  extension(h.pi, async () => ({ getAgentDir: () => h.cwd, CONFIG_DIR_NAME: '.pi', VERSION: '0.86.1' }));

  await h.commands.get('jev-doctor').handler('', h.ctx);
  assert.equal(h.notices.length, 1);
  const report = JSON.parse(h.notices[0]);
  assert.equal(report.adapterLoaded, true);
  assert.equal(report.runtime, 'active');
  assert.equal(report.disk.semanticSearch, 'adapter credential-dependent default');
  await h.commands.get('jev-setup').handler('global', h.ctx);
  const jev = JSON.parse(readFileSync(target, 'utf8')).settings.jev;
  assert.equal(jev.scriptEvaluation, true);
  assert.equal(jev.maxRetries, 1);
  assert.equal(Object.hasOwn(jev, 'semanticSearch'), false);
  assert.equal(h.messages.length, 0);
});

test('package resources and examples are discoverable without bundling adapter or Pi', async () => {
  const { readFile } = await import('node:fs/promises');
  const { buildScript } = await import('../lib/script.mjs');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageJson.pi, { extensions: ['extensions/jev-helper.ts'], skills: ['skills/jev-decisions'] });
  assert.deepEqual(packageJson.dependencies, { 'jsonc-parser': '3.3.1' });
  assert.equal(packageJson.peerDependenciesMeta['@earendil-works/pi-coding-agent'].optional, true);
  for (const name of ['evaluate', 'prioritize']) {
    const spec = JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
    assert.match(buildScript(spec), /emit/);
  }
  const skill = await readFile(new URL('../skills/jev-decisions/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /^---\nname: jev-decisions\ndescription: "/);
  assert.equal(skill.includes('disable-model-invocation: true'), false);
});
