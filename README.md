# jev-helper

Small, opt-in Jev decision scripts for [Pi](https://github.com/earendil-works/pi), using the **separately installed** [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter). MIT; unofficial community project, not endorsed by Pi, Gentle AI, or TypeSafe.

**Prefer direct reasoning or deterministic projection for small or already-seen inputs.** In both measured comparisons the helper used more reported tokens and took longer: public-source next read **7094 → 19206 tokens, 35.401 → 52.671 s**; synthetic insufficient evidence **2611 → 16228 tokens, 14.983 → 39.475 s**. These are single observations per arm, not a general benchmark; actual monetary cost is unavailable. [Method and limitations](docs/measurement.md).

Use Jev only as an optional structured signal for source selection, already-formed hypotheses, or claims against evidence when its overhead is justified. No accuracy or calibration gain was established. It does not replace research, tests, permissions, or human decisions. Installation alone enables nothing and sends nothing.

[Español](docs/es.md) · [Examples](docs/examples.md) · [Compatibility / recovery](docs/compatibility.md) · [Privacy](docs/privacy.md) · [Measurement evidence](docs/measurement.md)

## Install and explicitly enable

Install the pinned package and check existing resources first:

```sh
pi list
pi config
# ONLY if the adapter is not already installed:
pi install npm:pi-mcp-adapter@2.36.0
pi install git:github.com/IrrealV/jev-helper@v0.1.0
```

Release-specific anonymous public-tag installation and hosted CI proof are recorded in [GitHub release notes](https://github.com/IrrealV/jev-helper/releases/tag/v0.1.0) and [Actions](https://github.com/IrrealV/jev-helper/actions) after publication; local validation does not substitute for those records.

Pi installs packages globally by default. Add `-l` to **each install** for project-local packages; trust the project before loading them. Package-install scope and Jev-configuration scope are independent. Do not install a second adapter just because its tools are disabled in one session.

Store your TypeSafe key in the adapter's native terminal prompt, **never in chat, argv, a spec, or this repository**:

```sh
npx --yes --package pi-mcp-adapter@2.36.0 pi-mcp-adapter key set typesafe
```

Alternatively use `node /absolute/path/to/installed/pi-mcp-adapter/cli.js key set typesafe`. That CLI invocation does not activate an adapter extension in Pi. A key alone does **not** enable script evaluation. `/mcp jev setup` enables semantic search, not script evaluation.

Reload Pi, then explicitly choose a configuration scope:

```text
/jev-doctor
/jev-setup project
```

Accept the confirmation only if you intend to enable external script evaluation. New configuration uses a synthetic-only empty source allowlist; existing Jev choices and limits are preserved. To authorize data from already configured, enabled MCP servers, use `/jev-setup project --sources docs,github` with your actual server names. `--sources []` explicitly selects synthetic-only. No server is added or enabled. Undo an owned setup before changing its source list.

**Reload after setup**, then start a **new session** for automatic skill discovery. Doctor reports disk settings and tool activation separately; it cannot certify the adapter's in-memory Jev settings or a working key. It makes no network or credential-store calls.

## Use

```text
/skill:jev-decisions
/jev-run /absolute/path/to/jev-helper/examples/evaluate.json
```

`/jev-run` reads exactly one regular UTF-8 JSON spec (maximum 32768 bytes), validates it locally, then sends the generated code to the current model with an explicit request to use the existing `mcpScript` tool. This triggers a model turn; it is **not** a direct extension-to-tool call. The model and adapter still enforce permissions. Review the spec first: its state is sent to the main model and, on authorized execution, Jev.

For offline generation from a checkout or installed package root:

```sh
node bin/jev-helper.mjs script examples/evaluate.json
node bin/jev-helper.mjs script examples/prioritize.json
```

The second file is a **mapping template**, not a preconfigured working source. Edit its tool path, server, result path, arguments, and field mappings against your actual MCP schema. See the optional, source-specific [grep recipe](docs/examples.md#optional-public-grep-recipe) for raw-text MCP results. No local-filesystem reader exists inside `mcpScript`.

## Commands

| Pi command | Effect |
|---|---|
| `/jev-doctor` | Local metadata and effective disk configuration only; no key values or network |
| `/jev-setup project\|global [--sources names]` | Confirmation, scoped reversible `settings.jev` change |
| `/jev-undo project\|global` | Confirmation, restore only the owned Jev block if unchanged |
| `/jev-run spec-path` | Bounded file → existing script builder → explicit model request |

CLI equivalents: `jev-helper doctor`, `jev-helper setup project --enable`, `jev-helper undo project`. Run through `node bin/jev-helper.mjs` when not on PATH. Supply `--adapter-root /absolute/installed/pi-mcp-adapter` for Git/local dependencies or when standalone Node cannot resolve the optional Pi SDK. Supply the same `--mcp-config /absolute/config.json` override as your Pi session. Never put keys in these commands.

New-settings defaults: model `jev-1.13.0`, timeout 10000 ms, retries 0, state 4096 UTF-8 bytes, 3 questions, 1 evaluation/script, 16384 evaluation bytes/script, 4096 evaluation tokens/script, semantic search false. Existing limits are not reset; an existing Jev object without `semanticSearch` retains the adapter's credential-dependent behavior. Doctor warns when smaller limits cannot accommodate helper bounds. A post-response token budget is not an exact preflight spending cap.

## Undo, uninstall, update

First undo the **same configuration scope** you enabled, then reload:

```text
/jev-undo project
```

Then remove the package from the **same installation scope**:

```sh
pi remove -l git:github.com/IrrealV/jev-helper@v0.1.0  # project install
# For a global install, omit -l.
```

Undo preserves unrelated changes and refuses conflicting Jev edits. A small adjacent `*.jev-helper-rollback.json` contains only the previous Jev block/presence and expected written block, never server definitions or credentials. It remains after undo to make recovery idempotent. See [recovery details](docs/compatibility.md#scope-and-recovery).

Removing the helper does not undo configuration, remove the separately installed adapter, or delete its key. Manage those separately and explicitly with the adapter. Pinned Git tags do not float: install an explicitly reviewed newer tag with `pi install git:github.com/IrrealV/jev-helper@<new-tag>` (and the same `-l` scope if applicable), reload, and start a new session. Use only published tags; never force or move an existing release tag.

## Development and status

```sh
npm install --ignore-scripts
npm test
npm pack --dry-run
```

Only own runtime dependency: `jsonc-parser@3.3.1`. The Pi SDK is an optional `*` peer, never bundled; the adapter and TypeSafe SDK are not helper dependencies. No install hooks, own transport, telemetry, cache, or automatic orchestration. CI is keyless and does not publish.

Verified locally on Linux with Pi 0.86.1, adapter 2.36.0 and Node 26.8.2: **125 offline tests**, packed SDK resource loading, doctor/setup with simulated confirmation UI, and scoped CLI setup/idempotence/undo/reapply. Fresh native SDK model sessions exercised `/jev-run`, automatic skill reading, and the public-source recipe through the normal model/tool path—not direct `AgentTool.execute` calls. These bounded runs establish functionality, not general agent reliability or savings. See [measurements](docs/measurement.md) and the unchanged [aggregate evidence](docs/validation-v0.1.0.json).

## Attribution

Original helper implementation, MIT; see [LICENSE](LICENSE). Integrates public APIs from [Pi](https://github.com/earendil-works/pi), [pi-mcp-adapter by Nico Bailon](https://github.com/nicobailon/pi-mcp-adapter), and [TypeSafe Jev](https://docs.typesafe.ai/). Optional Gentle AI usage follows the parent harness's exact skill paths and restrictions; it is not a dependency. No third-party implementation code is copied or bundled.
