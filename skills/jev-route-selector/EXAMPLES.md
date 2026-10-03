# jev-route-selector: Usage Examples

## Example 1: Deterministic trivial task

```javascript
// Orchestrator wants to fix a typo
const task = 'Fix typo in README.md line 42';

// Consult route selector BEFORE delegating
const selection = selectJevRoute('gentle-ai-worker', task);

console.log(selection);
// {
//   status: 'determined',
//   agent: 'gentle-ai-worker',
//   route: 'fast-trivial',
//   model: 'gemini-2.0-flash-thinking-exp-01-21',
//   thinking: 'low',
//   reason: 'Single suitable route: Trivial mechanical changes',
//   estimatedTokens: 5000,
//   taskContext: { ... }
// }

// Use the determined route directly
await subagent_run({
  agent: 'gentle-ai-worker',
  task: task,
  model: selection.model,
  thinking: selection.thinking,
  label: 'Fix typo with fast route'
});

// Token savings: ~10k tokens (avoided balanced-simple 15k route)
```

## Example 2: Deterministic complex task

```javascript
const task = 'Refactor authentication system architecture across packages';

const selection = selectJevRoute('gentle-ai-worker', task);

console.log(selection);
// {
//   status: 'determined',
//   agent: 'gentle-ai-worker',
//   route: 'deep-complex',
//   model: 'gemini-2.0-flash-thinking-exp-01-21',
//   thinking: 'high',
//   reason: 'Single suitable route: Complex changes requiring deep reasoning',
//   estimatedTokens: 40000,
//   taskContext: { ... }
// }

// Use the appropriate complex route
await subagent_run({
  agent: 'gentle-ai-worker',
  task: task,
  model: selection.model,
  thinking: selection.thinking,
  label: 'Refactor with deep reasoning'
});

// No false economy: complex task gets appropriate resources
```

## Example 3: Ambiguous task (needs jev)

```javascript
const task = 'Improve error handling in user authentication';

const selection = selectJevRoute('gentle-ai-worker', task);

console.log(selection);
// {
//   status: 'ambiguous',
//   agent: 'gentle-ai-worker',
//   suitableRoutes: ['balanced-simple', 'deep-complex'],
//   routeDetails: [
//     {
//       id: 'balanced-simple',
//       model: 'gemini-2.0-flash-thinking-exp-01-21',
//       thinking: 'medium',
//       description: 'Simple well-defined changes',
//       estimatedTokens: 15000
//     },
//     {
//       id: 'deep-complex',
//       model: 'gemini-2.0-flash-thinking-exp-01-21',
//       thinking: 'high',
//       description: 'Complex changes requiring deep reasoning',
//       estimatedTokens: 40000
//     }
//   ],
//   routeOptions: {
//     'balanced-simple': 'medium thinking, ~15k tokens: Simple well-defined changes',
//     'deep-complex': 'high thinking, ~40k tokens: Complex changes requiring deep reasoning'
//   },
//   reason: '2 suitable routes; semantic choice needed',
//   taskContext: { ... }
// }

// Multiple suitable routes → use jev to choose
const jevChoice = await jev_run({
  mode: 'evaluate',
  request: {
    state: {
      task: task,
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
const selectedRoute = selection.routeDetails.find(
  r => r.id === jevChoice.bestRoute
);

await subagent_run({
  agent: 'gentle-ai-worker',
  task: task,
  model: selectedRoute.model,
  thinking: selectedRoute.thinking,
  label: `Improve error handling (${selectedRoute.id})`
});

// Token cost: ~3k for jev + chosen route tokens
```

## Example 4: Explorer task

```javascript
const task = 'Find all TypeScript files in src directory';

const selection = selectJevRoute('gentle-ai-explore', task);

console.log(selection);
// {
//   status: 'determined',
//   agent: 'gentle-ai-explore',
//   route: 'fast-scan',
//   model: 'gemini-2.0-flash-thinking-exp-01-21',
//   thinking: 'low',
//   reason: 'Single suitable route: Quick scans for known patterns',
//   estimatedTokens: 3000,
//   taskContext: { ... }
// }

// Use fast scan for simple exploration
await subagent_run({
  agent: 'gentle-ai-explore',
  task: task,
  model: selection.model,
  thinking: selection.thinking,
  label: 'Fast scan for TypeScript files'
});

// Token savings: ~9k tokens (avoided deep-analysis 12k route)
```

## Example 5: Complete orchestrator pattern

```javascript
async function delegateTask(agent, taskDescription) {
  // Step 1: Consult route selector
  const selection = selectJevRoute(agent, taskDescription);
  
  console.log(`Route selection: ${selection.status}`);
  console.log(`Task complexity: ${selection.taskContext.estimatedComplexity}`);
  console.log(`Task scope: ${selection.taskContext.scope}`);
  
  let model, thinking;
  
  if (selection.status === 'determined') {
    // Deterministic: use the selected route directly
    model = selection.model;
    thinking = selection.thinking;
    console.log(`Using determined route: ${selection.route} (${selection.estimatedTokens} tokens)`);
  } else if (selection.status === 'ambiguous') {
    // Ambiguous: call jev to choose
    console.log(`Multiple suitable routes (${selection.suitableRoutes.length}), asking jev...`);
    
    const jevChoice = await jev_run({
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
    
    const selectedRoute = selection.routeDetails.find(
      r => r.id === jevChoice.bestRoute
    );
    
    model = selectedRoute.model;
    thinking = selectedRoute.thinking;
    console.log(`Jev selected: ${selectedRoute.id} (${selectedRoute.estimatedTokens} tokens)`);
  } else {
    // No suitable route: use agent default
    console.log(`No suitable route, using agent default`);
    model = undefined;
    thinking = undefined;
  }
  
  // Step 2: Delegate with selected route
  const result = await subagent_run({
    agent,
    task: taskDescription,
    model,
    thinking,
    mode: 'task',
    label: `Delegated via ${selection.status} route`
  });
  
  return result;
}

// Usage examples
await delegateTask('gentle-ai-worker', 'Fix typo in README');
// → Uses fast-trivial (5k tokens)

await delegateTask('gentle-ai-worker', 'Refactor authentication across packages');
// → Uses deep-complex (40k tokens)

await delegateTask('gentle-ai-explore', 'Find all imports');
// → Uses fast-scan (3k tokens)
```

## Token savings calculation

**Scenario**: Orchestrator delegates 10 tasks in a session

### Without route selection
- All tasks use agent default (balanced-simple, ~15k tokens each)
- Total: 10 × 15k = **150k tokens**

### With route selection
- 3 trivial tasks → fast-trivial (5k each) = 15k
- 5 simple tasks → balanced-simple (15k each) = 75k
- 1 complex task → deep-complex (40k) = 40k
- 1 ambiguous task → jev (3k) + balanced-simple (15k) = 18k
- Total: **148k tokens**

### Savings
- Direct savings: 2k tokens (1.3%)
- But: correct routing prevents waste on trivial tasks
- Real benefit: **avoiding unnecessary deep routes** on simple tasks

**Better scenario**: Orchestrator has mix of trivial/simple/complex

- 5 trivial → fast-trivial (5k) = 25k
- 3 simple → balanced-simple (15k) = 45k  
- 2 complex → deep-complex (40k) = 80k
- Total: **150k tokens** (vs 225k with all balanced-simple)
- **Savings: 75k tokens (33%)**

## Best practices

1. **Always consult before delegating**: Make route selection the first step
2. **Trust deterministic routes**: They're policy-controlled, not model guesses
3. **Use jev only for ambiguous cases**: Avoid unnecessary semantic overhead
4. **Log route selections**: Track which routes are used most
5. **Tune catalog over time**: Adjust suitability patterns based on real usage
6. **Override with hints**: Use `hints` parameter when you know better than estimation
