/**
 * jev-route-selector skill implementation
 * Exposes route selection to Pi orchestrator
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { selectRoute } from '../../lib/routing.mjs';
import { validateCatalog } from '../../lib/catalog.mjs';

let catalogCache = new Map(); // Cache per projectRoot

/**
 * Load route catalog from standard locations
 * @param {string} [projectRoot] - Optional project root for project-local catalog
 * @returns {object} Loaded and validated catalog
 */
function loadCatalog(projectRoot) {
  // Check cache first
  const cacheKey = projectRoot || 'default';
  if (catalogCache.has(cacheKey)) {
    const cached = catalogCache.get(cacheKey);
    return cached.catalog;
  }
  // Catalog location priority:
  // 1. Project-local: <project>/.pi/jev-helper/route-catalog.json
  // 2. User-global: ~/.pi/jev-helper/route-catalog.json
  // 3. Extension default: node_modules/jev-helper/examples/route-catalog.json

  const searchPaths = [];
  
  if (projectRoot) {
    searchPaths.push(join(projectRoot, '.pi', 'jev-helper', 'route-catalog.json'));
  }
  
  searchPaths.push(
    join(homedir(), '.pi', 'jev-helper', 'route-catalog.json'),
    join(new URL('.', import.meta.url).pathname, '../../examples/route-catalog.json')
  );

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        const catalog = JSON.parse(readFileSync(path, 'utf8'));
        const validation = validateCatalog(catalog);
        
        if (!validation.valid) {
          // Fail closed: reject invalid catalog instead of silently falling back
          throw new Error(`Invalid catalog at ${path}: ${validation.errors.join('; ')}`);
        }
        
        // Cache with key
        catalogCache.set(cacheKey, { catalog, path });
        return catalog;
      } catch (error) {
        // Fail closed: only a missing catalog may fall through to a lower-priority path.
        console.error(`Failed to load catalog from ${path}:`, error.message);
        if (error instanceof SyntaxError) {
          throw new Error(`Failed to parse catalog at ${path}: ${error.message}`, { cause: error });
        }
        throw error;
      }
    }
  }

  throw new Error('No valid route catalog found in standard locations');
}

/**
 * Get route details for display
 * @param {object} catalog - Route catalog
 * @param {string} agent - Agent identity
 * @param {string} routeId - Route ID
 * @returns {object} Route details
 */
function getRouteDetails(catalog, agent, routeId) {
  const agentRoutes = catalog.agents[agent];
  if (!agentRoutes) return null;
  
  const route = agentRoutes.routes.find(r => r.id === routeId);
  if (!route) return null;
  
  return {
    id: route.id,
    model: route.model,
    thinking: route.thinking,
    description: route.suitability.description,
    estimatedTokens: route.cost.tokensPerTask,
    costRelative: route.cost.relative
  };
}

/**
 * Format route options for jev evaluation
 * @param {object} catalog - Route catalog
 * @param {string} agent - Agent identity
 * @param {string[]} routeIds - Route IDs
 * @returns {object} Formatted options
 */
function formatRouteOptions(catalog, agent, routeIds) {
  const options = {};
  
  for (const routeId of routeIds) {
    const details = getRouteDetails(catalog, agent, routeId);
    if (details) {
      const tokens = details.estimatedTokens 
        ? `~${(details.estimatedTokens / 1000).toFixed(0)}k tokens`
        : details.costRelative;
      options[routeId] = `${details.thinking || 'default'} thinking, ${tokens}: ${details.description}`;
    }
  }
  
  return options;
}

/**
 * Select optimal delegation route
 * @param {string} agent - Agent identity
 * @param {string} taskDescription - Task description
 * @param {object} [options] - Options
 * @param {string} [options.projectRoot] - Project root for catalog lookup
 * @param {object} [options.hints] - Task hints (complexity, scope, priority)
 * @returns {object} Selection result
 */
export function selectJevRoute(agent, taskDescription, options = {}) {
  const { projectRoot, hints } = options;
  
  // Load catalog (cached per projectRoot)
  const catalog = loadCatalog(projectRoot);
  
  // Perform route selection
  const selection = selectRoute(agent, taskDescription, catalog, hints);
  
  // Build response based on resolution status
  const response = {
    status: selection.resolution.status,
    agent: selection.agent,
    taskContext: selection.taskContext
  };
  
  if (selection.resolution.status === 'determined' || selection.resolution.status === 'fallback') {
    const routeDetails = getRouteDetails(catalog, agent, selection.resolution.route);
    response.route = selection.resolution.route;
    response.model = routeDetails?.model;
    response.thinking = routeDetails?.thinking;
    response.reason = selection.resolution.reason;
    response.estimatedTokens = routeDetails?.estimatedTokens;
    if (selection.resolution.usingFallback) {
      response.usingFallback = true;
    }
  } else if (selection.resolution.status === 'ambiguous') {
    response.suitableRoutes = selection.resolution.suitableRoutes;
    response.routeDetails = selection.resolution.suitableRoutes.map(routeId =>
      getRouteDetails(catalog, agent, routeId)
    );
    response.routeOptions = formatRouteOptions(
      catalog,
      agent,
      selection.resolution.suitableRoutes
    );
    response.reason = selection.resolution.reason;
  } else {
    response.reason = selection.resolution.reason;
  }
  
  return response;
}

/**
 * Clear cached catalog (for testing or reload)
 * @param {string} [projectRoot] - Optional project root to clear specific cache
 */
export function clearCatalogCache(projectRoot) {
  if (projectRoot) {
    catalogCache.delete(projectRoot);
  } else {
    catalogCache.clear();
  }
}

/**
 * Get current catalog path
 * @param {string} [projectRoot] - Optional project root
 * @returns {string|null} Catalog path or null if not loaded
 */
export function getCatalogPath(projectRoot) {
  const cacheKey = projectRoot || 'default';
  const cached = catalogCache.get(cacheKey);
  return cached?.path || null;
}
