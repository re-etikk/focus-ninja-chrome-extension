// esbuild.config.mjs
// Bundles the extension for Manifest V3:
//  - resolves node_modules imports (the real "firebase" package) into
//    self-contained files — nothing is fetched from a CDN at runtime
//  - outputs classic (non-module) scripts so manifest.json can reference
//    them exactly like plain <script> / service_worker files
//  - copies every static asset (html/css/icons/manifest) into dist/ as-is
//
// Usage:
//   npm install       (downloads the real firebase package + esbuild)
//   npm run build      → one-off production build in dist/
//   npm run watch       → rebuilds on file changes during development
import esbuild from "esbuild";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes("--watch");

const ENTRY_POINTS = [
  "src/background.js",
  "src/content.js",
  "src/offscreen.js",
  "src/popup.js",
  "src/monitor.js",
];

async function copyStaticAssets() {
  await fs.emptyDir(path.join(__dirname, "dist"));
  await fs.copy(path.join(__dirname, "public"), path.join(__dirname, "dist"));
}

async function run() {
  await copyStaticAssets();

  const buildOptions = {
    entryPoints: ENTRY_POINTS,
    bundle: true,
    outdir: "dist",
    format: "iife",          // single self-contained classic script per entry
    target: ["chrome114"],
    platform: "browser",
    sourcemap: !isWatch ? false : "inline",
    minify: !isWatch,
    logLevel: "info",
    define: { "process.env.NODE_ENV": isWatch ? '"development"' : '"production"' },
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("👀 Watching for changes... (dist/ will rebuild automatically)");
  } else {
    await esbuild.build(buildOptions);
    console.log("✅ Build complete → dist/ (load this folder as an unpacked extension)");
  }
}

run().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
