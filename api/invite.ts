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
 * account. That is the reason to open it. Above the words turns the same
 * V as the landing page (public/3d), so an invitation and the front door
 * are one thing.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

// The invitation is set on the same cream paper as the landing page, under
// the same turning V (public/3d), in the espresso ink the mark is cut from.
const PAPER = "#F9F5EC";
const INK = "#473D35";
const INK_SOFT = "rgba(71, 61, 53, .62)";
const INK_FAINT = "rgba(71, 61, 53, .42)";
const LINE = "rgba(71, 61, 53, .28)";

/**
 * three.js for the mark, served from this site (public/3d/vendor, r184) —
 * the same map public/home.html carries. It must precede any module script.
 */
const THREE_IMPORT_MAP = `<script type="importmap">
{
  "imports": {
    "three": "/3d/vendor/three.module.js",
    "three/addons/controls/OrbitControls.js": "/3d/vendor/OrbitControls.js"
  }
}
</script>`;

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

/**
 * An unknown link and a spent one look identical on purpose — the page
 * must not be usable to test whether a suffix exists. But a database this
 * page cannot reach is a different thing entirely, and collapsing the two
 * would mean a misconfigured deployment quietly answered 404 to every real
 * invitation. So the two are distinguished here and in the status code.
 */
type Lookup =
  | { state: "ok"; inviter: string | null; open: boolean }
  | { state: "unavailable" };

async function lookup(slug: string): Promise<Lookup> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { state: "unavailable" };

  try {
    const res = await fetch(`${url}/rest/v1/rpc/invite_link_owner`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { state: "unavailable" };
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { state: "ok", inviter: row?.inviter ?? null, open: Boolean(row?.open) };
  } catch {
    return { state: "unavailable" };
  }
}

function page({
  slug,
  inviter,
  open,
  install,
  origin,
  unavailable = false,
}: {
  slug: string;
  inviter: string | null;
  open: boolean;
  install: string | null;
  origin: string;
  unavailable?: boolean;
}): string {
  const known = Boolean(inviter);
  const title = known ? `${inviter} invited you to VINTAGE` : "You're invited to VINTAGE";
  const description = known
    ? open
      ? "A members' club for photographs. Someone put your name forward."
      : "Every invitation they were given has since been taken up."
    : "A members' club for photographs, by invitation only.";

  const heading = unavailable
    ? "This invitation cannot be checked just now. Try again in a moment."
    : known
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
${THREE_IMPORT_MAP}
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: ${PAPER}; color: ${INK}; }
  body { font: 400 17px/1.6 Georgia, "Times New Roman", serif; -webkit-font-smoothing: antialiased; }
  vintage-stage:not(:defined) { visibility: hidden; }
  vintage-stage { display: block; width: 100vw; height: 46vh; }
  main { max-width: 520px; margin: 0 auto; padding: 4px 28px max(40px, env(safe-area-inset-bottom)); text-align: center; }
  .eyebrow {
    font: 500 11px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
    letter-spacing: .28em; text-transform: uppercase; color: ${INK_SOFT};
  }
  h1 { font-weight: 400; font-size: clamp(21px, 2.4vw, 27px); line-height: 1.45; margin: 18px 0 30px; text-wrap: pretty; }
  .cta {
    display: inline-block; text-decoration: none;
    font: 500 13px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
    letter-spacing: .14em; text-transform: uppercase;
    color: ${PAPER}; background: ${INK}; border: 1px solid ${INK}; border-radius: 999px;
    padding: 16px 28px; transition: background .25s ease, color .25s ease;
  }
  .cta:hover { background: transparent; color: ${INK}; }
  .have { display: block; margin-top: 22px; color: ${INK_SOFT}; font-size: 15px; text-decoration: none; }
  .have:hover { color: ${INK}; }
  .note { color: ${INK_SOFT}; font-size: 15px; line-height: 1.6; margin: 26px 0 0; }
  .code { display: block; margin-top: 10px; font-family: ui-monospace, Menlo, monospace;
          color: ${INK}; font-size: 15px; letter-spacing: 1px;
          /* A long suffix should wrap between characters rather than run off
             the page, but a short one must never be split mid-word. */
          overflow-wrap: anywhere; }
  .foot {
    margin-top: 48px; padding-top: 22px; border-top: 1px solid ${LINE};
    font: 500 10px/2 "Helvetica Neue", Helvetica, Arial, sans-serif;
    letter-spacing: .24em; text-transform: uppercase; color: ${INK_FAINT};
  }
  .foot a { color: inherit; text-decoration: none; }
  @media (max-width: 600px) { vintage-stage { height: 42vh; } }
</style>
</head>
<body>
  <vintage-stage background="#f9f5ec" ink="#473D35" minimal aria-label="The VINTAGE mark, a serif V, turning"></vintage-stage>
  <main>
    <div class="eyebrow">By invitation</div>
    <h1>${heading}</h1>
    ${
      open && install
        ? `<a class="cta" href="${escapeHtml(install)}">Get started</a>
           <a class="have" href="${escapeHtml(appLink)}">I already have VINTAGE</a>`
        : open
          ? `<a class="cta" href="${escapeHtml(appLink)}">Open VINTAGE</a>
             <p class="note">
               VINTAGE is in private testing. If you do not have it yet, ask the member
               who invited you — your invitation is
               <span class="code">${escapeHtml(slug)}</span>
             </p>`
          : ""
    }
    <div class="foot">Members only · Est. 2026<br><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div>
  </main>
  <script src="/3d/stage.js"></script>
  <script type="module">
    import { mountVintageMark } from '/3d/mark.js';
    mountVintageMark(document.querySelector('vintage-stage'), { fill: 2.2 }).catch(() => {});
  </script>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = String(req.query.slug ?? "").trim().toLowerCase();
  const slug = SLUG.test(raw) ? raw : "";

  const found: Lookup = slug ? await lookup(slug) : { state: "ok", inviter: null, open: false };
  const unavailable = found.state === "unavailable";
  const inviter = found.state === "ok" ? found.inviter : null;
  const open = found.state === "ok" && found.open;
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
  // Never cache a failure — the deployment may be minutes from being fixed.
  res.setHeader("Cache-Control", unavailable ? "no-store" : "public, max-age=0, s-maxage=60");

  // 503, not 404: the link may well be real and we simply could not ask.
  const status = unavailable ? 503 : inviter ? 200 : 404;
  res.status(status).send(page({ slug, inviter, open, install, origin, unavailable }));
}
