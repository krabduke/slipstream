// Bundles the engine into one ESM file that runs on a bare Node 22 with no
// node_modules: `node dist/engine.mjs`. The VPS has no Docker access, so the
// deploy is "copy one file". pg's optional native binding is left out on
// purpose (pure-JS driver). Source maps ship so stack traces stay readable.
import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
await build({
  entryPoints: [resolve(here, "src/main.ts")],
  outfile: resolve(here, "dist/engine.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  tsconfig: resolve(here, "../../tsconfig.json"),
  external: ["pg-native"],
  // CJS deps bundled into ESM still call require(); give them one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
})
