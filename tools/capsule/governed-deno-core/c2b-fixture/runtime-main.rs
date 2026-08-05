// Copyright 2018-2026 the Deno authors. MIT license.
// Fixed-fixture C2B development candidate. This is not a general runtime.

use deno_core::JsRuntime;
use deno_core::RuntimeOptions;
use deno_core::v8;
use serde_json::Value;
use serde_json::json;
use std::env;
use std::ffi::CString;
use std::fs;
use std::io;
use std::io::Write;

mod fixture_binding {
  include!("binding.rs");
}

const ALLOWED_OPS: [&str; 3] = [
  "op_get_ext_import_meta_proto",
  "op_get_extras_binding_object",
  "op_set_captured_bootstrap",
];
const OMITTED_OP_SAMPLES: [&str; 10] = [
  "op_compile_function",
  "op_eval_context",
  "op_import_sync",
  "op_load_ext_script",
  "op_memory_usage",
  "op_op_names",
  "op_panic",
  "op_print",
  "op_read",
  "op_write",
];

fn retained_utf8(
  bytes: &'static [u8],
  expected_length: usize,
  role: &str,
) -> Result<&'static str, String> {
  if bytes.len() != expected_length {
    return Err(format!(
      "{role} is not the exact retained C2A fixed fixture"
    ));
  }
  std::str::from_utf8(bytes)
    .map_err(|error| format!("{role} is not UTF-8: {error}"))
}

fn execute_string(
  runtime: &mut JsRuntime,
  name: &'static str,
  source: String,
) -> Result<String, String> {
  let value = runtime
    .execute_script(name, source)
    .map_err(|error| format!("JavaScript execution: {error}"))?;
  deno_core::scope!(scope, runtime);
  let local = v8::Local::new(scope, value);
  let string = local
    .to_string(scope)
    .ok_or_else(|| "JavaScript result is not string-coercible".to_string())?;
  Ok(string.to_rust_string_lossy(scope))
}

fn construction(runtime: &mut JsRuntime) -> Result<Value, String> {
  let raw = execute_string(
    runtime,
    "capsule:construction",
    r#"JSON.stringify({
          coreOps: Reflect.ownKeys(globalThis.Deno.core.ops).map(String).sort(),
          hasWorker: typeof globalThis.Worker !== "undefined",
          hasWebAssembly: typeof globalThis.WebAssembly !== "undefined"
        })"#
      .to_string(),
  )?;
  serde_json::from_str(&raw)
    .map_err(|error| format!("construction JSON: {error}"))
}

fn seal_core(runtime: &mut JsRuntime) -> Result<(), String> {
  execute_string(
        runtime,
        "capsule:seal",
        r#"(() => {
          delete globalThis.Deno;
          delete globalThis.__bootstrap;
          delete globalThis.console;
          for (const name of ["Atomics", "Date", "Intl", "SharedArrayBuffer", "Temporal"]) {
            delete globalThis[name];
            Object.defineProperty(globalThis, name, {
              value: undefined,
              writable: false,
              configurable: false,
              enumerable: false
            });
          }
          Object.defineProperty(globalThis, "Deno", {
            value: undefined,
            writable: false,
            configurable: false,
            enumerable: false
          });
          return "sealed";
        })()"#
            .to_string(),
    )?;
  Ok(())
}

fn disable_code_generation(runtime: &mut JsRuntime) -> Result<(), String> {
  let context = runtime.main_context();
  let isolate = &mut *runtime.v8_isolate();
  v8::scope!(scope, isolate);
  let context = v8::Local::new(scope, context);
  context.set_allow_generation_from_strings(false);
  if context.is_code_generation_from_strings_allowed() {
    return Err("V8 code generation from strings remains enabled".to_string());
  }
  Ok(())
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn descriptor_manifest() -> Result<Vec<i32>, String> {
  let mut descriptors = Vec::new();
  for entry in fs::read_dir("/proc/self/fd")
    .map_err(|error| format!("fd inventory: {error}"))?
  {
    let entry =
      entry.map_err(|error| format!("fd inventory entry: {error}"))?;
    let name = entry.file_name();
    let Some(name) = name.to_str() else {
      continue;
    };
    let Ok(fd) = name.parse::<i32>() else {
      continue;
    };
    let Ok(target) = fs::read_link(entry.path()) else {
      continue;
    };
    if target.to_string_lossy().ends_with("/fd") {
      continue;
    }
    descriptors.push(fd);
  }
  descriptors.sort_unstable();
  descriptors.dedup();
  Ok(descriptors)
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn stmt(code: u16, k: u32) -> libc::sock_filter {
  libc::sock_filter {
    code,
    jt: 0,
    jf: 0,
    k,
  }
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn jump(code: u16, k: u32, jt: u8, jf: u8) -> libc::sock_filter {
  libc::sock_filter { code, jt, jf, k }
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn install_host_seal() -> Result<Vec<i32>, String> {
  const BPF_LD_W_ABS: u16 = 0x20;
  const BPF_JMP_JEQ_K: u16 = 0x15;
  const BPF_JMP_JSET_K: u16 = 0x45;
  const BPF_RET_K: u16 = 0x06;
  const SECCOMP_RET_KILL_PROCESS: u32 = 0x8000_0000;
  const SECCOMP_RET_ERRNO: u32 = 0x0005_0000;
  const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;
  const AUDIT_ARCH_AARCH64: u32 = 0xc000_00b7;
  const SECCOMP_SET_MODE_FILTER: libc::c_uint = 1;
  const SECCOMP_FILTER_FLAG_TSYNC: libc::c_ulong = 1;
  const SECCOMP_DATA_NR: u32 = 0;
  const SECCOMP_DATA_ARCH: u32 = 4;
  const SECCOMP_DATA_ARG2_LOW: u32 = 16 + (2 * 8);

  let descriptors = descriptor_manifest()?;
  if descriptors != [0, 1, 2] {
    return Err(format!("unexpected inherited descriptors: {descriptors:?}"));
  }

  let limit = libc::rlimit {
    rlim_cur: 3,
    rlim_max: 3,
  };
  if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) } != 0 {
    return Err(format!("setrlimit: {}", std::io::Error::last_os_error()));
  }
  if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
    return Err(format!("no_new_privs: {}", std::io::Error::last_os_error()));
  }

  let errno = SECCOMP_RET_ERRNO | libc::EPERM as u32;
  let mut filter = vec![
    stmt(BPF_LD_W_ABS, SECCOMP_DATA_ARCH),
    jump(BPF_JMP_JEQ_K, AUDIT_ARCH_AARCH64, 1, 0),
    stmt(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
    stmt(BPF_LD_W_ABS, SECCOMP_DATA_NR),
  ];
  for syscall in [
    libc::SYS_clone,
    libc::SYS_clone3,
    libc::SYS_execve,
    libc::SYS_execveat,
    libc::SYS_socket,
    libc::SYS_socketpair,
  ] {
    filter.push(jump(BPF_JMP_JEQ_K, syscall as u32, 0, 1));
    filter.push(stmt(BPF_RET_K, errno));
  }
  for syscall in [libc::SYS_mmap, libc::SYS_mprotect] {
    filter.push(jump(BPF_JMP_JEQ_K, syscall as u32, 0, 3));
    filter.push(stmt(BPF_LD_W_ABS, SECCOMP_DATA_ARG2_LOW));
    filter.push(jump(BPF_JMP_JSET_K, libc::PROT_EXEC as u32, 0, 1));
    filter.push(stmt(BPF_RET_K, errno));
    filter.push(stmt(BPF_LD_W_ABS, SECCOMP_DATA_NR));
  }
  filter.push(stmt(BPF_RET_K, SECCOMP_RET_ALLOW));

  let program = libc::sock_fprog {
    len: filter.len().try_into().unwrap(),
    filter: filter.as_mut_ptr(),
  };
  let result = unsafe {
    libc::syscall(
      libc::SYS_seccomp,
      SECCOMP_SET_MODE_FILTER,
      SECCOMP_FILTER_FLAG_TSYNC,
      &program,
    )
  };
  if result != 0 {
    return Err(format!(
      "seccomp TSYNC: {}",
      std::io::Error::last_os_error()
    ));
  }
  Ok(descriptors)
}

#[cfg(not(all(target_os = "linux", target_arch = "aarch64")))]
fn install_host_seal() -> Result<Vec<i32>, String> {
  Err(
    "fixed-fixture candidate requires exact Linux/arm64 environment"
      .to_string(),
  )
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn exercise_restoration_mutation(name: &str) -> Result<Value, String> {
  let (result, expected_errno) = match name {
    "socket" => (
      unsafe {
        libc::syscall(libc::SYS_socket, libc::AF_INET, libc::SOCK_STREAM, 0)
      },
      libc::EPERM,
    ),
    "clone" => (
      unsafe { libc::syscall(libc::SYS_clone, libc::SIGCHLD, 0, 0, 0, 0) },
      libc::EPERM,
    ),
    "execve" => {
      let path = CString::new("/capsule-does-not-exist").unwrap();
      let argv = [path.as_ptr(), std::ptr::null()];
      let envp = [std::ptr::null::<libc::c_char>()];
      (
        unsafe {
          libc::syscall(
            libc::SYS_execve,
            path.as_ptr(),
            argv.as_ptr(),
            envp.as_ptr(),
          )
        },
        libc::EPERM,
      )
    }
    "exec-mmap" => {
      let pointer = unsafe {
        libc::mmap(
          std::ptr::null_mut(),
          4096,
          libc::PROT_READ | libc::PROT_EXEC,
          libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
          -1,
          0,
        )
      };
      (
        if pointer == libc::MAP_FAILED { -1 } else { 0 },
        libc::EPERM,
      )
    }
    _ => return Err(format!("unknown restoration mutation: {name}")),
  };
  let errno = std::io::Error::last_os_error().raw_os_error();
  if result != -1 || errno != Some(expected_errno) {
    return Err(format!(
      "restoration mutation {name} was not denied: result={result} errno={errno:?}"
    ));
  }
  Ok(json!({"mutation": name, "result": "denied", "errno": expected_errno}))
}

#[cfg(not(all(target_os = "linux", target_arch = "aarch64")))]
fn exercise_restoration_mutation(_name: &str) -> Result<Value, String> {
  Err("restoration mutation requires exact Linux/arm64 environment".to_string())
}

fn refuse_ambient_authority() -> Result<(), String> {
  if env::args_os().len() != 1 {
    return Err("caller arguments are not accepted".to_string());
  }
  if env::vars_os().next().is_some() {
    return Err("caller environment is not accepted".to_string());
  }
  Ok(())
}

fn main() -> Result<(), String> {
  refuse_ambient_authority()?;
  let source = retained_utf8(
    fixture_binding::SOURCE_BYTES,
    fixture_binding::SOURCE_LENGTH,
    "source",
  )?;
  let input_text = retained_utf8(
    fixture_binding::INPUT_BYTES,
    fixture_binding::INPUT_LENGTH,
    "input",
  )?;
  let input: Value = serde_json::from_str(&input_text)
    .map_err(|error| format!("input JSON: {error}"))?;

  let fixed_v8_flags = vec![
    "capsule-deno-core-c2b-fixed-fixture".to_string(),
    "--jitless".to_string(),
    "--random-seed=42".to_string(),
  ];
  let unrecognized = deno_core::v8_set_flags(fixed_v8_flags.clone());
  if unrecognized != vec![fixed_v8_flags[0].clone()] {
    return Err(format!("unrecognized V8 flags: {unrecognized:?}"));
  }

  static SNAPSHOT: &[u8] = include_bytes!(env!("CAPSULE_SNAPSHOT_PATH"));
  let mut runtime = JsRuntime::new(RuntimeOptions {
    startup_snapshot: Some(SNAPSHOT),
    skip_op_registration: true,
    extensions: vec![],
    module_loader: None,
    inspector: false,
    ..Default::default()
  });
  disable_code_generation(&mut runtime)?;
  let observed = construction(&mut runtime)?;
  let observed_ops = observed["coreOps"]
    .as_array()
    .ok_or("coreOps is not an array")?;
  let observed_names = observed_ops
    .iter()
    .map(|value| value.as_str().unwrap_or_default())
    .collect::<Vec<_>>();
  if observed_names != ALLOWED_OPS {
    return Err(format!("physical op registry mismatch: {observed_names:?}"));
  }
  for allowed in ALLOWED_OPS {
    if runtime.op_metadata(allowed).is_none() {
      return Err(format!("allowed op missing metadata: {allowed}"));
    }
  }
  for omitted in OMITTED_OP_SAMPLES {
    if runtime.op_metadata(omitted).is_some() {
      return Err(format!("omitted op retained metadata: {omitted}"));
    }
  }

  seal_core(&mut runtime)?;
  eprintln!("CAPSULE_HOST_SEAL_BEGIN");
  let descriptors = install_host_seal()?;
  eprintln!("CAPSULE_HOST_SEAL_ACTIVE");

  if let Some(mutation) = option_env!("CAPSULE_BUILD_RESTORATION_SYSCALL") {
    println!(
      "{}",
      serde_json::to_string(&exercise_restoration_mutation(mutation)?).unwrap()
    );
    return Ok(());
  }

  let manifest = json!({
      "schema": "capsule.deno-core.c2b-fixed-fixture.v1",
      "bindingIdentity": fixture_binding::BINDING_IDENTITY,
      "c1FixtureSha256": fixture_binding::C1_FIXTURE_SHA256,
      "c2aFixtureSha256": fixture_binding::C2A_FIXTURE_SHA256,
      "source": {
          "mediaType": fixture_binding::SOURCE_MEDIA_TYPE,
          "bytes": fixture_binding::SOURCE_LENGTH,
          "sha256": fixture_binding::SOURCE_SHA256,
      },
      "input": {
          "mediaType": fixture_binding::INPUT_MEDIA_TYPE,
          "bytes": fixture_binding::INPUT_LENGTH,
          "sha256": fixture_binding::INPUT_SHA256,
      },
      "completion": {
          "mediaType": fixture_binding::COMPLETION_MEDIA_TYPE,
          "bytes": fixture_binding::COMPLETION_LENGTH,
          "sha256": fixture_binding::COMPLETION_SHA256,
      },
      "denoCore": "0.409.0",
      "customSnapshot": true,
      "extensions": [],
      "builtinOps": observed_names,
      "moduleLoader": "none",
      "inspector": false,
      "v8Flags": fixed_v8_flags.into_iter().skip(1).collect::<Vec<_>>(),
      "hostSeal": {
          "linuxArm64": true,
          "noNewPrivileges": true,
          "seccompTsync": true,
          "descriptorLimit": 3,
          "inheritedDescriptors": descriptors,
          "denied": ["clone", "clone3", "execve", "execveat", "socket", "socketpair", "executable mmap", "executable mprotect"]
      },
      "observed": observed,
      "authority": {
          "fixedFixtureOnly": true,
          "arbitrarySource": false,
          "callerPaths": false,
          "callerArguments": false,
          "callerEnvironment": false,
          "runtimeSelection": false,
          "runtimeAdmission": false,
      }
  });
  eprintln!(
    "CAPSULE_RUNTIME_MANIFEST={}",
    serde_json::to_string(&manifest).unwrap()
  );

  let input_literal = serde_json::to_string(&input).unwrap();
  let input_literal_literal = serde_json::to_string(&input_literal).unwrap();
  let wrapper = format!(
    "{source}\nglobalThis.__capsule_result = JSON.stringify(await globalThis.capsuleMain(JSON.parse({input_literal_literal})));"
  );
  let specifier = deno_core::resolve_url("file:///capsule/main.mjs")
    .map_err(|error| format!("workload specifier: {error}"))?;
  let module_id = deno_core::futures::executor::block_on(
    runtime.load_main_es_module_from_code(&specifier, wrapper),
  )
  .map_err(|error| format!("module load: {error}"))?;
  let evaluation = runtime.mod_evaluate(module_id);
  deno_core::futures::executor::block_on(
    runtime.run_event_loop(Default::default()),
  )
  .map_err(|error| format!("event loop: {error}"))?;
  deno_core::futures::executor::block_on(evaluation)
    .map_err(|error| format!("module evaluation: {error}"))?;
  let output = execute_string(
    &mut runtime,
    "capsule:result",
    "globalThis.__capsule_result".to_string(),
  )?;
  let output_bytes = output.as_bytes();
  if output_bytes.len() > fixture_binding::PAYLOAD_MAXIMUM_BYTES {
    return Err(format!(
      "output exceeds {} bytes",
      fixture_binding::PAYLOAD_MAXIMUM_BYTES
    ));
  }
  if output_bytes.len() != fixture_binding::COMPLETION_LENGTH
    || output_bytes != fixture_binding::COMPLETION_BYTES
  {
    return Err("output is not the exact retained C2A completion".to_string());
  }
  io::stdout()
    .write_all(output_bytes)
    .map_err(|error| format!("completion write: {error}"))?;
  io::stdout()
    .flush()
    .map_err(|error| format!("completion flush: {error}"))?;
  Ok(())
}
