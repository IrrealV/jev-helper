import { compatibilityWarnings } from './config.mjs';

/** Pure, whitelisted metadata projection: no paths, server definitions, or credential values. */
export function diagnose({ adapter, tools = [], activeTools = [], piVersion = 'unknown', effective }) {
  const jev = effective.settings?.jev;
  const registered = tools.some(tool => tool.name === 'mcpScript');
  const runtime = !adapter.loaded ? 'not_loaded' : !registered ? 'not_registered' : activeTools.includes('mcpScript') ? 'active' : 'inactive';
  const warnings = compatibilityWarnings(jev);
  if (adapter.version !== '2.36.0') { warnings.push('Untested adapter version; only 2.36.0 is verified.'); }
  if (piVersion !== '0.86.1') { warnings.push('Untested Pi version; only 0.86.1 is verified.'); }
  if (runtime !== 'active') { warnings.push('mcpScript is unavailable to this agent. Respect restrictions; use an authorized parent session. Do not enable tools automatically.'); }
  if (jev?.scriptEvaluation !== true) { warnings.push('Script evaluation is disabled on disk. Explicit scoped setup is required.'); }
  if (effective.settings?.scriptMode === false) { warnings.push('Adapter scriptMode is disabled; helper does not change it.'); }
  return {
    helperVersion: '0.1.0', adapterVersion: adapter.version, piVersion,
    adapterLoaded: adapter.loaded, runtime, runtimeJev: 'unknown; reload after disk changes',
    ready: false, keyStatus: 'not_checked',
    disk: {
      scriptMode: effective.settings?.scriptMode !== false,
      scriptEvaluation: jev?.scriptEvaluation === true,
      semanticSearch: jev === false ? false : jev?.semanticSearch ?? 'adapter credential-dependent default',
      sourceCount: Array.isArray(jev?.allowedServers) ? jev.allowedServers.length : 0,
      limits: Object.fromEntries(['requestTimeoutMs', 'maxRetries', 'maxStateBytes', 'maxQuestionsPerRequest', 'maxEvaluationsPerScript', 'maxEvaluationBytesPerScript', 'maxEvaluationTokensPerScript'].filter(key => jev?.[key] !== undefined).map(key => [key, jev[key]])),
    },
    warnings,
    next: 'Use pi list / pi config before installing anything. Reload after setup; use a new session for skill discovery. Check keys only with adapter key status typesafe in your terminal. No network or inference was performed.',
  };
}
