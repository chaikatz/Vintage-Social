#!/usr/bin/env node
/**
 * Writes public/privacy.html and public/terms.html from src/legal/documents.ts,
 * so the words on the web are the words in the app. Run after editing the
 * documents:  node scripts/build-legal.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../src/legal/documents.ts", import.meta.url), "utf8");
const pick = (name) => {
  const m = src.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`${name} not found`);
  return m[1];
};
const updated = src.match(/export const LEGAL_UPDATED = "([^"]+)"/)[1];

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const render = (text) =>
  text
    .trim()
    .split(/\n\n+/)
    .map((p) => (p.startsWith("## ") ? `<h2>${escape(p.slice(3))}</h2>` : `<p>${escape(p)}</p>`))
    .join("\n");

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · VINTAGE</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #FAF6EF; color: #2B2620; font: 16px/1.6 Georgia, "Times New Roman", serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 20px 80px; }
  .wordmark { font-size: 28px; letter-spacing: 6px; margin: 0 0 4px; }
  .eyebrow { font: 11px/1 "Courier New", monospace; letter-spacing: 2.4px; text-transform: uppercase; color: #9C927F; margin: 0 0 32px; }
  h1 { font-size: 26px; font-weight: normal; margin: 0 0 8px; }
  h2 { font-size: 18px; font-weight: normal; margin: 32px 0 8px; }
  p { margin: 0 0 14px; }
  hr { border: 0; border-top: 1px solid #E6DECF; margin: 40px 0 16px; }
  .foot { font: 10px/1.6 "Courier New", monospace; letter-spacing: 2px; text-transform: uppercase; color: #9C927F; }
  a { color: #A65B2A; }
</style>
</head>
<body>
<main>
  <p class="wordmark">VINTAGE</p>
  <p class="eyebrow">Members only · Est. 2026</p>
  <h1>${title}</h1>
  <p class="eyebrow">Last updated ${updated}</p>
  ${body}
  <hr>
  <p class="foot"><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a></p>
</main>
</body>
</html>
`;

writeFileSync(new URL("../public/privacy.html", import.meta.url), page("Privacy Policy", render(pick("PRIVACY_POLICY"))));
writeFileSync(new URL("../public/terms.html", import.meta.url), page("Terms of Use", render(pick("TERMS_OF_USE"))));
console.log("wrote public/privacy.html and public/terms.html");
