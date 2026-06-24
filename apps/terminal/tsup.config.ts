import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  outDir: "dist",
  target: "node20",
  splitting: false,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Bundle all internal workspace packages into the single output file.
  noExternal: [/^@employeeos\/.*/],
  // playwright-core has optional native bindings that esbuild can't resolve.
  // Keep it external — users install it separately via `npx playwright install`.
  external: [
    "playwright-core",
    "chromium-bidi",
    "ws",
  ],
});
