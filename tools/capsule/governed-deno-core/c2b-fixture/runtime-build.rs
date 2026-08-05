// Copyright 2018-2026 the Deno authors. MIT license.

use deno_core::snapshot::CreateSnapshotOptions;
use deno_core::snapshot::create_snapshot;
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
  let output = create_snapshot(
    CreateSnapshotOptions {
      cargo_manifest_dir: env!("CARGO_MANIFEST_DIR"),
      startup_snapshot: None,
      skip_op_registration: false,
      extensions: vec![],
      extension_transpiler: None,
      with_runtime_cb: None,
    },
    None,
  )
  .expect("create exact three-op deno_core snapshot");

  let snapshot_path = PathBuf::from(env::var_os("OUT_DIR").unwrap())
    .join("capsule_core_snapshot.bin");
  fs::write(&snapshot_path, output.output).expect("write snapshot");
  println!(
    "cargo:rustc-env=CAPSULE_SNAPSHOT_PATH={}",
    snapshot_path.display()
  );
}
