globalThis.capsuleMain = () => ({
  Deno: typeof globalThis.Deno,
  bootstrap: typeof globalThis.__bootstrap,
  console: typeof globalThis.console,
  process: typeof globalThis.process,
  worker: typeof globalThis.Worker,
  webAssembly: typeof globalThis.WebAssembly,
  sharedArrayBuffer: typeof globalThis.SharedArrayBuffer,
  atomics: typeof globalThis.Atomics,
  date: typeof globalThis.Date,
  temporal: typeof globalThis.Temporal,
});
