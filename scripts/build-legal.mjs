#!/usr/bin/env node
/**
 * Writes public/privacy.html and public/terms.html from src/legal/documents.ts,
 * so the words on the web are the words in the app. Run after editing the
 * documents:  node scripts/build-legal.mjs   (or npm run build:legal)
 *
 * It also writes public/support.html, the page to give App Store Connect as
 * the Support URL (https://vintagesocial.app/support.html). Apple asks that
 * page for a way to reach a person, so it is only written once there is an
 * address to put on it, given once:
 *
 *   SUPPORT_EMAIL=you@yourdomain node scripts/build-legal.mjs
 *
 * After that the address is read back from the page itself, so a plain run
 * keeps the support page in step with the documents. Use the same address
 * as EXPO_PUBLIC_SUPPORT_EMAIL in the EAS production environment, which is
 * what Settings → Support shows in the app.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The documents and their date, read from the app's own source. */
export function readDocuments(src) {
  const pick = (name) => {
    const m = src.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`));
    if (!m) throw new Error(`${name} not found`);
    return m[1];
  };
  const updated = src.match(/export const LEGAL_UPDATED = "([^"]+)"/)?.[1];
  if (!updated) throw new Error("LEGAL_UPDATED not found");
  return { privacy: pick("PRIVACY_POLICY"), terms: pick("TERMS_OF_USE"), updated };
}

const render = (text) =>
  text
    .trim()
    .split(/\n\n+/)
    .map((p) => (p.startsWith("## ") ? `<h2>${escape(p.slice(3))}</h2>` : `<p>${escape(p)}</p>`))
    .join("\n");

const page = (title, eyebrow, body, foot) => `<!doctype html>
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
  <p class="eyebrow">${eyebrow}</p>
  ${body}
  <hr>
  <p class="foot">${foot}</p>
</main>
</body>
</html>
`;

const LEGAL_FOOT = `<a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a>`;

/** The two documents as the web serves them. */
export function renderLegalPages(src) {
  const docs = readDocuments(src);
  return {
    privacy: page("Privacy Policy", `Last updated ${docs.updated}`, render(docs.privacy), LEGAL_FOOT),
    terms: page("Terms of Use", `Last updated ${docs.updated}`, render(docs.terms), LEGAL_FOOT),
  };
}

const EMAIL = /^[^\s@<>"'`]+@[^\s@<>"'`.]+(\.[^\s@<>"'`.]+)+$/;

export function isSupportEmail(value) {
  return typeof value === "string" && EMAIL.test(value.trim());
}

/**
 * The support page: a person to write to, and the three things members
 * most often need, said the way the app says them.
 */
export function renderSupportPage(email) {
  const address = (email ?? "").trim();
  if (!isSupportEmail(address)) throw new Error(`not an email address: ${JSON.stringify(email)}`);
  const mail = escape(address);
  const subject = encodeURIComponent("VINTAGE support");
  const body = [
    `<p>Write to <a href="mailto:${mail}?subject=${subject}">${mail}</a>. A person reads every message.</p>`,
    `<p>Members can also write from the app: Profile → Settings (the gear, top right) → Support.</p>`,
    `<h2>Report or block</h2>`,
    `<p>Every photograph and every member’s profile has a “…” menu with Report; to report a comment, press and hold it. Reports are read by people and acted on within 24 hours. To block a member, open their profile → “…” → Block member; Settings → Blocked members undoes it.</p>`,
    `<h2>Delete your account</h2>`,
    `<p>Profile → Settings → Delete account, then confirm twice. Your profile, photographs, comments, likes, follows, tags, messages, application and share links, and the reports you filed, are removed. You do not need to write to us first.</p>`,
    `<p>If your application is still waiting or was not accepted, or your membership is suspended, the app opens on a screen that says so. Tap Delete my account there and confirm twice: everything above is removed in the same way. Or write to the address above from your account’s email and we will delete your account for you.</p>`,
    `<h2>Your privacy</h2>`,
    `<p>What VINTAGE keeps and why is in the <a href="/privacy">Privacy Policy</a>; the rules of the club are in the <a href="/terms">Terms of Use</a>.</p>`,
  ].join("\n");
  return page("Support", "Help from a person", body, LEGAL_FOOT);
}

/** The address a support page already carries, or null. */
export function supportAddressIn(html) {
  const m = html.match(/href="mailto:([^"?]+)/);
  if (!m) return null;
  const address = m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  return isSupportEmail(address) ? address : null;
}

function main() {
  const at = (rel) => new URL(`../${rel}`, import.meta.url);
  const pages = renderLegalPages(readFileSync(at("src/legal/documents.ts"), "utf8"));
  writeFileSync(at("public/privacy.html"), pages.privacy);
  writeFileSync(at("public/terms.html"), pages.terms);
  console.log("wrote public/privacy.html and public/terms.html");

  const flagAt = process.argv.indexOf("--support-email");
  const given = (flagAt >= 0 ? process.argv[flagAt + 1] : process.env.SUPPORT_EMAIL)?.trim() || null;
  const supportFile = at("public/support.html");
  const kept = existsSync(supportFile) ? supportAddressIn(readFileSync(supportFile, "utf8")) : null;
  const address = given ?? kept;
  if (given && !isSupportEmail(given)) {
    console.error(`SUPPORT_EMAIL is not an email address: ${given}`);
    process.exitCode = 1;
    return;
  }
  if (!address) {
    console.log(
      "no support page yet: run once with SUPPORT_EMAIL=you@yourdomain to write public/support.html (App Store Connect → Support URL)",
    );
    return;
  }
  writeFileSync(supportFile, renderSupportPage(address));
  console.log(`wrote public/support.html (${address})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
