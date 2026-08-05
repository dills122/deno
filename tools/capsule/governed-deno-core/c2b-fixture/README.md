# C2B fixed-fixture development candidate

Status: source-only development candidate; no guest execution or runtime
admission.

`generate.mjs` verifies the exact retained C1 and C2A contract objects before
deriving this directory's immutable binding and fixture bytes. The generated
binding permits only the retained C2A known answer and carries no authority for
caller-selected source, input, path, arguments, environment, module loading,
extensions, inspection, runtime selection, or admission.

The Rust sources are inputs to the controlled builder retained separately in
`Shrimpworks/capsule-experiments`. They are not a Deno product binary. The
runtime embeds the exact source and input, releases only the exact completion,
requires an empty environment and argument vector, and applies the existing
three-op, fixed-snapshot, jitless, descriptor, and syscall closures.

Regenerate or verify from an exact `capsule-corp` checkout:

```sh
node generate.mjs C1_FIXTURE C2A_FIXTURE check
node verify.mjs
```

Any changed predecessor, fixture, source, input, media, cap, runtime source,
patch, toolchain, or artifact creates a new candidate identity. Do not edit the
generated files directly.
