import { prepareEvaluation, validateResponse } from './validation.mjs';
import { evaluatePrepared, fallback } from './runtime.mjs';

/** Robust Node API; buildScript performs the same preparation before serialization. */
export async function runEvaluation(request, jev) {
  let prepared;
  try { prepared = prepareEvaluation(request); }
  catch { return fallback('invalid_request'); }
  return evaluatePrepared(prepared, jev, validateResponse);
}
