/**
 * Stage 1: Route catalog schema and validation
 * 
 * Defines authorized (model, thinking) alternatives for each agent identity,
 * with human/policy-authored suitability guidance for deterministic selection.
 */

const CATALOG_VERSION = '1.0.0';

const COMPLEXITY_LEVELS = ['trivial', 'simple', 'moderate', 'complex'];
const THINKING_LEVELS = ['low', 'medium', 'high'];
const TASK_SCOPES = ['read-only', 'single-file', 'multi-file', 'cross-package'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const COST_RELATIVES = ['very-low', 'low', 'medium', 'high', 'very-high'];

/**
 * Validate a complete route catalog
 * @param {any} catalog - Catalog to validate
 * @returns {{ valid: boolean; errors: string[] }}
 */
export function validateCatalog(catalog) {
  const errors = [];

  if (!catalog || typeof catalog !== 'object') {
    return { valid: false, errors: ['Catalog must be an object'] };
  }

  if (catalog.version !== CATALOG_VERSION) {
    errors.push(`Unsupported catalog version: ${catalog.version} (expected ${CATALOG_VERSION})`);
  }

  if (!catalog.agents || typeof catalog.agents !== 'object') {
    errors.push('Catalog must have "agents" object');
    return { valid: false, errors };
  }

  // Validate each agent
  for (const [agentId, agentRoutes] of Object.entries(catalog.agents)) {
    const agentErrors = validateAgentRoutes(agentId, agentRoutes);
    errors.push(...agentErrors.map(e => `Agent "${agentId}": ${e}`));
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate agent routes configuration
 * @param {string} agentId - Agent identifier
 * @param {any} agentRoutes - Agent routes config
 * @returns {string[]} - Validation errors
 */
function validateAgentRoutes(agentId, agentRoutes) {
  const errors = [];

  if (!agentRoutes || typeof agentRoutes !== 'object') {
    return ['must be an object'];
  }

  if (agentRoutes.identity !== agentId) {
    errors.push(`identity mismatch: "${agentRoutes.identity}" !== "${agentId}"`);
  }

  if (!agentRoutes.description || typeof agentRoutes.description !== 'string') {
    errors.push('must have string "description"');
  }

  if (!Array.isArray(agentRoutes.routes) || agentRoutes.routes.length === 0) {
    errors.push('must have non-empty "routes" array');
  } else {
    const routeIds = new Set();
    for (const [index, route] of agentRoutes.routes.entries()) {
      const routeErrors = validateRoute(route);
      errors.push(...routeErrors.map(e => `routes[${index}]: ${e}`));

      if (route && typeof route === 'object') {
        if (route.id && routeIds.has(route.id)) {
          errors.push(`routes[${index}]: duplicate route id "${route.id}"`);
        }
        routeIds.add(route.id);
      }
    }

    if (agentRoutes.defaultRoute && !routeIds.has(agentRoutes.defaultRoute)) {
      errors.push(`defaultRoute "${agentRoutes.defaultRoute}" not found in routes`);
    }
  }

  return errors;
}

/**
 * Validate a single route
 * @param {any} route - Route to validate
 * @returns {string[]} - Validation errors
 */
function validateRoute(route) {
  const errors = [];

  if (!route || typeof route !== 'object') {
    return ['must be an object'];
  }

  if (!route.id || typeof route.id !== 'string') {
    errors.push('must have string "id"');
  }

  if (!route.model || typeof route.model !== 'string') {
    errors.push('must have string "model"');
  }

  if (route.thinking !== undefined && !THINKING_LEVELS.includes(route.thinking)) {
    errors.push(`invalid thinking level: "${route.thinking}" (must be one of: ${THINKING_LEVELS.join(', ')})`);
  }

  if (!route.suitability) {
    errors.push('must have "suitability" object');
  } else {
    errors.push(...validateSuitability(route.suitability).map(e => `suitability: ${e}`));
  }

  if (!route.cost) {
    errors.push('must have "cost" object');
  } else {
    errors.push(...validateCost(route.cost).map(e => `cost: ${e}`));
  }

  return errors;
}

/**
 * Validate suitability configuration
 * @param {any} suitability - Suitability config
 * @returns {string[]} - Validation errors
 */
function validateSuitability(suitability) {
  const errors = [];

  if (!suitability || typeof suitability !== 'object') {
    return ['must be an object'];
  }

  if (!suitability.description || typeof suitability.description !== 'string') {
    errors.push('must have string "description"');
  }

  if (!Array.isArray(suitability.taskPatterns) || suitability.taskPatterns.length === 0) {
    errors.push('must have non-empty "taskPatterns" array');
  } else {
    for (const [index, pattern] of suitability.taskPatterns.entries()) {
      errors.push(...validateTaskPattern(pattern).map(e => `taskPatterns[${index}]: ${e}`));
    }
  }

  if (suitability.constraints) {
    if (!Array.isArray(suitability.constraints)) {
      errors.push('"constraints" must be an array');
    } else {
      for (const [index, constraint] of suitability.constraints.entries()) {
        errors.push(...validateConstraint(constraint).map(e => `constraints[${index}]: ${e}`));
      }
    }
  }

  return errors;
}

/**
 * Validate task pattern
 * @param {any} pattern - Task pattern
 * @returns {string[]} - Validation errors
 */
function validateTaskPattern(pattern) {
  const errors = [];

  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) {
    return ['must be an object'];
  }

  const criteria = ['keywords', 'maxComplexity', 'requiresComplexity', 'scope', 'priority'];
  if (!criteria.some(criterion => pattern[criterion] !== undefined)) {
    errors.push('must specify at least one criterion');
  }

  if (pattern.keywords !== undefined) {
    if (!Array.isArray(pattern.keywords)) {
      errors.push('"keywords" must be an array');
    } else if (pattern.keywords.length === 0) {
      errors.push('"keywords" array cannot be empty');
    } else if (pattern.keywords.some(k => typeof k !== 'string' || k.trim() === '')) {
      errors.push('"keywords" must be array of non-empty strings');
    }
  }

  if (pattern.maxComplexity !== undefined && !COMPLEXITY_LEVELS.includes(pattern.maxComplexity)) {
    errors.push(`invalid maxComplexity: "${pattern.maxComplexity}" (must be one of: ${COMPLEXITY_LEVELS.join(', ')})`);
  }

  if (pattern.requiresComplexity !== undefined && !COMPLEXITY_LEVELS.includes(pattern.requiresComplexity)) {
    errors.push(`invalid requiresComplexity: "${pattern.requiresComplexity}" (must be one of: ${COMPLEXITY_LEVELS.join(', ')})`);
  }

  // Check for contradictions: maxComplexity < requiresComplexity is invalid
  if (pattern.maxComplexity !== undefined && pattern.requiresComplexity !== undefined) {
    const maxIdx = COMPLEXITY_LEVELS.indexOf(pattern.maxComplexity);
    const minIdx = COMPLEXITY_LEVELS.indexOf(pattern.requiresComplexity);
    if (maxIdx < minIdx) {
      errors.push(`contradiction: maxComplexity "${pattern.maxComplexity}" < requiresComplexity "${pattern.requiresComplexity}"`);
    }
  }

  if (pattern.scope !== undefined) {
    if (!Array.isArray(pattern.scope)) {
      errors.push('"scope" must be an array');
    } else if (pattern.scope.length === 0) {
      errors.push('"scope" array cannot be empty');
    } else if (pattern.scope.some(s => !TASK_SCOPES.includes(s))) {
      errors.push(`"scope" must contain only: ${TASK_SCOPES.join(', ')}`);
    }
  }

  if (pattern.priority !== undefined) {
    if (!Array.isArray(pattern.priority)) {
      errors.push('"priority" must be an array');
    } else if (pattern.priority.length === 0) {
      errors.push('"priority" array cannot be empty');
    } else if (pattern.priority.some(p => !PRIORITIES.includes(p))) {
      errors.push(`"priority" must contain only: ${PRIORITIES.join(', ')}`);
    }
  }

  return errors;
}

/**
 * Validate constraint
 * @param {any} constraint - Constraint
 * @returns {string[]} - Validation errors
 */
function validateConstraint(constraint) {
  const errors = [];

  if (!constraint || typeof constraint !== 'object') {
    return ['must be an object'];
  }

  if (constraint.excludeKeywords !== undefined) {
    if (!Array.isArray(constraint.excludeKeywords)) {
      errors.push('"excludeKeywords" must be an array');
    } else if (constraint.excludeKeywords.length === 0) {
      errors.push('"excludeKeywords" array cannot be empty');
    } else if (constraint.excludeKeywords.some(k => typeof k !== 'string' || k.trim() === '')) {
      errors.push('"excludeKeywords" must be array of non-empty strings');
    }
  }

  if (constraint.requiresComplexity !== undefined && !COMPLEXITY_LEVELS.includes(constraint.requiresComplexity)) {
    errors.push(`invalid requiresComplexity: "${constraint.requiresComplexity}" (must be one of: ${COMPLEXITY_LEVELS.join(', ')})`);
  }

  if (constraint.requiresScope !== undefined) {
    if (!Array.isArray(constraint.requiresScope)) {
      errors.push('"requiresScope" must be an array');
    } else if (constraint.requiresScope.length === 0) {
      errors.push('"requiresScope" array cannot be empty');
    } else if (constraint.requiresScope.some(s => !TASK_SCOPES.includes(s))) {
      errors.push(`"requiresScope" must contain only: ${TASK_SCOPES.join(', ')}`);
    }
  }

  return errors;
}

/**
 * Validate cost indicator
 * @param {any} cost - Cost indicator
 * @returns {string[]} - Validation errors
 */
function validateCost(cost) {
  const errors = [];

  if (!cost || typeof cost !== 'object') {
    return ['must be an object'];
  }

  if (!cost.relative || !COST_RELATIVES.includes(cost.relative)) {
    errors.push(`must have valid "relative" (one of: ${COST_RELATIVES.join(', ')})`);
  }

  if (cost.tokensPerTask !== undefined) {
    if (typeof cost.tokensPerTask !== 'number' || cost.tokensPerTask <= 0) {
      errors.push('"tokensPerTask" must be a positive number');
    }
  }

  return errors;
}
