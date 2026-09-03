import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * The invitation page: https://<host>/i/<slug>
 *
 * This exists because a link-preview crawler does not run JavaScript. The
 * app's web build is a single-page bundle, so anything it renders is
 * invisible to iMessage — which is why an invitation used to arrive as a
 * grey bubble. Real HTML with real meta tags is the whole point of this
 * file.
 *
 * It says one thing the app could not: who invited you, before you have an
 * account. That is the reason to open it.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const CARD = "#3A322A";
const GOLD = "#D6BE94";
const GOLD_SOFT = "#B9A47E";
const PAPER = "#FAF6EF";

/** Never put untrusted text into HTML unescaped — a display name is chosen
 * by a member, and this page is served to strangers. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function lookup(slug: string): Promise<{ inviter: string | null; open: boolean }> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { inviter: null, open: false };

  const res = await fetch(`${url}/rest/v1/rpc/invite_link_owner`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!res.ok) return { inviter: null, open: false };
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { inviter: row?.inviter ?? null, open: Boolean(row?.open) };
}

function page({
  slug,
  inviter,
  open,
  install,
  origin,
}: {
  slug: string;
  inviter: string | null;
  open: boolean;
  install: string | null;
  origin: string;
}): string {
  const known = Boolean(inviter);
  const title = known ? `${inviter} invited you to VINTAGE` : "You're invited to VINTAGE";
  const description = known
    ? open
      ? "A members' club for photographs. Someone put your name forward."
      : "Every invitation they were given has since been taken up."
    : "A members' club for photographs, by invitation only.";

  const heading = known
    ? open
      ? `${escapeHtml(inviter!)} invited you to VINTAGE.`
      : `${escapeHtml(inviter!)} invited you — but every invitation they were given has since been taken up.`
    : "This invitation is no longer open.";

  // The app's own scheme, so someone who already has VINTAGE lands straight
  // on the card with the suffix filled in rather than retyping it.
  const appLink = `vintage://invite/${slug}`;

  // The card is the same for every invitation, so it is a static file
  // rather than something rendered per request: nothing to fail at the
  // moment a crawler asks for it. The URL must be absolute — a relative
  // og:image is silently dropped by several crawlers, iMessage included,
  // and an invitation without its card is the grey bubble this page
  // exists to avoid.
  //
  // Deliberately impersonal: the inviter's name is on the page, not baked
  // into the image. A name in the shared picture could be forged by
  // anyone who edits the URL before passing it on.
  const card = `${origin}/invite-card.png`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(`${origin}/i/${slug}`)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(card)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(card)}">
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: ${PAPER};
    display: flex; align-items: center; justify-content: center; padding: 24px;
    font-family: Georgia, 'Times New Roman', serif; color: #2B2620;
  }
  .card {
    position: relative; width: 100%; max-width: 420px; background: ${CARD};
    padding: 56px 32px 44px; text-align: center;
  }
  .card::before, .card::after {
    content: ''; position: absolute; border: 1px solid ${GOLD}; pointer-events: none;
  }
  .card::before { inset: 12px; }
  .card::after  { inset: 19px; border-color: ${GOLD_SOFT}; opacity: .7; }
  .eyebrow {
    font-family: ui-monospace, Menlo, monospace; font-size: 10px; letter-spacing: 2.6px;
    text-transform: uppercase; color: ${GOLD_SOFT};
  }
  .wordmark { font-size: 46px; color: ${GOLD}; margin: 10px 0 0; letter-spacing: 1px; }
  .rule { width: 46px; height: 1px; background: ${GOLD_SOFT}; margin: 22px auto; opacity: .7; }
  .blurb { color: ${GOLD_SOFT}; font-size: 16px; line-height: 1.55; margin: 0 8px 26px; }
  .cta {
    display: block; background: ${GOLD}; color: ${CARD}; text-decoration: none;
    font-family: ui-monospace, Menlo, monospace; font-size: 11px; letter-spacing: 2px;
    text-transform: uppercase; padding: 14px; margin: 0 8px;
  }
  .have { display: block; margin-top: 18px; color: ${GOLD_SOFT}; font-size: 13px; text-decoration: none; }
  .foot { color: ${GOLD_SOFT}; opacity: .65; font-size: 11px; margin-top: 26px;
          font-family: ui-monospace, Menlo, monospace; letter-spacing: 1.6px; }
  .code { display: block; margin-top: 10px; font-family: ui-monospace, Menlo, monospace;
          color: ${GOLD}; font-size: 15px; letter-spacing: 1px;
          /* A long suffix should wrap between characters rather than run off
             the card, but a short one must never be split mid-word. */
          overflow-wrap: anywhere; }
</style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">By invitation</div>
    <h1 class="wordmark">Vintage</h1>
    <div class="rule"></div>
    <p class="blurb">${heading}</p>
    ${
      open && install
        ? `<a class="cta" href="${escapeHtml(install)}">Get started</a>
           <a class="have" href="${escapeHtml(appLink)}">I already have VINTAGE</a>`
        : open
          ? `<a class="cta" href="${escapeHtml(appLink)}">Open VINTAGE</a>
             <p class="blurb" style="margin-top:22px;font-size:13px">
               VINTAGE is in private testing. If you do not have it yet, ask the member
               who invited you — your invitation is
               <span class="code">${escapeHtml(slug)}</span>
             </p>`
          : ""
    }
    <div class="foot">Members only · Est. 2026</div>
  </main>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = String(req.query.slug ?? "").trim().toLowerCase();
  const slug = SLUG.test(raw) ? raw : "";

  const { inviter, open } = slug ? await lookup(slug) : { inviter: null, open: false };
  const install = process.env.VINTAGE_INSTALL_URL ?? null;

  // Vercel sets x-forwarded-host to the host the visitor actually asked
  // for, which is what the crawler must be pointed back at — VERCEL_URL is
  // the deployment's own name and would break on a custom domain.
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  const proto = host.startsWith("localhost") ? "http" : "https";
  const origin = host ? `${proto}://${host}` : "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Short cache: an invitation can close at any moment, and a crawler
  // holding a stale "open" for a day is worse than a slightly slower page.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
  res.status(inviter ? 200 : 404).send(page({ slug, inviter, open, install, origin }));
}
