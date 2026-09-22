import { copyJson, prepareEvaluation, preparePrioritization } from './validation.mjs';
import { fallback, evaluatePrepared, prioritizePrepared, choiceQuestion, utf8Bytes } from './runtime.mjs';

/** Validate caller data locally. Serialize only shared runtime/domain logic;
 * the installed adapter remains responsible for its typed wire boundary.
 */
export function buildScript(spec) {
  try {
    const input = copyJson(spec, 32768);
    if (!input || !['evaluate', 'prioritize'].includes(input.mode)) { throw Error('Invalid mode'); }
    const isEvaluation = input.mode === 'evaluate';
    const prepared = isEvaluation ? prepareEvaluation(input.request) : preparePrioritization(input);
    const literal = JSON.stringify(JSON.stringify(prepared))
      .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const functions = isEvaluation ? [fallback, evaluatePrepared] : [fallback, evaluatePrepared, utf8Bytes, choiceQuestion, prioritizePrepared];
    const definitions = functions.map(fn => fn.toString()).join('\n');
    const action = isEvaluation ? 'evaluatePrepared(input, jev)'
      : 'prioritizePrepared(input, tools, jev, (request, jev) => evaluatePrepared({ request: { ...request, questions: { next: choiceQuestion(request.questions.next) } } }, jev))';
    return `await (async () => {\n${definitions}\nconst input = JSON.parse(${literal});\nemit(await ${action});\n})()\n`;
  } catch {
    throw new Error('Invalid script specification.');
  }
}
