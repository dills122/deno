// Copyright 2018-2026 the Deno authors. MIT license.
// Fixed-input source-governance verification only; this is not runtime admission.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const anchor = "14eea3160ae5834476aa3b9d317b8d41d991b982";
const toolRoot = dirname(fileURLToPath(import.meta.url));
const repository = join(toolRoot, "..", "..", "..");
const core = join(repository, "libs", "core");
const patchRoot = join(toolRoot, "patches");
const fixtureRoot = join(toolRoot, "fixtures");
const upstreamCiSource = join(
  repository,
  ".github",
  "workflows",
  "ci.ts",
);
const upstreamCiGenerated = join(
  repository,
  ".github",
  "workflows",
  "ci.generated.yml",
);
const governedCi = join(
  repository,
  ".github",
  "workflows",
  "capsule-governed-deno-core.yml",
);

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repository,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      `${command} ${
        args.join(" ")
      } failed (${result.status}):\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertSha256(relative, expected) {
  const path = join(toolRoot, relative);
  const actual = sha256(path);
  if (actual !== expected) {
    fail(`${relative} SHA-256 mismatch: expected ${expected}, got ${actual}`);
  }
}

function builtinOps(source) {
  const match = source.match(/builtin_ops! \{\n([\s\S]*?)\n\}/);
  if (!match) fail("built-in op registry was not found");
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean);
}

const mergeBase = run("git", ["merge-base", "HEAD", anchor]).trim();
if (mergeBase !== anchor) {
  fail(`HEAD is not based on exact Deno v2.9.4 anchor ${anchor}`);
}

const ciSource = readFileSync(upstreamCiSource, "utf8");
const ciGenerated = readFileSync(upstreamCiGenerated, "utf8");
const governedCiSource = readFileSync(governedCi, "utf8");
const governedBaseRef = "capsule/upstream-v2.9.4";
const governedHeadRef = "codex/governed-deno-core-0.409.0";
const c2bFixedFixtureHeadRef = "codex/c2b-fixed-fixture-runtime-0.409.0";
for (
  const expected of [
    governedBaseRef,
    governedHeadRef,
    c2bFixedFixtureHeadRef,
  ]
) {
  if (!ciSource.includes(expected) || !ciGenerated.includes(expected)) {
    fail(`governed CI routing is missing exact ref ${expected}`);
  }
}
for (const expected of [governedHeadRef, c2bFixedFixtureHeadRef]) {
  if (!governedCiSource.includes(expected)) {
    fail(`dedicated governed workflow is missing exact head ${expected}`);
  }
}
if (
  !ciSource.includes("Routing exact Capsule governed deno_core PR") ||
  !ciGenerated.includes("Routing exact Capsule governed deno_core PR")
) {
  fail("governed CI routing marker is missing");
}

const identities = new Map([
  [
    "patches/0001-physically-allowlist-bootstrap-ops.patch",
    "f45fda69db3875dbd730aa9568cb88ff6cc35a25c8d82edb5fa3b521c19bac37",
  ],
  [
    "patches/0002-canonicalize-snapshot-module-order.patch",
    "9dd33fd423ce98f030d80eba5cb386d5236b7ca103aa45b58ce5b36125d8061e",
  ],
  [
    "patches/mutations/restore-op-print.patch",
    "e0e98557b709437d464464922a3c4d4cc45af1832d32108d584cfe771125ee40",
  ],
  [
    "fixtures/nominal.js",
    "a236a49337021c709875a6e921910418f8801b78627e504aaf93a5bb636622ca",
  ],
  [
    "fixtures/input.json",
    "dcca912dd4ddd9c93c1efd3e6aecf33dd2d0c0ef75b36d0b8acf89cae752264a",
  ],
  [
    "fixtures/deno-core-seal.js",
    "470df9c208470e74a272ff4ba590a8072837e7e5f6b84122567b470815d90cb7",
  ],
  [
    "fixtures/static-import.js",
    "2313b778badd73558cb347f3f9bab9971ead6735658f2baf72e478f1f2189558",
  ],
  [
    "fixtures/dynamic-import.js",
    "4e0ad56d7973d258de1f9c95e35c3cd03d912b7d73f579835f37ab8428823c15",
  ],
  [
    "fixtures/nominal.ts",
    "69722494db25fe5c381f432c807f1350cd76bddf6af1537d13714fb45989df63",
  ],
  [
    "fixtures/refused-source.js",
    "45cab14f2cba12de9143963fc7b68c44bf87c7edbb583b8f94a5ed9fc332b91c",
  ],
  [
    "fixtures/refused-input.json",
    "2fbd3add3d9ad7c30442cdfe0720cbeb6b932b64ef14eaf902729591bff00d96",
  ],
]);
for (const [relative, expected] of identities) {
  assertSha256(relative, expected);
}

const expectedOps = [
  "ops_builtin_v8::op_get_extras_binding_object",
  "ops_builtin_v8::op_get_ext_import_meta_proto",
  "ops_builtin_v8::op_set_captured_bootstrap",
];
const opsSource = readFileSync(join(core, "ops_builtin.rs"), "utf8");
if (JSON.stringify(builtinOps(opsSource)) !== JSON.stringify(expectedOps)) {
  fail("governed built-in registry is not the exact ordered three-op registry");
}
if (opsSource.includes("use crate::ops_builtin_types;")) {
  fail("removed built-in type-op registry import was restored");
}

const moduleMapSource = readFileSync(
  join(core, "modules", "module_map_data.rs"),
  "utf8",
);
const canonicalOrder =
  ".sort_by(|left, right| left.0.as_str().cmp(right.0.as_str()));";
if (!moduleMapSource.includes(canonicalOrder)) {
  fail("snapshot module-name vector is not canonically ordered");
}

const scratch = mkdtempSync(join(tmpdir(), "capsule-deno-governance-"));
try {
  const scratchModules = join(scratch, "modules");
  mkdirSync(scratchModules);
  writeFileSync(
    join(scratch, "ops_builtin.rs"),
    run("git", ["show", `${anchor}:libs/core/ops_builtin.rs`]),
  );
  writeFileSync(
    join(scratchModules, "module_map_data.rs"),
    run("git", ["show", `${anchor}:libs/core/modules/module_map_data.rs`]),
  );

  const physicalPatch = join(
    patchRoot,
    "0001-physically-allowlist-bootstrap-ops.patch",
  );
  const orderingPatch = join(
    patchRoot,
    "0002-canonicalize-snapshot-module-order.patch",
  );
  run("git", ["apply", "--check", physicalPatch], { cwd: scratch });
  run("git", ["apply", physicalPatch], { cwd: scratch });
  run("git", ["apply", "--check", orderingPatch], { cwd: scratch });
  run("git", ["apply", orderingPatch], { cwd: scratch });

  if (
    readFileSync(join(scratch, "ops_builtin.rs"), "utf8") !== opsSource ||
    readFileSync(join(scratchModules, "module_map_data.rs"), "utf8") !==
      moduleMapSource
  ) {
    fail("governed source does not equal the exact ordered patch application");
  }

  run(
    "git",
    [
      "apply",
      "--check",
      join(patchRoot, "mutations", "restore-op-print.patch"),
    ],
    { cwd: scratch },
  );
  run(
    "git",
    ["apply", join(patchRoot, "mutations", "restore-op-print.patch")],
    { cwd: scratch },
  );
  const restoredOps = builtinOps(
    readFileSync(join(scratch, "ops_builtin.rs"), "utf8"),
  );
  if (
    restoredOps.length !== 4 ||
    restoredOps[1] !== "op_print" ||
    JSON.stringify(restoredOps.filter((op) => op !== "op_print")) !==
      JSON.stringify(expectedOps)
  ) {
    fail(
      "restoration mutation did not produce the exact refused four-op registry",
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const input = JSON.parse(readFileSync(join(fixtureRoot, "input.json"), "utf8"));
const nominalContext = vm.createContext({});
vm.runInContext(
  readFileSync(join(fixtureRoot, "nominal.js"), "utf8"),
  nominalContext,
  { filename: "nominal.js" },
);
const knownAnswer = JSON.stringify(nominalContext.capsuleMain(input));
const expectedKnownAnswer = '{"count":3,"label":"capsule-owned","sum":6}';
if (knownAnswer !== expectedKnownAnswer) {
  fail(`fixed nominal fixture mismatch: ${knownAnswer}`);
}

const sealContext = vm.createContext({
  Atomics: undefined,
  Date: undefined,
  Deno: undefined,
  SharedArrayBuffer: undefined,
  Temporal: undefined,
  WebAssembly: undefined,
  Worker: undefined,
  __bootstrap: undefined,
  console: undefined,
  process: undefined,
});
vm.runInContext(
  readFileSync(join(fixtureRoot, "deno-core-seal.js"), "utf8"),
  sealContext,
  { filename: "deno-core-seal.js" },
);
const sealAnswer = JSON.stringify(sealContext.capsuleMain());
const expectedSealAnswer =
  '{"Deno":"undefined","bootstrap":"undefined","console":"undefined","process":"undefined","worker":"undefined","webAssembly":"undefined","sharedArrayBuffer":"undefined","atomics":"undefined","date":"undefined","temporal":"undefined"}';
if (sealAnswer !== expectedSealAnswer) {
  fail(`fixed sealed-global fixture mismatch: ${sealAnswer}`);
}

const c2bFixtureVerification = run("node", [
  join(toolRoot, "c2b-fixture", "verify.mjs"),
]);

console.log(`upstream.anchor=${anchor}`);
console.log(`builtin.ops=${expectedOps.length}`);
console.log(`fixture.nominal=${knownAnswer}`);
console.log(`fixture.seal=${sealAnswer}`);
console.log("restoration.op_print=refused-four-op-registry");
console.log(c2bFixtureVerification.trim());
console.log("admission=none");
