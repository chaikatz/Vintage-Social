#!/usr/bin/env node
/**
 * After `expo export --platform web`, on Vercel only: the front door of
 * vintagesocial.app is the landing page (public/home.html), not the app's
 * own gate. The exported app moves to app.html, which vercel.json's
 * catch-all rewrite serves for every route the app owns (/sign-in, /apply,
 * /invite, …); the landing page takes index.html and answers "/".
 *
 * Local tooling (e2e/serve.mjs) serves dist/ as exported and is untouched.
 */
import { copyFileSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const app = `${dist}index.html`;
const home = `${dist}home.html`;
if (!existsSync(app)) throw new Error("dist/index.html is missing — run `npx expo export --platform web` first");
if (!existsSync(home)) throw new Error("dist/home.html is missing — public/home.html was not copied into the export");
renameSync(app, `${dist}app.html`);
copyFileSync(home, app);
console.log("web entry: / → landing page (home.html), app routes → app.html");
