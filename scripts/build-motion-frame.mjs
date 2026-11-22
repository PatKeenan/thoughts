// Builds the sandboxed motion preview frame (no Next involved):
//   motion-frame/main.tsx + motion-frame/index.html → public/motion-frame.js + public/motion-frame.html
// Runs from the predev/prebuild npm hooks. Outputs are git-ignored.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outJs = path.join(root, "public", "motion-frame.js");
const outHtml = path.join(root, "public", "motion-frame.html");

const t0 = Date.now();
const result = await build({
  entryPoints: [path.join(root, "motion-frame", "main.tsx")],
  bundle: true,
  minify: true,
  format: "iife", // classic script: loads in an opaque-origin sandboxed iframe
  platform: "browser",
  target: ["es2020", "safari15"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  write: false,
  logLevel: "warning",
});
const js = result.outputFiles[0].contents;
const version = createHash("sha256").update(js).digest("hex").slice(0, 10);
const html = (await readFile(path.join(root, "motion-frame", "index.html"), "utf8")).replace("__VERSION__", version);

await mkdir(path.dirname(outJs), { recursive: true });
await writeFile(outJs, js);
await writeFile(outHtml, html);
console.log(`[motion-frame] public/motion-frame.js ${(js.length / 1024).toFixed(0)} KB (${version}) in ${Date.now() - t0} ms`);
