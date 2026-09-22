# Privacy boundaries

**Installing the helper does not enable Jev or send data.** Four explicit commands and one on-demand skill are the entire Pi integration. There are no lifecycle hooks, background jobs, provider registrations, new model-visible tools, telemetry, caches, or hidden context injection.

## What can leave the machine?

| Action | Data / destination |
|---|---|
| `script` CLI | Reads one explicitly named bounded JSON file; emits code locally; no execution |
| Doctor | Local tool/package metadata and disk config; no network or credential lookup |
| Setup / undo | Explicit scoped disk changes and Jev-only recovery metadata; no network |
| `/jev-run` | Generated code and its embedded spec enter the current model's conversation; a model turn is triggered |
| Authorized `mcpScript` execution | MCP tool arguments go to selected servers; supplied evaluation state/questions go through the existing adapter to TypeSafe |
| Optional semantic search | Separately configured adapter feature: query and tool metadata may go to TypeSafe, not tool results |

Only provide the minimum authorized state. Never include secrets, credentials, private user data, entire conversations, persistent memory, or repository dumps. The helper does not automatically gather them, but an explicitly supplied spec can still contain sensitive data. The size bound is not a privacy filter. MCP-derived source text and Jev answers are untrusted and can contain prompt injection; neither the helper nor a second model makes them immune.

`sources` must name every represented MCP server. The adapter also tracks server-attributed calls/errors in the script and enforces enabled-server/allowlist policy. This provenance mechanism is **not content redaction** and does not authorize publication or remove your responsibility to minimize data. Synthetic state uses explicit `sources: []`.

Do not store TypeSafe keys in specs, settings.jev, chat, environment files in the repository, command arguments, or backups. Use the adapter's native masked terminal key command. Environment-key handling, keyring behavior and network transport remain adapter responsibilities. The helper never expands credential environment values or invokes key setup. Doctor leaves key status unchecked.

Setup validates source configuration in memory and retains only a Jev-specific recovery record. Atomic config staging necessarily contains config text; failed staging files must be treated as private and inspected locally. Do not commit recovery/config artifacts. The helper neither copies server definitions into sidecars nor rewrites source definitions/auth. File permissions are restricted to 0600 on its writes.

## Published validation data

The [v0.1.0 validation snapshot](validation-v0.1.0.json) publishes only versions, aggregate counters, public-task descriptions and a noncryptographic public-source fingerprint. It excludes credentials, personal paths, transcripts and tool IDs. Its runs used synthetic fixtures or explicitly selected public MCP snippets, not private repositories, persistent memory or conversations. Normal model/tool execution still sent the approved inputs to their respective providers; publishing aggregates does not remove upstream retention.

Fresh-session skill/examples reads were part of the measured main-model overhead. The two observed comparisons used more reported tokens and time with the helper; no privacy, quality or cost advantage should be inferred merely from projecting fewer snippets. See [measurement limits](measurement.md).

## Service policy and retention

The adapter fixes Jev requests to `https://api.typesafe.ai` and model `jev-1.13.0` in the verified version. Review [TypeSafe's current legal/privacy terms](https://docs.typesafe.ai/legal) yourself before use. A no-training commitment is not zero retention. This project cannot promise service deletion, retention duration, regulatory compliance, or provider billing accuracy.

Pi sessions can retain the generated user message and tool outputs. Your main-model provider, selected MCP servers, and TypeSafe have separate policies. The helper has no independent storage of evaluations and no cache in v1, but this does not eliminate upstream/session retention.

## Limits of decisions

Noul, Choice and Score probabilities are not calibrated authorization thresholds. Cheap reversible next reads can consume the result directly; important conclusions still require evidence, tests, normal tool approvals and human permission. An abstention or error means return to the ordinary workflow, not retry or escalate access automatically.
