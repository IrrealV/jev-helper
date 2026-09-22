import { preparePrioritization } from './validation.mjs';
import { prioritizePrepared, fallback } from './runtime.mjs';
import { runEvaluation } from './decisions.mjs';

/** Fetch only the selected MCP tool; an optional evaluator retains the helper request API. */
export async function runPrioritization(spec, tools, jev, evaluate = runEvaluation) {
  let prepared;
  try { prepared = preparePrioritization(spec); }
  catch { return fallback('invalid_request'); }
  return prioritizePrepared(prepared, tools, jev, evaluate);
}
