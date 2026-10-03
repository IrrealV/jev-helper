/**
 * Stage 1: Deterministic route resolution
 * 
 * Selects the appropriate (model, thinking) route for a task based on
 * catalog suitability criteria. Returns deterministic choice when obvious,
 * or delegates to jev for semantic selection when ambiguous.
 */

const COMPLEXITY_LEVELS = ['trivial', 'simple', 'moderate', 'complex'];

/** Match literal terms with Unicode boundaries, retaining punctuation and phrases. */
function matchesWord(text, word) {
  if (!word) return false;
  const term = word.normalize('NFC').trim();
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu')
    .test(text.normalize('NFC'));
}

/** Ignore filenames unless the catalog explicitly names the entire filename-like term. */
function removeFilenames(text, keyword = '') {
  return text.replace(
    /(?:[a-z]:)?[\p{L}\p{M}\p{N}_@./\\-]+\.(?:ts|js|json|md)(?![\p{L}\p{M}\p{N}_])/giu,
    // A non-whitespace separator prevents phrases from spanning removed filenames.
    filename => matchesWord(keyword, filename) ? filename : '\0'
  );
}

/** Catalog terms must be matched before tokenization can discard their structure. */
function matchesTaskKeyword(taskContext, keyword) {
  if (typeof taskContext.description !== 'string') {
    return taskContext.keywords.some(token => matchesWord(token, keyword));
  }
  const prose = removeFilenames(taskContext.description.normalize('NFC'), keyword);
  return matchesWord(removeNegatedActions(prose), keyword);
}

/** Ignore directly negated actions without discarding affirmative clauses. */
function removeNegatedActions(text) {
  return text.replace(
    /\b(?:do\s+not|don['’]t|avoid)\s+(?:breaking\s+change|rename\s+variable|fix\s+spelling|[\w-]+)\b/gi,
    ' '
  );
}

/**
 * Extract task context from description
 * @param {string} description - Task description
 * @param {object} [hints] - Optional hints about task
 * @returns {object} Task context
 */
export function extractTaskContext(description, hints = {}) {
  // Fail closed on invalid input
  if (description == null || typeof description !== 'string') {
    throw new Error('Task description must be a non-null string');
  }
  
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    throw new Error('Task description cannot be empty or whitespace-only');
  }
  
  // Omitted hints may be estimated; explicitly invalid values must fail closed.
  const hasComplexityHint = Object.hasOwn(hints, 'complexity');
  if (hasComplexityHint && !COMPLEXITY_LEVELS.includes(hints.complexity)) {
    throw new TypeError(`Task complexity must be one of: ${COMPLEXITY_LEVELS.join(', ')}`);
  }

  const normalized = description.toLowerCase();
  
  // Remove whole filenames (including paths) before punctuation is tokenized.
  const prose = removeFilenames(normalized);
  const actionable = removeNegatedActions(prose);

  // Keep short and Unicode words for context; catalog matching uses intact prose.
  const words = actionable.normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  
  // Build keyword set (unique words)
  const keywords = [...new Set(words)];

  // Estimate complexity from description
  const estimatedComplexity = hasComplexityHint ? hints.complexity : estimateComplexity(prose);

  // Estimate scope from description
  const scope = hints.scope || estimateScope(actionable);

  // Priority defaults to normal unless specified
  const priority = hints.priority || 'normal';

  return {
    description,
    keywords,
    normalized,  // Keep for pattern matching
    estimatedComplexity,
    scope,
    priority
  };
}

/**
 * Estimate task complexity from description
 * @param {string} normalized - Normalized description
 * @returns {string} Complexity level
 */
function estimateComplexity(description) {
  const normalized = removeNegatedActions(description);

  // Score-based approach to avoid single keyword override
  let complexScore = 0;
  let moderateScore = 0;
  let trivialScore = 0;

  // Complex indicators (weight: 3)
  const complexPatterns = [
    'refactor', 'architecture', 'design', 'algorithm',
    'cross-package', 'migration', 'breaking change'
  ];
  complexScore = complexPatterns.filter(p => matchesWord(normalized, p)).length * 3;

  // Moderate indicators (weight: 2)
  const moderatePatterns = [
    'analyze', 'investigate', 'trace', 'optimize',
    'multiple', 'several', 'across'
  ];
  moderateScore = moderatePatterns.filter(p => matchesWord(normalized, p)).length * 2;

  // Trivial indicators (weight: 1)
  const trivialPatterns = [
    'typo', 'indent', 'format', 'whitespace', 'comment',
    'trailing', 'rename variable', 'fix spelling'
  ];
  trivialScore = trivialPatterns.filter(p => matchesWord(normalized, p)).length;

  // Highest score wins
  const maxScore = Math.max(complexScore, moderateScore, trivialScore);
  
  if (maxScore === 0) return 'simple';  // Default
  if (complexScore === maxScore) return 'complex';
  if (moderateScore === maxScore) return 'moderate';
  if (trivialScore === maxScore && trivialScore > 0) return 'trivial';
  
  return 'simple';
}

/**
 * Estimate task scope from description.
 * 
 * Note: Scope represents primarily EXTENT (how many files/packages affected),
 * not strictly mutability (read vs write). A task can be read-only but cross-package.
 * Current implementation prioritizes read-only detection, then extent.
 * 
 * @param {string} normalized - Normalized description
 * @returns {string} Task scope: read-only, single-file, multi-file, or cross-package
 */
function estimateScope(normalized) {
  // Read-only indicators
  const readOnlyPatterns = ['read', 'find', 'locate', 'list', 'count', 'search', 'grep'];
  if (readOnlyPatterns.some(p => matchesWord(normalized, p)) && 
      !matchesWord(normalized, 'refactor') && 
      !matchesWord(normalized, 'change')) {
    return 'read-only';
  }

  // Cross-package indicators
  const crossPackagePatterns = [
    'cross-package', 'monorepo', 'workspace', 'multiple packages',
    'across packages', 'between packages'
  ];
  if (crossPackagePatterns.some(p => matchesWord(normalized, p))) {
    return 'cross-package';
  }

  // Multi-file indicators
  const multiFilePatterns = [
    'multiple files', 'several files', 'across files',
    'multi-file', 'many files'
  ];
  if (multiFilePatterns.some(p => matchesWord(normalized, p))) {
    return 'multi-file';
  }

  // Default to single-file
  return 'single-file';
}

/**
 * Resolve route deterministically or identify ambiguity
 * @param {string} agent - Agent identity
 * @param {object} taskContext - Task context from extractTaskContext
 * @param {object} catalog - Route catalog
 * @returns {object} Resolution result
 */
export function resolveRoute(agent, taskContext, catalog) {
  const agentRoutes = catalog.agents && Object.hasOwn(catalog.agents, agent)
    ? catalog.agents[agent]
    : undefined;
  
  if (!agentRoutes) {
    return {
      status: 'no-suitable-route',
      reason: `Agent "${agent}" not found in catalog`
    };
  }

  // Filter routes by suitability
  const suitableRoutes = agentRoutes.routes.filter(route =>
    isRouteSuitable(route, taskContext)
  );

  if (suitableRoutes.length === 0) {
    // No suitable route → use default if available
    if (agentRoutes.defaultRoute) {
      return {
        status: 'fallback',
        route: agentRoutes.defaultRoute,
        usingFallback: true,
        reason: 'No suitable routes matched; using default'
      };
    }
    return {
      status: 'no-suitable-route',
      reason: 'No routes matched task patterns and no default configured'
    };
  }

  if (suitableRoutes.length === 1) {
    // Exactly one suitable route → deterministic
    return {
      status: 'determined',
      route: suitableRoutes[0].id,
      reason: `Single suitable route: ${suitableRoutes[0].suitability.description}`
    };
  }

  // Multiple suitable routes → ambiguous, delegate to jev
  return {
    status: 'ambiguous',
    suitableRoutes: suitableRoutes.map(r => r.id),
    reason: `${suitableRoutes.length} suitable routes; semantic choice needed`
  };
}

/**
 * Check if a route is suitable for a task
 * @param {object} route - Route to check
 * @param {object} taskContext - Task context
 * @returns {boolean} True if route is suitable
 */
function isRouteSuitable(route, taskContext) {
  const { suitability } = route;

  // Check constraints first (exclusions)
  if (suitability.constraints) {
    for (const constraint of suitability.constraints) {
      // Exclude if task has forbidden keywords
      if (constraint.excludeKeywords?.some(kw =>
        matchesTaskKeyword(taskContext, kw)
      )) {
        return false;
      }

      // Exclude if task complexity is below required minimum
      if (constraint.requiresComplexity) {
        const levels = COMPLEXITY_LEVELS;
        if (levels.indexOf(taskContext.estimatedComplexity) < levels.indexOf(constraint.requiresComplexity)) {
          return false;
        }
      }

      // Exclude if task scope doesn't match required
      if (constraint.requiresScope &&
          !constraint.requiresScope.includes(taskContext.scope)) {
        return false;
      }
    }
  }

  // Check if any task pattern matches
  return suitability.taskPatterns.some(pattern =>
    matchesPattern(pattern, taskContext)
  );
}

/**
 * Check if task matches a pattern
 * @param {object} pattern - Task pattern
 * @param {object} taskContext - Task context
 * @returns {boolean} True if task matches pattern
 */
function matchesPattern(pattern, taskContext) {
  // All specified criteria must match

  if (pattern.keywords) {
    const hasKeyword = pattern.keywords.some(kw =>
      matchesTaskKeyword(taskContext, kw)
    );
    if (!hasKeyword) return false;
  }

  if (pattern.maxComplexity) {
    if (!meetsComplexity(taskContext.estimatedComplexity, pattern.maxComplexity)) {
      return false;
    }
  }

  if (pattern.requiresComplexity) {
    // Task must be AT LEAST this complex (actual >= required)
    const levels = COMPLEXITY_LEVELS;
    if (levels.indexOf(taskContext.estimatedComplexity) < levels.indexOf(pattern.requiresComplexity)) {
      return false;
    }
  }

  if (pattern.scope) {
    if (!pattern.scope.includes(taskContext.scope)) {
      return false;
    }
  }

  if (pattern.priority) {
    if (!pattern.priority.includes(taskContext.priority)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if actual complexity meets required level
 * @param {string} actual - Actual complexity
 * @param {string} required - Required complexity
 * @returns {boolean} True if actual <= required
 */
function meetsComplexity(actual, required) {
  return COMPLEXITY_LEVELS.indexOf(actual) <= COMPLEXITY_LEVELS.indexOf(required);
}

/**
 * Select route for delegation (main entry point)
 * @param {string} agent - Agent identity
 * @param {string} taskDescription - Task description
 * @param {object} catalog - Route catalog
 * @param {object} [hints] - Optional task hints
 * @returns {object} Selection result with agent, resolution, taskContext
 */
export function selectRoute(agent, taskDescription, catalog, hints) {
  // 1. Extract task context from description
  const taskContext = extractTaskContext(taskDescription, hints);
  
  // 2. Resolve route deterministically
  const resolution = resolveRoute(agent, taskContext, catalog);
  
  // 3. Return result for orchestrator
  return {
    agent,
    resolution,
    taskContext
  };
}
