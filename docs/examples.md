# Executable patterns

Prefer direct reasoning or deterministic projection for small/already-seen inputs: [both measured comparisons cost more reported tokens and time with the helper](measurement.md). Use an optional structured signal only when its overhead is justified. Start with neutral, adequate state; do not send a leading conclusion and ask Jev to confirm it. Use ordinary computation for math, trivial classifications and obvious next reads.

## Evaluate bounded evidence

[examples/evaluate.json](../examples/evaluate.json) is synthetic and contains no MCP-derived state, so `sources: []` is intentional:

```sh
node bin/jev-helper.mjs script examples/evaluate.json
```

This emits JavaScript only. Pass the output as the existing `mcpScript` tool's `code`, or explicitly use `/jev-run <absolute-path-to-examples/evaluate.json>` after setup/reload. The latter asks the current model to execute; it does not invoke another tool from an extension.

| Question | Helper spec | Interpretation |
|---|---|---|
| Noul | `type: "noul"`, `instructions`, optional `true`/`false` criteria | Low means **no**, not low confidence; high means yes |
| Choice | `type: "choice"`, named `options` | Exactly one option; include `none` and `insufficient`; inspect distribution and confidence |
| Score | `type: "score"`, ordered `levels` (2–10) | Distribution over zero-based level indices; finite fractional scores may occur; retain rubric |

The helper maps `options`, `levels`, and optional Noul criteria to the adapter's **`criteria`** wire field. Do not pass helper syntax directly to `jev.evaluate`. Independent questions share the supplied state, **not each other's answers**. Form any dependent follow-up only after seeing the first result and within a newly authorized budget. Do not invent calibrated thresholds from these probabilities.

Useful states: competing hypotheses you already formed, a claim plus evidence and gaps, or bounded source snippets for the next read. Keep important research, test obligations and permissions independent of the model's recommendation. No v1 cache; do not reuse an old answer across changed evidence.

### The measured insufficient-evidence fixture

[examples/insufficient.json](../examples/insufficient.json) is the exact synthetic request used in the real paired comparison. It supplies one unspecified test failure, no discriminating evidence, and a deliberately confident but unsupported distractor. Generate it locally with `node bin/jev-helper.mjs script examples/insufficient.json`, or explicitly use `/jev-run <absolute-path-to-examples/insufficient.json>` after reviewing the external-call permissions and budget.

The observed helper returned Noul 0.02, Choice `insufficient` (probability 1), Score 1. Direct reasoning reached the same semantic conclusion using qualitative labels at substantially lower measured overhead. This is neither exact output-schema equivalence nor evidence of calibrated confidence. A future run need not return the same numbers.

## General MCP prioritization template

[examples/prioritize.json](../examples/prioritize.json) is deliberately marked `EDIT_*`. It generates syntactically valid code but will **not work unchanged** against a real source.

1. In an authorized parent session, inspect an already-enabled MCP tool's actual schema and response shape.
2. Replace `tool.path`, `tool.server`, `tool.args`, `resultPath`, and the three `fields` mappings. The selected array must contain string IDs, bounded text and resolvable references. A raw MCP text envelope is not automatically structured JSON.
3. Put mandatory evidence IDs in `mandatoryIds`. They survive selection; omission is not a permission to skip them. Keep source expansion paths and references.
4. Explicitly configure that known enabled server in Jev's source allowlist. Generate the script, then execute through `mcpScript` under normal approvals.
5. Consume a cheap reversible next read directly; treat an important conclusion as a hypothesis requiring source verification.

The script fetches candidates through `tools.call` **inside** `mcpScript`, projects bounded snippets, asks one Choice, and emits compact selection/coverage/recovery information. It does not pre-read a giant source in the main model. Zero/singleton candidate sets use deterministic handling. Truncation and omitted candidates remain visible.

The sandbox has no Pi-native `read`, `bash`, or bare local filesystem access. An authorized MCP file reader can supply file snippets; a local filename alone cannot. Optional skill prioritization must never exclude mandatory skills. Under Gentle, load the exact parent-resolved `Skills to load before work` first; do not rediscover the skill registry or bypass restricted children.

## Optional public grep recipe

[examples/grep-prioritize.mjs](../examples/grep-prioritize.mjs) is **standalone mcpScript JavaScript**, not a JSON spec, Node executable, or `/jev-run` input. Paste its entire content as the existing `mcpScript` tool's `code` after reviewing it. No import, new transport, server install or automatic configuration is performed.

Optional upstream source: [Vercel's grep MCP announcement](https://vercel.com/blog/grep-a-million-github-repositories-via-mcp), endpoint `https://mcp.grep.app`. If you independently choose to configure it through your normal adapter workflow, its server entry is:

```json
{ "mcpServers": { "grep": { "url": "https://mcp.grep.app" } } }
```

Do not overwrite your existing config with this fragment. Inspect `pi list`, adapter server configuration and current permissions first. Then explicitly authorize the already-enabled `grep` source, e.g. `/jev-setup project --sources grep`, after undoing any prior owned setup if changing sources, and reload.

Discovery reported `grep_searchGitHub` with schema:

```text
{ query, matchCase?, matchWholeWords?, useRegexp?, repo?, path?, language?: string[] }
```

The recipe's concrete read-only query is:

```json
{ "query": "isError: true", "repo": "modelcontextprotocol/typescript-sdk", "language": ["TypeScript"] }
```

The observed result was **10 raw text blocks**, `data.content[{type:"text",text:...}]`, with `Repository:`, `Path:`, `URL:`, `License:`, `Snippets:` lines; no `structuredContent`. The maintainer inspected metadata/shape/references/lengths, not every source block. The recipe parses URLs and snippets inside the script, projects at most six 400-byte JSON excerpts, sends `sources: ["grep"]` and a direct **criteria** Choice with `none`/`insufficient`, and emits one selected excerpt plus all bounded-result references, coverage and usage. Unknown shapes fail closed. Omitted files are unranked, not irrelevant; full sources and their licenses remain authoritative.

**Both live component execution and fresh native model-session recipe use were verified.** The model-session check used `session.prompt`, normal guarded tool calls, and automatic reads of the installed skill/examples; it was not a direct `AgentTool.execute` probe. That helper arm used 19206 combined reported tokens and 52.671 s versus 7094 and 35.401 s for a baseline using the **same six bounded clips and ten references**, not a raw-text dump. The baseline chose an error guide; the helper chose a relevant low-level handler with confidence 0.29. No unique best-read ground truth or accuracy gain was established. See the [fixed-script baseline method and limits](measurement.md#reproduce-the-comparison-without-inflating-the-baseline).

Offline tests also cover abstentions, error masking and bounds. These checks do not guarantee future source shape, selection quality or savings. The helper does not depend on grep and never configures it for you.
