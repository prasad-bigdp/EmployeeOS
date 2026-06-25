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
  // Bundle only the internal @employeeos/* workspace packages.
  // Everything else (real npm packages) must stay external so pnpm's
  // symlink structure doesn't cause CJS require() chains to get inlined
  // into the ESM bundle (which breaks dynamic require of punycode, etc.).
  noExternal: [/^@employeeos\/.*/],
  external: [
    // AI providers
    "@anthropic-ai/sdk",
    "openai",
    // Database
    "sql.js",
    "drizzle-orm",
    // Web server
    "fastify",
    "@fastify/cors",
    "@fastify/static",
    "@fastify/websocket",
    "ws",
    // Telegram — grammy pulls in node-fetch (CJS) → whatwg-url → punycode
    // which breaks when inlined into an ESM bundle
    "grammy",
    "node-fetch",
    "whatwg-url",
    "punycode",
    // Email
    "nodemailer",
    "imapflow",
    // Browser automation
    "playwright-core",
    "chromium-bidi",
    // MCP
    "@modelcontextprotocol/sdk",
    // Utilities
    "zod",
    "chalk",
    "commander",
    "inquirer",
    "ora",
    "papaparse",
    "pdf-parse",
    "pino",
  ],
});
