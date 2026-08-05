// Copyright 2018-2026 the Deno authors. MIT license.
// Static verification for the fixed-fixture C2B development candidate.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(fileURLToPath(import.meta.url));
const expected = new Map([
  [
    "binding.json",
    "41350bcfc854338ded5e62f77475daf86486351356104dbbf647a8f8b5f11946",
  ],
  [
    "binding.rs",
    "45bfc517757ddb7b8bfd3a7a71b788be76b55c491e7379b503e9ea1de8ff75f3",
  ],
  [
    "generate.mjs",
    "f773aaf4152bfb539d0a3c0e7dd462b96db7f028bbb7a5c9ce003f1658db81e2",
  ],
  [
    "fixtures/main.mjs",
    "c8e940feb89b342de2d5e6bd13c413226676de9a539fce34c4107516e635b475",
  ],
  [
    "fixtures/input.json",
    "9de0c909cfb111bd99c3b0b5f7a10972894270c2867022a71b6b6f3c0cd1af6e",
  ],
  [
    "fixtures/completion.json",
    "bb7234ee486b0fbccc2091859ec93499e6a14ea7d6e091cdef60a0e2a6e8371c",
  ],
  [
    "runtime-main.rs",
    "b61b93b5a595f352077d6bc8f52899b485f150796290e7a7d89cdfa9be27f02d",
  ],
  [
    "runtime-build.rs",
    "4a9726390723fb9a8300730e7fb778fda99b2c3f65e9106a91016afeee5732c4",
  ],
]);

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

for (const [relative, digest] of expected) {
  const actual = sha256(readFileSync(join(root, relative)));
  if (actual !== digest) fail(`${relative} SHA-256 mismatch: ${actual}`);
}

const binding = JSON.parse(readFileSync(join(root, "binding.json"), "utf8"));
if (
  binding.identity !==
    "capsule.governed-deno-core.c2b-fixed-fixture/c1-c2a-v1" ||
  binding.predecessors.c1.sha256 !==
    "d5d75e638a15be6c9f4a3230d17309d085f6ec103a73b64d9e0fd656a5423c9e" ||
  binding.predecessors.c2a.sha256 !==
    "d4ce88888186266f5d251e6246c889b1fd46d7746bb0ba56bcc4b3ce4675992f"
) {
  fail("fixture predecessor binding mismatch");
}
if (
  binding.source.mediaType !==
    "application/capsule.javascript-source;v=0;module=esm" ||
  binding.source.bytes !== 103 ||
  binding.input.mediaType !== "application/json" ||
  binding.input.bytes !== 36 ||
  binding.completion.mediaType !== "application/json" ||
  binding.completion.bytes !== 35
) {
  fail("fixed media or length binding mismatch");
}
if (
  binding.source.maximumBytes !== 262144 ||
  binding.input.maximumBytes !== 262144 ||
  binding.completion.maximumBytes !== 262144
) {
  fail("fixed C1/C2A caps mismatch");
}
if (
  binding.runtimeSurface.builtinOps.join(",") !==
    "op_get_ext_import_meta_proto,op_get_extras_binding_object,op_set_captured_bootstrap" ||
  binding.runtimeSurface.extensions.length !== 0 ||
  binding.runtimeSurface.moduleLoader !== "none" ||
  binding.runtimeSurface.inspector !== false ||
  binding.runtimeSurface.workloadBytes !==
    "embedded-exact-retained-c2a-fixture" ||
  binding.runtimeSurface.inheritedDescriptors.join(",") !== "0,1,2"
) {
  fail("fixed runtime-surface binding mismatch");
}
if (
  binding.authority.fixedFixtureOnly !== true ||
  binding.authority.arbitrarySource !== false ||
  binding.authority.callerPaths !== false ||
  binding.authority.callerArguments !== false ||
  binding.authority.callerEnvironment !== false ||
  binding.authority.runtimeSelection !== false ||
  binding.authority.runtimeAdmission !== false ||
  binding.authority.c2bGuestAuthorized !== false
) {
  fail("authority refusal mismatch");
}

const source = readFileSync(join(root, "fixtures", "main.mjs"));
const input = readFileSync(join(root, "fixtures", "input.json"));
const completion = readFileSync(join(root, "fixtures", "completion.json"));
const context = vm.createContext({});
vm.runInContext(source.toString("utf8"), context, { filename: "main.mjs" });
const actual = Buffer.from(
  JSON.stringify(context.capsuleMain(JSON.parse(input))),
);
if (!actual.equals(completion)) fail("fixed C2A known answer mismatch");

const runtime = readFileSync(join(root, "runtime-main.rs"), "utf8");
for (
  const seam of [
    "bytes.len() != expected_length",
    "{role} is not the exact retained C2A fixed fixture",
    "output is not the exact retained C2A completion",
    ".write_all(output_bytes)",
    "completion flush",
    "env::args_os().len() != 1",
    "env::vars_os().next().is_some()",
    "caller arguments are not accepted",
    "caller environment is not accepted",
    "startup_snapshot: Some(SNAPSHOT)",
    "extensions: vec![]",
    "module_loader: None",
    "inspector: false",
    '"--jitless"',
    "set_allow_generation_from_strings(false)",
    "descriptors != [0, 1, 2]",
    "libc::SYS_clone",
    "libc::SYS_execve",
    "libc::SYS_socket",
    "libc::PROT_EXEC",
    'option_env!("CAPSULE_BUILD_RESTORATION_SYSCALL")',
  ]
) {
  if (!runtime.includes(seam)) fail(`runtime refusal seam missing: ${seam}`);
}
for (
  const prohibited of [
    "deno-core-seal.js",
    "dynamic-import.js",
    "nominal.js",
    "nominal.ts",
    "static-import.js",
    'op_print".to_string()',
    '"--source"',
    '"--input"',
    "PathBuf",
    "CAPSULE_MUTATION_",
  ]
) {
  if (runtime.includes(prohibited)) {
    fail(`prohibited prior authority restored: ${prohibited}`);
  }
}

function acceptsFixture(candidate, retained, contract, mediaType) {
  return candidate.length <= contract.maximumBytes &&
    candidate.length === contract.bytes &&
    sha256(candidate) === contract.sha256 &&
    mediaType === contract.mediaType && candidate.equals(retained);
}

const capPlusOne = Buffer.alloc(262145, 0x61);
const mutations = [
  [
    "missing-source",
    Buffer.alloc(0),
    source,
    binding.source,
    binding.source.mediaType,
  ],
  [
    "wrong-source",
    Buffer.from("x"),
    source,
    binding.source,
    binding.source.mediaType,
  ],
  [
    "substituted-source",
    Buffer.from("globalThis.capsuleMain=()=>null;"),
    source,
    binding.source,
    binding.source.mediaType,
  ],
  [
    "source-cap-plus-one",
    capPlusOne,
    source,
    binding.source,
    binding.source.mediaType,
  ],
  ["source-media", source, source, binding.source, "text/javascript"],
  [
    "source-loader-request",
    Buffer.from('import "./replacement.mjs";'),
    source,
    binding.source,
    binding.source.mediaType,
  ],
  [
    "source-dynamic-loader-request",
    Buffer.from('await import("./replacement.mjs");'),
    source,
    binding.source,
    binding.source.mediaType,
  ],
  [
    "missing-input",
    Buffer.alloc(0),
    input,
    binding.input,
    binding.input.mediaType,
  ],
  [
    "wrong-input",
    Buffer.from("{}"),
    input,
    binding.input,
    binding.input.mediaType,
  ],
  [
    "substituted-input",
    Buffer.from('{"message":"capsule-c2a","value":22}'),
    input,
    binding.input,
    binding.input.mediaType,
  ],
  [
    "input-cap-plus-one",
    capPlusOne,
    input,
    binding.input,
    binding.input.mediaType,
  ],
  ["input-media", input, input, binding.input, "application/octet-stream"],
];
for (const [name, mutation, retained, contract, mediaType] of mutations) {
  if (acceptsFixture(mutation, retained, contract, mediaType)) {
    fail(`${name} unexpectedly passed the exact fixture contract`);
  }
}

for (
  const [name, retained, contract] of [
    ["source-digest", source, { ...binding.source, sha256: "0".repeat(64) }],
    [
      "source-length",
      source,
      { ...binding.source, bytes: binding.source.bytes + 1 },
    ],
    ["input-digest", input, { ...binding.input, sha256: "0".repeat(64) }],
    [
      "input-length",
      input,
      { ...binding.input, bytes: binding.input.bytes + 1 },
    ],
  ]
) {
  if (acceptsFixture(retained, retained, contract, contract.mediaType)) {
    fail(`${name} unexpectedly passed the exact fixture contract`);
  }
  mutations.push([name]);
}

for (
  const [name, restored, required] of [
    [
      "extension",
      runtime.replace("extensions: vec![]", "extensions: restored"),
      "extensions: vec![]",
    ],
    [
      "module-loader",
      runtime.replace("module_loader: None", "module_loader: restored"),
      "module_loader: None",
    ],
    [
      "inspector",
      runtime.replace("inspector: false", "inspector: true"),
      "inspector: false",
    ],
    [
      "jit",
      runtime.replace('"--jitless"', '"--no-jitless"'),
      '"--jitless"',
    ],
    [
      "code-generation",
      runtime.replace(
        "set_allow_generation_from_strings(false)",
        "set_allow_generation_from_strings(true)",
      ),
      "set_allow_generation_from_strings(false)",
    ],
    [
      "descriptor",
      runtime.replace(
        "descriptors != [0, 1, 2]",
        "descriptors != [0, 1, 2, 3]",
      ),
      "descriptors != [0, 1, 2]",
    ],
  ]
) {
  if (restored.includes(required)) {
    fail(`${name} restoration mutation did not alter its required closure`);
  }
  mutations.push([`restoration-${name}`]);
}

console.log(`binding.identity=${binding.identity}`);
console.log(
  `binding.sha256=${sha256(readFileSync(join(root, "binding.json")))}`,
);
console.log(`fixture.knownAnswer=${actual}`);
console.log(`fixture.mutations=${mutations.length}`);
console.log("runtime.fixedFixtureOnly=true");
console.log("runtime.admission=none");
console.log("guestExecution=NOT_RUN");
