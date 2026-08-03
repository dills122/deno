# Capsule governed `deno_core` source line

Status: source-governance bootstrap only; **no runtime admission**.

This fork line defensively retains two reviewed `deno_core` 0.409.0 source
changes for Capsule. It is not a Deno release, an independently reproduced
builder result, a runtime profile, or authority to connect Capsule product code,
run arbitrary workloads, or deploy anything. `RUNTIME-001` remains unsupported.

## Scope and provenance

The baseline is official Deno v2.9.4 commit
`14eea3160ae5834476aa3b9d317b8d41d991b982`; the lightweight upstream tag
`v2.9.4` resolves to that exact commit. The corresponding Deno source archive
identity retained by Capsule is
`95f9d8361809f2d2f3ee2d8a6955951dcf96c2f4bbeb540c2d6fdd9363e6dc94`. The tree
contains `deno_core` 0.409.0. Capsule's retained crate identity is
`16b44f6f84139c39ec2f8d1b838412eb84ecaa9837103f7b12169896fd8778b4`.

The evidence was merged in `dills122/capsule-corp` as PR #43, commit
`54489437f75465f6ed7b9ef4477bc5557bf5b923`, and PR #50, commit
`cb987e1459663bf5be428655f8c350d3fdd556e0`. The exact retained artifacts are
copied under `tools/capsule/governed-deno-core/`; the verifier checks their
SHA-256 identities on every run.

## Ordered patch queue

Apply and review the queue in this order:

1. `patches/0001-physically-allowlist-bootstrap-ops.patch`, SHA-256
   `f45fda69db3875dbd730aa9568cb88ff6cc35a25c8d82edb5fa3b521c19bac37`. It
   reduces the sole built-in registry from 99 entries to exactly
   `op_get_extras_binding_object`, `op_get_ext_import_meta_proto`, and
   `op_set_captured_bootstrap`. Definitions remain in source, but the registry
   is physically reduced before registration.
2. `patches/0002-canonicalize-snapshot-module-order.patch`, SHA-256
   `9dd33fd423ce98f030d80eba5cb386d5236b7ca103aa45b58ce5b36125d8061e`. It sorts
   the existing module-name sidecar vector before serialization and does not
   change the snapshot format.

`patches/mutations/restore-op-print.patch`, SHA-256
`e0e98557b709437d464464922a3c4d4cc45af1832d32108d584cfe771125ee40`, is a
test-only mutation. It deliberately restores `op_print`, producing four registry
entries. It must never be included in the governed queue.

## Ownership and change policy

GitHub review ownership for the governed files is assigned to `@dills122` in
`.github/CODEOWNERS`. Capsule runtime engineering owns source rebases and build
reproduction; security architecture owns the prohibited-power contract and
restoration corpus; release/supply-chain ownership begins only when release work
is separately authorized. These role statements do not claim that a release
process or independent builder exists today.

Changes to either governed source file require all of the following:

- keep the two mechanisms as separately reviewable commits;
- record the old and new upstream commits and `deno_core` versions;
- regenerate each patch from reviewed source and record its new digest;
- review the complete diff, the central registration seam, snapshot format,
  fixed-fixture identities, and the restoration mutation;
- rerun registry/metadata and final-link evidence in the controlled builder;
- record source, snapshot, binary, and builder identities without claiming
  independence that was not demonstrated; and
- keep runtime admission, Capsule wiring, and release decisions in separate
  explicitly authorized reviews.

Rebase or update work stops if the registry is no longer centralized, the
three-op bootstrap behavior changes, serialization changes format, the
restoration mutation does not fail closed, or the bounded patch grows beyond the
reviewed mechanism. Do not work around such a stop condition by adding a loader,
extension, inspector, package manager, network, FFI, subprocess, Worker, native
addon, ambient filesystem access, or a V8 fork.

A patch may be removed only after an exact released upstream source replaces its
mechanism and the full bounded fixture, registry, final-link, restoration, and
reproducibility corpus passes on that replacement. An upstream merge alone is
not removal authority.

## Reproducible checks

The fork-local check is intentionally source- and fixed-fixture-scoped:

```sh
node tools/capsule/governed-deno-core/verify.mjs
git diff --check capsule/upstream-v2.9.4...HEAD
```

The verifier checks the exact upstream ancestor, patch and fixture hashes,
three-op registry, canonical module ordering, reverse applicability of both
retained patches, the four-op `op_print` restoration mutation, and the fixed
nominal JavaScript known answer:

```json
{ "count": 3, "label": "capsule-owned", "sum": 6 }
```

The same verifier runs in `.github/workflows/capsule-governed-deno-core.yml`
with read-only repository permissions. That dedicated workflow also runs the
canonical repository formatter, Rust formatting, and
`cargo check -p deno_core --locked` with the repository-pinned toolchain.

The ordinary upstream CI workflow remains unchanged for upstream-compatible
branches and pull requests. Its pre-build router skips full-Deno jobs only when
both sides of a pull request match this exact governed line:

- base: `capsule/upstream-v2.9.4`; and
- head: `codex/governed-deno-core-0.409.0`.

This exception is structural rather than cosmetic. Full Deno's `runtime_main`
snapshot imports omitted operations including
`op_set_format_exception_callback`, while upstream `deno_core` test snapshots
import omitted operations including `op_current_user_call_site`. Restoring those
operations would violate the governed three-op contract. The dedicated workflow
therefore owns this line's required merge checks and refuses any registry
expansion through the exact source, patch, fixture, and restoration oracles. Any
other base/head pair continues to run the complete upstream CI.

The retained Linux/arm64 controlled-builder result expected a 699,980-byte
snapshot with SHA-256
`ef5f1e7883bbf62a6422957ff0eea51a06d4b35cad1f47dc9c9ae137ab8dfa0b` and a
68,497,544-byte probe binary with SHA-256
`597baba6b9f50fc619ce667a352e19686f8c73efc6819d137b3c4081450fd6f5`. Those values
are retained known answers, not outputs produced by this CI.

## Bootstrap verification

On 2026-08-03, the fork-local source and fixture verifier passed. Two
already-retained clean same-host build bundles compared byte-for-byte and
matched the binary and snapshot identities above. The retained binary's final
link exposed exactly the three allowed built-in op symbols, and the full
fixed-fixture, prohibited-power, descriptor, syscall, and restored-`op_print`
corpus passed in the controlled network-disabled Linux/arm64 image.

This was a replay and comparison of retained controlled outputs. It did not
produce a fresh binary from this fork checkout and did not add an independent
builder or host.

## Current limitations

The fork bootstrap does not provide the original digest-pinned Linux/arm64
builder, its complete offline Cargo source bundle, the exact `rusty_v8` archive,
or a second independent builder/host. Consequently the fork-local CI does not
claim snapshot or binary byte reproduction, final-link proof, release
provenance, signing/notarization, complete V8 notice/source closure, external
isolation composition, or runtime admission. Those are explicit next
release/build tasks, not gaps to bypass in this source-governance PR.

The dedicated CI compiles the exact governed crate but does not run full-Deno or
upstream `deno_core` snapshot suites because those suites require operations the
governed construction deliberately excludes. A fork-native bounded runtime
build/test harness remains required before any release or admission review.
