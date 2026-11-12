// Builds the static, no-server demo into site/ (deployed to GitHub Pages by .github/workflows/pages.yml).
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const shims = {
  "node:fs": `export const existsSync = () => false; export const readFileSync = () => { throw new Error("no fs in browser"); }; export const writeFileSync = () => {}; export const mkdirSync = () => {};`,
  "node:path": `export const join = (...a) => a.join("/");`,
  "node:crypto": `export const randomUUID = () => crypto.randomUUID(); export const createHmac = () => { throw new Error("not in browser"); }; export const timingSafeEqual = () => false;`,
  "node:events": `export class EventEmitter { constructor(){ this._l = {}; } on(e,f){ (this._l[e] ||= []).push(f); return this; } off(e,f){ this._l[e] = (this._l[e]||[]).filter(x=>x!==f); return this; } emit(e,...a){ (this._l[e]||[]).forEach(f=>f(...a)); return true; } }`,
};

await build({
  entryPoints: ["src/web/browser.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: "site/app.js",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' },
  external: ["@photon-ai/imessage-kit"],
  plugins: [{
    name: "node-shims",
    setup(b) {
      b.onResolve({ filter: /^node:(fs|path|crypto|events)$/ }, (a) => ({ path: a.path, namespace: "shim" }));
      b.onLoad({ filter: /.*/, namespace: "shim" }, (a) => ({ contents: shims[a.path], loader: "js" }));
    },
  }],
});

mkdirSync("site", { recursive: true });
const html = readFileSync("public/sim.html", "utf8")
  .replace("<title>Wren Simulator</title>", "<title>Wren Simulator</title>\n<script src=\"app.js\"></script>");
writeFileSync("site/index.html", html);
// The presentation deck, served at /presentation/ (GitHub Pages maps the folder to index.html).
mkdirSync("site/presentation", { recursive: true });
writeFileSync("site/presentation/index.html", readFileSync("docs/presentation.html", "utf8"));
console.log("built site/index.html + site/app.js");
