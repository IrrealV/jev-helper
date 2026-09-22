# Measurement: both observed comparisons favored the direct baseline

**Prefer direct reasoning or deterministic projection for these small/already-visible inputs.** The helper used more reported tokens and took longer in both comparisons. Use optional Jev evaluation only when its additional structured signal justifies measured overhead; no accuracy, calibration, monetary savings or universal benefit was established.

The authoritative [v0.1.0 aggregate](validation-v0.1.0.json) is an unchanged, privacy-reviewed snapshot dated 2026-09-22. It contains versions, aggregate usage/cache/reasoning/tool counters and public task descriptions, not transcripts, credentials, personal paths or tool IDs. Measurements precede the final documentation and recipe-header updates; the executable recipe body is unchanged.

## Results

Environment: Linux, Node 26.8.2, Pi 0.86.1, adapter 2.36.0, main model `openai-codex/gpt-6-astra` with high thinking, Jev `jev-1.13.0`.

Elapsed time covers `session.prompt` dispatch through `agent_end`, excluding package/credential setup, SDK startup and fixed-script preparation. Token totals cover the measured task sessions plus Jev, not development, review or preparatory component probes. `runtimeSubagents: 0` applies only to those measured sessions; this is not a whole-project cost comparison.

| Task / arm | Main-model reported tokens | Jev input + output | Combined reported tokens | Elapsed |
|---|---:|---:|---:|---:|
| Public source: deterministic projection + main-model choice | 7094 | 0 | **7094** | **35.401 s** |
| Public source: helper | 17875 | 1248 + 83 = 1331 | **19206** | **52.671 s** |
| Synthetic insufficient evidence: direct reasoning | 2611 | 0 | **2611** | **14.983 s** |
| Synthetic insufficient evidence: helper | 15569 | 578 + 81 = 659 | **16228** | **39.475 s** |

These sums combine different tokenizer units: they are reported accounting totals, not equal compute or monetary cost. Main-model totals include native cache counters; do not add cache reads again. The public-source helper had 5248 cache-read tokens; the synthetic helper had 6016. Both baselines had zero cache reads and all four arms had zero cache writes. The synthetic baseline's **71 reasoning tokens are already included in its 389 output tokens**, not an additional chargeable token count.

Each baseline used two main-model calls; each helper arm used four. Public-source tool calls were 1 versus 3; synthetic tool calls were 1 versus 4. Skill and examples-document reads, instructions, arguments and results are included in helper overhead. All four arms reported zero model errors, blocked calls and runtime subagents. Full tool argument/result byte counts, script sizes and native counters remain in the aggregate.

**Actual prices/charges are unavailable.** The JSON's `mainSdkCatalogCostUsd` fields are unverified, main-model-only SDK catalog estimates—not observed charges, combined Jev costs or subscription accounting. They must not be presented as dollars spent or saved.

### Quality and evidence coverage

- **Public sources:** both arms used the same six bounded clips from ten references: six truncated, four omitted/unranked. Both recorded `fnv1a32:4260389807:12035`, a **noncryptographic** source fingerprint, not collision-proof content identity. Baseline chose c4 (error guide); helper chose c1 (low-level tool handler) with confidence **0.29**. Both references concern tool-result errors; no unique best-read ground truth or accuracy gain was established.
- **Insufficient evidence:** both rejected an unsupported cause, selected insufficient evidence and the middle “no discriminating evidence” rubric. The [exact synthetic fixture](../examples/insufficient.json) produced helper Noul **0.02**, Choice **insufficient** (probability **1**), and Score **1**. Baseline used qualitative labels: semantic agreement is **not exact output-schema equivalence**, and a probability of 1 is not proof of calibration.

## Reproduce the comparison without inflating the baseline

1. Freeze the task, model/thinking setting, permissions, query, result mapping and projection bounds. Use synthetic state or explicitly authorized public data only. Each arm starts a fresh SDK agent session; the recorded order was baseline then helper. Provider cache was **not forced cold**.
2. For public-source baseline code, take [grep-prioritize.mjs](../examples/grep-prioritize.mjs) unchanged up to `const criteria`, then emit **the same candidates, references and coverage** without Jev. From the package root, this local command generates that fixed baseline script:

   ```sh
   node --input-type=module <<'JS'
   import { readFileSync } from 'node:fs';
   const code = readFileSync('examples/grep-prioritize.mjs', 'utf8');
   const boundary = code.indexOf('  const criteria =');
   if (boundary < 0) throw new Error('Recipe boundary changed; inspect before use.');
   process.stdout.write(code.slice(0, boundary) +
     '  emit({ status: "baseline", candidates, references, coverage, recovery });\n})()\n');
   JS
   ```

   Ask the main model to choose a next read from this bounded result. **A raw-text-dump baseline was not used.** The helper arm retains the original recipe's decision body and adds its Jev signal. In both arms, preserve all ten references and omission/clipping notices; do not call a smaller result “equivalent” if required evidence was dropped.
3. For synthetic comparison, use [insufficient.json](../examples/insufficient.json) unchanged in both arms. Baseline reads/reasons over it directly; helper uses the installed skill and generated evaluation script. Match the evidence and question semantics without pretending qualitative and numeric outputs share an exact schema.
4. Run through native **`session.prompt` and the normal model/tool path**, with a `tool_call` guard allowing only the exact approved script once per session and read-only installed public resources. The measured sessions did not substitute direct `AgentTool.execute` calls. No retries or alternate transport; source allowlists, state/question/byte/token bounds and normal permissions still apply.
5. Sum native `totalTokens` across assistant messages and add Jev's reported input/output once. Retain native input/output/cache/reasoning counters, all instructions and tool payloads, elapsed time, errors and quality outcomes. Record exact payload sizes separately from source-file size: measured script bytes refer to the snapshot's executed payloads, not a promise that current file lengths match them. Recheck corpus/projection equivalence when public search results change.

This is a reproducible **method**, not a prediction that a provider will return the same timings, cache behavior, usage or choice.

## What was actually validated?

| Layer | Evidence | Boundary |
|---|---|---|
| Offline tests | **125 passing tests**, including config corrections and generated-script contracts | Not live inference |
| Packed resource/command lifecycle | Two package extensions, zero load errors; both skills discovered; doctor/setup passed with **simulated confirmation UI**; scoped CLI setup/idempotence/undo/reapply passed | Not a human-operated TUI or public-tag install |
| Initial component probes | Synthetic adapter/helper and public grep recipe execution passed | Component execution alone does not prove model adoption or efficiency |
| Native `/jev-run` | Fresh real SDK model session; 15176 main + 591 Jev = **15767 reported tokens**, **36.643 s** | Functionality check, not a paired savings comparison |
| Fresh-session skill/source use | Main model automatically read the installed skill and examples, then executed the source recipe through the normal tool path | One bounded observation, not universal skill adherence |
| Public installation / hosted CI | Release-specific proof is recorded in GitHub release notes and Actions after publication | Not inferred from local tests |

Validation used **7 of 8** authorized live Jev evaluations, **0 configured retries**. The final evaluation is reserved for a necessary final public smoke check, not additional experiments. This documentation update makes no remote calls.

Minimal local overhead fixtures remain **1391 UTF-8 bytes** for evaluate and **7494 UTF-8 bytes** for general prioritize. Those are **not token counts or savings**. No cache is implemented by the helper in v1; that does not mean the upstream model provider has no cache.

## Limits

N=1 per arm, baseline-first ordering, unforced provider caching, different tokenizer units and small tasks prevent generalized efficiency or quality conclusions. Actual total monetary/subscription cost, repeated-run uncertainty and calibration remain unavailable. Public source snippets are untrusted and incomplete; retain source verification, mandatory evidence, tests and permissions. The adapter's cumulative token limit is checked after response, so byte/state/question bounds are not an exact preflight spending cap. Do not recursively ask Jev whether to call Jev.
