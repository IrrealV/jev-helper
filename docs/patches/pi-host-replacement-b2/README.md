# Experimental Pi host replacement patch series

This is an unofficial, source-only review package for Pi **v0.87.1**. Eight ordered patches carry the prerequisite execution and invocation changes through B1 lifecycle admission to B2 replacement-veto handling. They are not an adopted upstream API, SDK release, installation, or activation mechanism. **B2 alone does not apply to vanilla Pi.**

## Review path

1. Check the archive identity and full [upstream MIT notice](LICENSE.pi).
2. Review the eight code-and-test units below in order, using [manifest.json](manifest.json) for exact file states and creation declarations.
3. Independently verify application and endpoint equality in a separate, user-owned checkout. Bounded filesystem application has passed in a fresh selected-source test copy, and all eight patch artifact units received native review approval with completed acknowledgements. Neither result establishes upstream adoption or reconstructed runtime portability.

| Stage | Review unit | Files changed | Source-line churn |
|---|---|---:|---:|
| 1 | [Execution extraction](patches/0001-execution-extraction.patch) | 4 | +690 / -208 |
| 2 | [Characterization tests](patches/0002-characterization-tests.patch) | 2 | +201 / -0 |
| 3 | [Neutral execution seam](patches/0003-neutral-execution-seam.patch) | 5 | +277 / -57 |
| 4 | [Invocation capability](patches/0004-invocation-capability.patch) | 8 | +631 / -44 |
| 5 | [Invocation guards](patches/0005-invocation-guards.patch) | 2 | +362 / -17 |
| 6 | [Execution origin](patches/0006-execution-origin.patch) | 6 | +399 / -19 |
| 7 | [Lifecycle admission (B1)](patches/0007-lifecycle-admission.patch) | 4 | +736 / -33 |
| 8 | [Replacement veto (B2)](patches/0008-replacement-veto.patch) | 5 | +653 / -156 |

Every stage depends on its immediate predecessor; stage 1 depends on the selected archive base. Stage 4 already contains the corrected capability implementation; there is no additional correction patch. Stage 8 changes three production files and creates two tests/fixtures. It preserves the other 18 final files unchanged. Keep these units separate for semantic review: text packaging does not reduce their review cost.

## Exact base and file integrity

| Identity | Value |
|---|---|
| Public archive | `v0.87.1.tar.gz` |
| Archive root | `pi-0.87.1` |
| Compressed archive SHA-256 | `c3902f45689af9ed9c8ee225554d31a649a993b06f04ab2022bb91ed75e808dc` |
| Upstream Git commit | **Not verified**; manifest `git_commit` is `null` |
| Full upstream LICENSE SHA-256 | `0457f5bcec3b3b211605dfb5d1a49042fd638f3686a410fe099c24a25af13c48` |
| Selected source inventory | 12 existing base files; 9 prerequisite creations; 2 B2 creations; 23 final files |

The archive identity is not a claim about a Git commit or all unselected archive members. Only the 23 public source paths and upstream LICENSE are selected for this package's source checks; no dependencies or entire archive tree were extracted during generation.

The manifest uses UTF-8 file byte lengths and SHA-256 of actual, unmodified bytes. `base_files` records all 23 paths: `state: null` means the path must be absent, not an empty file. Each stage lists touched files with `before` and `after` byte lengths and hashes, exact `declared_creations`, its predecessor, and the actual patch file byte length and hash. `final_files` records all 23 final source hashes. Source-line churn counts added/deleted hunk lines, not patch metadata or context.

Before applying anything, validate the archive hash, every existing base-file state and every declared base absence. Before each stage, validate touched preimages and creation absence; afterward validate its changed endpoints and unchanged carried files. Finally compare the full 23-file result with `final_files` and verify `LICENSE.pi` byte-for-byte. Refuse unexpected paths, symlinks, hardlinks, duplicate targets, unsupported modes, binary changes, or preimage drift. A future verifier must keep the fixed 23-path allowlist compiled into its own trusted code: manifest lists are data, never authority to read arbitrary paths.

## Manual application — separate checkout only

The following commands are documentation, **not executed verification**. First prepare a disposable, user-owned checkout matching the exact archive-selected base. Complete the integrity and absence checks above. Do not use the original prototype/source tree, an active Pi installation, or a checkout with unrelated changes. Set `USER_OWNED_PI_CHECKOUT` to that separate checkout yourself.

Starting in this package directory:

```sh
PATCH_DIR="$(pwd)"
(
  cd "$USER_OWNED_PI_CHECKOUT" || exit 1
  for patch in \
    0001-execution-extraction.patch \
    0002-characterization-tests.patch \
    0003-neutral-execution-seam.patch \
    0004-invocation-capability.patch \
    0005-invocation-guards.patch \
    0006-execution-origin.patch \
    0007-lifecycle-admission.patch \
    0008-replacement-veto.patch
  do
    git apply --check "$PATCH_DIR/patches/$patch" || exit 1
    git apply "$PATCH_DIR/patches/$patch" || exit 1
  done
)
```

The loop checks and applies each stage before checking its successor; checking stage 8 directly against vanilla Pi is invalid. Do not add whitespace-fixing, fuzzy, reject, or three-way options. `git apply --check` does not replace hash, file-kind, creation-absence, or final-endpoint verification. If a stage fails, stop: the disposable checkout may contain earlier stages. Do not repair by modifying the original source or evidence. Applying text does not install dependencies, run tests, activate dispatch, grant permissions, or prove runtime portability.

## What was and was not verified

| Evidence | Status and limits |
|---|---|
| Fresh generation checks | Compressed archive hash; 12 exact base/preimages; full license equality; seven strict prerequisite stages and touched/carried endpoints; B1 three production preimages; current 18-file carry closure; final 23-file equality |
| Canonical patches | All eight derived from actual before/after bytes with three context lines; explicit absent-file creations; strict in-memory replay equals each source endpoint |
| Privacy and structure | Generated payload/metadata scanned before writing; private source locations and historical diff labels are not copied into public headers; source bodies are not rewritten to sanitize them |
| Historical original-prototype checks | **13 B2 + 66 host + 81 core checks; TSC16 covering 2,401 inputs.** These are historical checks of the original prototype, not tests of a reconstructed checkout |
| Independent filesystem application and readback | **Passed in a fresh selected-source test copy**: all eight stages, 16 Git check/apply commands, 23 final byte-identical source files, and artifact hash/license/privacy readback. No reconstructed source was executed |
| Native patch artifact reviews | **Approved and acknowledged for all eight units** in the helper repository. Scope: the frozen patch artifacts, not upstream adoption, a general security certification, or execution of the reconstructed tree |
| Reconstructed-copy tests/typecheck | **Not run**; source reconstruction and artifact review do not establish dependency, compiler-default, or runtime portability |

The historical typecheck used **16 explicit roots**, an **ES2024 target**, an **ES2022 library**, and the existing **`skipLibCheck` setting preserved unchanged**. This package includes no checking stubs, compiler configurations, or model catalogs. A portable default upstream compiler/dependency setup has **neither been verified nor packaged**; the original typecheck results must not be treated as proof that a reconstructed checkout builds with its defaults.

The strict in-memory check uses only an exact plain-diff view: canonical Git metadata is removed and each explicitly declared `/dev/null` creation header is mapped back to its exact allowlisted path. It does not relax labels, whitespace, paths, context, or hunk positions. No source tree is reconstructed on disk by generation, and the original source and historical evidence remain untouched. No new runtime behavior is implemented by packaging, so there is no meaningful new RED test for this passive artifact step.

## Boundaries and remaining work

This package provides no automatic activation, SDK installation, JeV dispatch, permission grant, provider setup, operational credentials, network execution, or publication. Fixture keys such as `b2-faux-key` are intentionally synthetic source literals, not usable credentials.

Broader successful replacement-factory behavior, overlap handling, accounting, Gentle integration, an auto-evaluator, savings claims, and public/upstream acceptance remain pending. The focused historical B2 results do not close those questions. Independent application/endpoint verification passed for the selected-source test copy. Native reviews of the eight patch artifact units completed with the non-blocking follow-ups below. Reconstructed runtime checks, further execution, or publication need separate authorization.

### Non-blocking native review follow-ups

The approved artifact reviews did not open a correction. Their warnings remain follow-up work, not evidence that the full chain is unsafe or that these gaps are closed:

- Capability bootstrap (stage 4): executable snapshot semantics and liveness after policy evaluation should be assessed alongside the later guard/origin stages; do not treat the intermediate bootstrap as the final contract.
- Lifecycle admission (stage 7): expand coverage for overlapping failures.
- Replacement veto (stage 8): expand coverage for successful replacement and broader replacement paths.

## License

`LICENSE.pi` is the complete, verbatim upstream **MIT License**, copyright **2025 Mario Zechner**, retained with the derived source/test patches. Nothing here represents upstream adoption or endorsement.
