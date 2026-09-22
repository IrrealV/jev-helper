import { utf8Bytes, toWire } from './runtime.mjs';

const fail = () => { throw Error('Invalid JSON contract'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const safeKey = key => nonempty(key) && !['__proto__', 'prototype', 'constructor'].includes(key);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Local-only JSON snapshot: never execute getters or serialization hooks. */
export function copyJson(value, limit) {
  const ancestors = new Set();
  let nodes = 0;
  let stringBytes = 0;
  function copy(item, depth) {
    if (++nodes > limit || depth > 64) { fail(); }
    if (item === null || typeof item === 'boolean') { return item; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) { fail(); }
      return item;
    }
    if (typeof item === 'string') {
      if (item.length > limit || (stringBytes += utf8Bytes(item)) > limit) { fail(); }
      return item;
    }
    if (typeof item !== 'object' || ancestors.has(item)) { fail(); }
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== null) {
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
      if (!constructor || typeof constructor.value !== 'function' ||
          Object.getOwnPropertyDescriptor(constructor.value, 'prototype')?.value !== prototype ||
          Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) { fail(); }
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length > limit || (array && (item.length > limit || keys.length !== item.length + 1))) { fail(); }
    const result = array ? [] : Object.create(null);
    ancestors.add(item);
    for (const key of keys) {
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) { fail(); }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) { fail(); }
      if (array && key === 'length') { continue; }
      if (!descriptor.enumerable || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) { fail(); }
      stringBytes += utf8Bytes(key);
      if (stringBytes > limit) { fail(); }
      result[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
    return result;
  }
  const json = JSON.stringify(copy(value, 0));
  if (utf8Bytes(json) > limit) { fail(); }
  return JSON.parse(json);
}

/** Validate helper syntax once, then produce the adapter's criteria-only wire syntax. */
export function prepareEvaluation(request) {
  const input = copyJson(request, 16384);
  if (!exactKeys(input, ['state', 'questions', 'sources']) || !Array.isArray(input.sources) ||
      !input.sources.every(nonempty) || new Set(input.sources).size !== input.sources.length ||
      !record(input.questions) || utf8Bytes(JSON.stringify(input.state)) > 4096) { fail(); }
  const questionIds = Object.keys(input.questions);
  if (questionIds.length < 1 || questionIds.length > 3) { fail(); }
  for (const id of questionIds) {
    const question = input.questions[id];
    if (!nonempty(id) || !record(question) || !nonempty(question.instructions)) { fail(); }
    if (question.type === 'noul') {
      if (!Object.keys(question).every(key => ['type', 'instructions', 'true', 'false'].includes(key))) { fail(); }
      for (const key of ['true', 'false']) {
        if (Object.hasOwn(question, key) && !nonempty(question[key])) { fail(); }
      }
    } else if (question.type === 'choice') {
      if (!exactKeys(question, ['type', 'instructions', 'options']) || !record(question.options)) { fail(); }
      const options = Object.entries(question.options);
      if (options.length < 2 || options.length > 128 || options.some(([key, value]) => !nonempty(key) || !nonempty(value))) { fail(); }
    } else if (question.type === 'score') {
      if (!exactKeys(question, ['type', 'instructions', 'levels']) || !Array.isArray(question.levels) ||
          question.levels.length < 2 || question.levels.length > 10 || !question.levels.every(nonempty)) { fail(); }
    } else { fail(); }
  }
  const prepared = toWire(input);
  if (utf8Bytes(JSON.stringify(prepared.request)) > 16384) { fail(); }
  return prepared;
}

/** Node API defense in depth; generated scripts rely on the official adapter validator. */
export function validateResponse(response, request) {
  const result = copyJson(response, 65536);
  if (result?.ok === false) { return result; }
  if (!exactKeys(result, ['ok', 'data']) || result.ok !== true || !exactKeys(result.data, ['model', 'answers', 'usage'])) { fail(); }
  const { model, answers, usage } = result.data;
  const questionIds = Object.keys(request.questions);
  if (!nonempty(model) || !exactKeys(answers, questionIds) || !exactKeys(usage, ['inputTokens', 'outputTokens']) ||
      !Object.values(usage).every(value => Number.isSafeInteger(value) && value >= 0)) { fail(); }
  for (const id of questionIds) {
    const question = request.questions[id];
    const answer = answers[id];
    if (!record(answer) || answer.type !== question.type) { fail(); }
    if (question.type === 'noul') {
      if (!exactKeys(answer, ['type', 'noul']) || !probability(answer.noul)) { fail(); }
      continue;
    }
    const field = question.type === 'choice' ? 'choice' : 'score';
    const labels = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index));
    if (!exactKeys(answer, ['type', field, 'confidence', 'probabilities']) || !probability(answer.confidence) ||
        !exactKeys(answer.probabilities, labels) || !Object.values(answer.probabilities).every(probability) ||
        Math.abs(Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0) - 1) > 1e-6) { fail(); }
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !labels.includes(answer.choice)) { fail(); }
    } else if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > question.criteria.length - 1) { fail(); }
  }
  return result;
}

export function preparePrioritization(spec) {
  const input = copyJson(spec, 16384);
  const text = (value, max) => nonempty(value) && utf8Bytes(value) <= max;
  if (!record(input) || input.mode !== 'prioritize' || !record(input.tool) ||
      !text(input.tool.path, 256) || !text(input.tool.server, 128) || !record(input.tool.args) ||
      !Array.isArray(input.resultPath) || input.resultPath[0] !== 'data' || input.resultPath.length > 16 || !input.resultPath.every(safeKey) ||
      !record(input.fields) || !['id', 'text', 'reference'].every(key => safeKey(input.fields[key])) ||
      !text(input.task, 512) || !Array.isArray(input.mandatoryIds) || !input.mandatoryIds.every(id => text(id, 128)) ||
      new Set(input.mandatoryIds).size !== input.mandatoryIds.length) { fail(); }
  if (Object.hasOwn(input, 'limits') && !record(input.limits)) { fail(); }
  const limits = { candidates: 6, textBytes: 400, totalBytes: 4096, ...input.limits };
  if (!exactKeys(limits, ['candidates', 'textBytes', 'totalBytes']) ||
      !Number.isInteger(limits.candidates) || limits.candidates < 1 || limits.candidates > 6 ||
      !Number.isInteger(limits.textBytes) || limits.textBytes < 1 || limits.textBytes > 400 ||
      !Number.isInteger(limits.totalBytes) || limits.totalBytes < 256 || limits.totalBytes > 4096 ||
      input.mandatoryIds.length > limits.candidates) { fail(); }
  const { path, server, args } = input.tool;
  const { id, text: textField, reference } = input.fields;
  return { tool: { path, server, args }, resultPath: input.resultPath, fields: { id, text: textField, reference },
    task: input.task, mandatoryIds: input.mandatoryIds, limits };
}
