---
name: jev-route-selector
description: Select optimal delegation route deterministically to reduce orchestrator tokens
trigger:
  - route selection
  - delegation planning
  - choose model
  - select agent profile
  - jev routing
  - adaptive delegation
priority: 80
version: 1.0.0
---

# jev-route-selector

Consultar el catálogo de rutas de jev-helper antes de delegar una tarea para seleccionar automáticamente el modelo y perfil más apropiado, reduciendo tokens del orquestador.

## When to use this skill

Use this skill BEFORE calling `subagent_run` to determine:
- Which model to use for delegation
- What thinking level is appropriate
- Whether semantic choice (jev evaluation) is needed

**Trigger scenarios**:
- Planning to delegate a task to a subagent
- Need to choose between fast/cheap vs deep/expensive routes
- Want to reduce orchestrator token usage with smart routing

## How it works

1. **Load catalog**: Reads `~/.pi/jev-helper/route-catalog.json` (or project-local)
2. **Analyze task**: Extracts keywords, estimates complexity and scope
3. **Resolve route**: Deterministically selects best route or identifies ambiguity
4. **Return result**:
   - **Determined**: Single obvious route → use it directly
   - **Ambiguous**: Multiple suitable routes → call jev to choose
   - **No suitable route**: Use agent default

## Integration pattern

```javascript
// Before delegating, consult the route selector
const selection = await selectJevRoute(agent, taskDescription);

if (selection.status === 'determined') {
  // Use the determined route directly (saves tokens)
  await subagent_run({
    agent: selection.agent,
    task: taskDescription,
    model: selection.model,
    thinking: selection.thinking
  });
} else if (selection.status === 'ambiguous') {
  // Multiple suitable routes → use jev to choose
  const choice = await jev_run({
    mode: 'evaluate',
    request: {
      state: {
        task: taskDescription,
        suitableRoutes: selection.suitableRoutes,
        routeDetails: selection.routeDetails
      },
      questions: {
        bestRoute: {
          type: 'choice',
          instructions: 'Choose the most appropriate route for this task',
          options: selection.routeOptions
        }
      }
    }
  });
  // Use jev's selected route
  await subagent_run({
    agent: selection.agent,
    task: taskDescription,
    model: choice.routeModel,
    thinking: choice.routeThinking
  });
} else {
  // No suitable route → use agent default
  await subagent_run({
    agent: selection.agent,
    task: taskDescription
    // No model/thinking specified → uses agent default
  });
}
```

## API

### selectJevRoute(agent, taskDescription, hints?)

Consult the route catalog to select the best delegation route.

**Parameters**:
- `agent` (string): Agent identity (e.g., 'gentle-ai-worker', 'gentle-ai-explore')
- `taskDescription` (string): Task description for analysis
- `hints` (object, optional):
  - `complexity`: Override estimated complexity ('trivial', 'simple', 'moderate', 'complex')
  - `scope`: Override estimated scope ('read-only', 'single-file', 'multi-file', 'cross-package')
  - `priority`: Override priority ('low', 'normal', 'high', 'urgent')

**Returns** (object):
```typescript
{
  status: 'determined' | 'ambiguous' | 'no-suitable-route',
  agent: string,
  
  // When status === 'determined'
  route?: string,           // Route ID
  model?: string,           // Model to use
  thinking?: string,        // Thinking level
  reason?: string,          // Why this route was selected
  estimatedTokens?: number, // Estimated token cost
  
  // When status === 'ambiguous'
  suitableRoutes?: string[],     // Route IDs
  routeDetails?: object[],       // Full route details for each
  routeOptions?: object,         // Formatted for jev evaluation
  
  // Always included
  taskContext: {
    keywords: string[],
    estimatedComplexity: string,
    scope: string,
    priority: string
  }
}
```

## Configuration

### Catalog location

1. **Project-local** (preferred): `<project-root>/.pi/jev-helper/route-catalog.json`
2. **User-global**: `~/.pi/jev-helper/route-catalog.json`
3. **Extension default**: `node_modules/jev-helper/examples/route-catalog.json`

The first existing catalog is used.

### Catalog structure

See `examples/route-catalog.json` for the complete schema. Key elements:

```json
{
  "version": "1.0.0",
  "agents": {
    "gentle-ai-worker": {
      "identity": "gentle-ai-worker",
      "description": "...",
      "routes": [
        {
          "id": "fast-trivial",
          "model": "gemini-2.0-flash-thinking-exp-01-21",
          "thinking": "low",
          "suitability": {
            "description": "...",
            "taskPatterns": [
              {
                "keywords": ["typo", "format"],
                "maxComplexity": "trivial",
                "scope": ["single-file"]
              }
            ]
          },
          "cost": {
            "relative": "very-low",
            "tokensPerTask": 5000
          }
        }
      ],
      "defaultRoute": "balanced-simple"
    }
  }
}
```

## Token savings

**Deterministic routes avoid model invocation** for obvious cases:

- **Trivial tasks** (typos, formatting) → fast-trivial route (~5k tokens vs ~15k)
- **Simple tasks** (single-file changes) → balanced-simple (~15k tokens vs ~40k)
- **Complex tasks** (refactoring, architecture) → deep-complex (~40k tokens, appropriate)

**Estimated savings**: 2000-5000 tokens per deterministic task.

For a session delegating 10 tasks:
- Without routing: ~250k tokens average
- With deterministic routing: ~150k tokens (40% reduction)
- Ambiguous cases still use jev (~3k tokens overhead)

## Examples

### Example 1: Trivial typo fix (deterministic)

```javascript
const selection = await selectJevRoute(
  'gentle-ai-worker',
  'Fix typo in README.md line 42'
);

// Result:
{
  status: 'determined',
  agent: 'gentle-ai-worker',
  route: 'fast-trivial',
  model: 'gemini-2.0-flash-thinking-exp-01-21',
  thinking: 'low',
  reason: 'Single suitable route: Trivial mechanical changes',
  estimatedTokens: 5000,
  taskContext: {
    keywords: ['fix', 'typo', 'readme'],
    estimatedComplexity: 'trivial',
    scope: 'read-only',
    priority: 'normal'
  }
}
```

### Example 2: Complex refactoring (deterministic)

```javascript
const selection = await selectJevRoute(
  'gentle-ai-worker',
  'Refactor authentication system architecture across packages'
);

// Result:
{
  status: 'determined',
  agent: 'gentle-ai-worker',
  route: 'deep-complex',
  model: 'gemini-2.0-flash-thinking-exp-01-21',
  thinking: 'high',
  reason: 'Single suitable route: Complex changes requiring deep reasoning',
  estimatedTokens: 40000,
  taskContext: {
    keywords: ['refactor', 'authentication', 'architecture', 'packages'],
    estimatedComplexity: 'complex',
    scope: 'cross-package',
    priority: 'normal'
  }
}
```

### Example 3: Ambiguous case (needs jev)

```javascript
const selection = await selectJevRoute(
  'gentle-ai-worker',
  'Improve error handling in user authentication'
);

// Result:
{
  status: 'ambiguous',
  agent: 'gentle-ai-worker',
  suitableRoutes: ['balanced-simple', 'deep-complex'],
  routeDetails: [
    {
      id: 'balanced-simple',
      model: '...',
      thinking: 'medium',
      description: 'Simple well-defined changes',
      estimatedTokens: 15000
    },
    {
      id: 'deep-complex',
      model: '...',
      thinking: 'high',
      description: 'Complex changes requiring deep reasoning',
      estimatedTokens: 40000
    }
  ],
  routeOptions: {
    'balanced-simple': 'Medium thinking, ~15k tokens',
    'deep-complex': 'High thinking, ~40k tokens'
  },
  reason: '2 suitable routes; semantic choice needed',
  taskContext: { ... }
}

// Then call jev to choose between them
```

## Notes

- **Catalog is policy**: Human/policy authors define suitability, not the model
- **Conservative defaults**: When in doubt, uses agent default route
- **Transparent reasoning**: Always shows why a route was selected
- **No runtime changes**: Only affects route selection, not agent behavior
- **Stage 1 only**: Automatic jev invocation (Stage 2) requires execution boundary

## Known limitations

### Coverage gaps
The current catalog focuses on common cases. Some valid combinations lack dedicated routes:
- **Moderate complexity**: No dedicated route; falls back to balanced-simple or deep-complex
- **Cross-package simple**: Uses balanced-simple (multi-file), may be suboptimal for large monorepos
- **Multi-file trivial**: Rare in practice; uses balanced-simple as fallback

These are documented design choices, not bugs. Add custom routes to your catalog if needed.

### Scope semantics
Scope represents primarily **extent** (how many files/packages), not strictly **mutability** (read vs write):
- `read-only`: Detected by keywords (find, list, search) + absence of change indicators
- `single-file`: Default for most tasks without multi-file indicators
- `multi-file`: Multiple files in same package
- `cross-package`: Monorepo/workspace spanning packages

A task can be read-only but cross-package (e.g., "Find all uses of X across packages").

### Pattern matching
Word-boundary aware matching prevents false positives but has limits:
- Multi-word patterns ("breaking change", "rename variable") match as phrases
- Negation detection handles direct patterns ("do not X", "avoid X") but not complex clauses
- Filenames excluded (.ts, .js, .json, .md) but other extensions may trigger keywords

## Related

- `/jev-run` - Execute jev evaluation for ambiguous cases
- `/skill:jev-decisions` - Enable jev evaluation capabilities
- `lib/routing.mjs` - Implementation of route selection logic
- `examples/route-catalog.json` - Example catalog configuration
