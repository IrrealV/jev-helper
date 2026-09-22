# Compatibility and recovery

## Supported contract, not a platform promise

| Component | Evidence / policy |
|---|---|
| Pi 0.86.1 | Packed SDK loading, doctor/setup with simulated confirmation UI, and fresh native model-session command/skill use verified |
| pi-mcp-adapter 2.36.0 | Public config export and Jev wire contract inspected; isolated adapter probes passed |
| Node | Node 26.8.2 observed locally; CI requests current Node 22, 24, 26 on Ubuntu. Other platforms are unverified |
| Other Pi/adapter versions | Doctor warns: untested, not certified compatible |
| jsonc-parser 3.3.1 | Pinned own dependency for preserving JSONC; not imported from adapter internals |

The extension imports only public Pi APIs. It uses `getAllTools()` and **extension-only** `getCommands()` `sourceInfo` metadata to identify the loaded adapter, and `getActiveTools()` to diagnose this agent's access. Skill/prompt command resources do not identify extension factories. A bounded ancestor `package.json` name check identifies its installation. SDK/wrapper provenance, multiple loaded adapters, and ambiguous roots are refused rather than assigned guessed disk settings.

Fallback NPM roots come from Pi's public `getAgentDir()` and `CONFIG_DIR_NAME`, respecting `PI_CODING_AGENT_DIR`. Fallback installation is never called runtime activation. Standalone CLI may need `--adapter-root` if Node cannot resolve the optional Pi peer. Git/local installs can use that explicit root. The helper resolves `pi-mcp-adapter/config` through the discovered package's public exports; it never imports or starts the adapter extension/transport.

The local validation loaded two package extensions with zero errors and discovered both `jev-decisions` and `mcp-scripting`. Scoped CLI setup/idempotence/undo/reapply passed. Later fresh sessions used native `session.prompt` with guarded normal model tool calls—not direct `AgentTool.execute`—to exercise `/jev-run` and automatic skill/source-recipe use. These are bounded Linux checks, not cross-platform or unrestricted-agent guarantees. [Aggregate evidence and negative efficiency results](measurement.md).

After scoped undo, native package removal left only the adapter extension/skill and retained its keyring credential. Installing the same packed source twice restored exactly one helper alongside one adapter. SDK command checks used simulated UI, not a human-operated TUI. Same-source reinstall is not a different-version upgrade; migration between released versions remains untested for this first release.

## Scope and recovery

Only the selected target's `settings.jev` is changed. `project` uses the adapter's public `getProjectPiConfigPath(cwd)`; `global` uses `getPiGlobalConfigPath(overridePath)`. These are adapter config files, not Pi package settings. `getConfigDiscoveryPaths(overridePath, cwd)` and `loadMcpConfig(overridePath, cwd)` determine precedence. Because `settings.jev` shallow-replaces across layers, setup seeds the entire effective Jev object before enabling `scriptEvaluation`. An existing object with no `semanticSearch` field retains that absence and the adapter's credential-dependent behavior; only new/previously disabled settings default it to false.

Pass `--mcp-config` consistently to Pi and CLI. The helper resolves the process CLI override and checks any exposed flag for conflicts. Pi 0.86.1 exposes a registered flag only to its owning extension, so the helper normally receives `undefined` for the adapter's flag and relies on argv; hidden SDK-only overrides are not discoverable. The adapter registers no empty-string default. Overrides must be nonempty literal paths, without environment/tilde expansion. `PI_MCP_CONFIG_MODE=exclusive` is honored by the adapter's public discovery/loader: the helper refuses a project scope that is not the active target. In exclusive mode use `global` for the active override, even if that explicitly selected file happens to live in a project. Hidden programmatic configuration is unsupported; use a standard loaded adapter or an explicit CLI installation/config target outside that SDK session.

Every discovered config layer is strictly parsed before accepting effective state. Invalid JSONC, duplicate keys, invalid known Jev fields, unreadable files, and public-loader warnings (including discarded imports) stop the operation. Diagnostics never print config contents or raw loader errors. Unknown Jev fields are refused so they cannot become credential-bearing backup fields. Empty existing files are invalid, not silently replaced.

Setup writes a mode-0600 adjacent rollback record **before** atomically replacing config. Both writes compare their input snapshots immediately before replacement; relevant source snapshots are checked again. JSONC comments and unrelated settings survive edits. Existing files become private (0600). Symlink components, non-regular files, hard-linked config files and surprising target paths are refused. Missing target directories can be created at explicit setup time only.

The sidecar stores exactly `{ previous: { present, value? }, expected }`, with Jev blocks only. It never copies `mcpServers`, auth, environment values, or complete config text. It is not a general config backup.

| State | Safe next action |
|---|---|
| Setup repeated unchanged | No config write |
| Interrupted after sidecar, before config | Undo is a no-op, or repeat setup to resume |
| Config equals expected block | Undo restores previous Jev value/presence, preserving unrelated edits |
| Config already equals previous block | Repeated undo is a no-op |
| Jev block edited by someone else | Refuse; manually compare **only Jev** and reconcile ownership before retrying |
| Existing owned setup needs a different source list | Undo first, then setup again |
| Global target shadowed by project Jev | Refuse; choose/reconcile the higher-precedence scope explicitly |
| A temporary write file remains after failure | Inspect it locally; never paste it into chat or commit it. It may contain full config text |

Rollback records remain after undo, including restored `false` or absent Jev blocks; an empty settings object may remain. Undo does not delete files/directories, uninstall packages, or touch keys. Atomic rename plus compare-before-write protects ordinary interrupted/concurrent editing; it is not an OS lock or a security boundary against a hostile process racing directory/rename operations. Stop concurrent config editors during setup/undo.

## Troubleshooting

- **Installed but absent tool:** inspect `pi list` and `pi config` before installing anything. Reload trusted resources. An intentionally restricted child is excluded; do not activate tools or rediscover everything to bypass its allowlist.
- **ScriptEvaluation false:** key setup and `/mcp jev setup` are insufficient. Use explicit scoped `/jev-setup`, then reload.
- **Disk enabled, execution disabled:** adapter runtime may still hold old config. Reload; doctor cannot introspect its private state and never asserts ready=true.
- **CLI cannot find Pi:** provide `--adapter-root` and the same literal `--mcp-config`, if used. Do not install a duplicate Pi SDK into the helper.
- **Key failure:** use `node /absolute/adapter/cli.js key status typesafe` locally. Doctor intentionally reports `keyStatus: not_checked`; it never reads credential files, environment secrets or the keyring.
- **Data policy denial:** declare every represented MCP source and authorize only known enabled servers. Sources are provenance, not a content filter or permission to share secrets.
- **File prioritization:** `mcpScript` has MCP tools and Jev, not Pi's native filesystem or shell. Use an already authorized MCP reader, or authorized bounded state outside that sandbox. Never pretend a local path is a working MCP source.
- **Print/headless use:** interactive commands require UI (TUI/RPC); use CLI `setup ... --enable`, `doctor`, `undo`, or offline `script` otherwise. No implicit consent.

## CI reference

`.github/workflows/ci.yml` uses official `actions/checkout@v4` and `actions/setup-node@v4`, a Node 22/24/26 matrix, `contents: read`, and no keys/publish jobs. Primary references: [workflow permissions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions), [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node). Release-specific hosted results are recorded in [GitHub Actions](https://github.com/IrrealV/jev-helper/actions), with anonymous public-tag installation proof in the [release notes](https://github.com/IrrealV/jev-helper/releases/tag/v0.1.0) after publication. Local tests and packed SDK checks are not substitutes for those records.
