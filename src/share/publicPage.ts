import { signatureDate } from "../utils/time";

/**
 * The page a stranger sees when they open a shared VINTAGE link.
 *
 * It is a piece of VINTAGE, not a pitch: the wordmark, the one photograph
 * the member chose to send out, whose archive it is from, when and where,
 * and two quiet lines about the club with a way to ask. Nothing else of
 * the member's is on it or reachable from it. Pure HTML from a small set
 * of fields, so it renders in a crawler as well as a phone and can be
 * tested without a server. Every value that came from a member passes
 * through `escapeHtml`. The picture is never an address in the store: it
 * is `/s/<token>/media`, served by our own function, which checks the
 * token again — so the page cannot leak a path, because it never has one.
 *
 * No imports from the app's React Native code: this runs in a Vercel
 * function.
 */

export interface SharedPhotograph {
  mediaType: "photo" | "video";
  /** A film has a still to show before it plays. */
  hasPoster: boolean;
  width: number | null;
  height: number | null;
  location: string | null;
  takenAt: string | null;
  createdAt: string;
  username: string;
}

export interface PublicPageInput {
  origin: string;
  token: string;
  photograph: SharedPhotograph | null;
  /** The database could not be reached: say so, rather than "no longer shared". */
  unavailable?: boolean;
}

const PAPER = "#FAF6EF";
const PAPER_SUNKEN = "#F3EDE2";
const INK = "#2B2620";
const INK_SOFT = "#6E655A";
const INK_FAINT = "#9C927F";
const BORDER = "#E6DECF";
const BUTTON = "#3F3C35";
const ON_BUTTON = "#F6F1E8";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `FROM CHAI’S ARCHIVE` — the possessive of a username, upper-cased. */
export function archiveLine(username: string): string {
  const name = username.trim().toUpperCase();
  return `FROM ${name}’S ARCHIVE`;
}

/** The lines under the photograph: date, then place. Absent things are absent. */
export function detailLines(p: Pick<SharedPhotograph, "takenAt" | "createdAt" | "location">): string[] {
  const lines: string[] = [];
  const when = p.takenAt ?? p.createdAt;
  if (when && !Number.isNaN(new Date(when).getTime())) lines.push(signatureDate(when).toUpperCase());
  const place = p.location?.trim();
  if (place) lines.push(place.toUpperCase());
  return lines;
}

/** The photograph's aspect for the frame, clamped as the app clamps it. */
export function frameRatio(width: number | null, height: number | null): number {
  if (!width || !height) return 1;
  return Math.min(Math.max(width / height, 4 / 5), 1.91);
}

export function publicSharePage({ origin, token, photograph, unavailable = false }: PublicPageInput): string {
  const p = photograph;
  const title = p ? `A photograph from ${p.username}’s archive · VINTAGE` : "VINTAGE";
  const description = "VINTAGE is a private social network for photographs worth keeping. Membership by invitation.";
  const url = `${origin}/s/${token}`;
  const mediaSrc = `${url}/media`;
  const posterSrc = p?.hasPoster ? `${url}/poster` : null;
  const ogImage = p ? (p.mediaType === "video" ? posterSrc ?? `${origin}/invite-card.png` : mediaSrc) : `${origin}/invite-card.png`;
  const ratio = p ? frameRatio(p.width, p.height) : 1;

  const picture = p
    ? p.mediaType === "video"
      ? `<video class="picture" src="${escapeHtml(mediaSrc)}"${posterSrc ? ` poster="${escapeHtml(posterSrc)}"` : ""} muted autoplay loop playsinline preload="metadata"></video>`
      : `<img class="picture" src="${escapeHtml(mediaSrc)}" alt="" loading="eager" decoding="async">`
    : "";

  const details = p ? detailLines(p) : [];

  const body = p
    ? `
    <figure class="frame" style="aspect-ratio:${ratio}">${picture}</figure>
    <div class="from">${escapeHtml(archiveLine(p.username))}</div>
    ${details.map((line) => `<div class="detail">${escapeHtml(line)}</div>`).join("\n    ")}`
    : `
    <p class="gone">${unavailable ? "This photograph cannot be shown just now. Try again in a moment." : "This photograph is no longer shared."}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: ${PAPER}; color: ${INK}; }
  body {
    min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    padding: max(28px, env(safe-area-inset-top)) 20px max(32px, env(safe-area-inset-bottom));
    font-family: Georgia, "Times New Roman", serif;
    -webkit-font-smoothing: antialiased;
  }
  main { width: 100%; max-width: 520px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .wordmark { font-size: 26px; letter-spacing: 9px; margin: 18px 0 0; font-weight: normal; }
  .wordmark + .rule { width: 24px; height: 1px; background: ${INK}; margin: 12px 0 40px; opacity: .85; }
  .frame {
    width: 100%; margin: 0; background: ${PAPER_SUNKEN}; overflow: hidden;
    box-shadow: 0 10px 30px rgba(43, 38, 32, .14);
  }
  .picture { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; animation: settle .6s ease-out forwards; }
  @keyframes settle { to { opacity: 1; } }
  .from {
    font-family: "Courier New", Courier, monospace; font-size: 11px; letter-spacing: 2.6px;
    color: ${INK_SOFT}; margin-top: 30px;
  }
  .detail {
    font-family: "Courier New", Courier, monospace; font-size: 11px; letter-spacing: 2.2px;
    color: ${INK_FAINT}; margin-top: 8px; line-height: 1.5; max-width: 420px;
  }
  .gone { font-size: 16px; line-height: 1.6; color: ${INK_SOFT}; margin: 40px 0 0; max-width: 320px; }
  .club { margin-top: 56px; padding-top: 32px; border-top: 1px solid ${BORDER}; width: 100%; max-width: 360px; }
  .club p { margin: 0; font-size: 17px; line-height: 1.6; color: ${INK}; }
  .club .by { margin-top: 12px; color: ${INK_SOFT}; font-size: 15px; }
  .ask {
    display: flex; align-items: center; justify-content: center; position: relative;
    margin: 28px 0 0; height: 46px; background: ${BUTTON}; color: ${ON_BUTTON}; text-decoration: none;
    font-family: "Courier New", Courier, monospace; font-size: 11px; letter-spacing: 3px; text-transform: uppercase;
  }
  .ask::after { content: "→"; position: absolute; right: 16px; font-family: Georgia, serif; font-size: 16px; }
  .have {
    display: inline-block; margin-top: 18px; color: ${INK}; text-decoration: none;
    font-family: "Courier New", Courier, monospace; font-size: 10px; letter-spacing: 2.4px; text-transform: uppercase;
    border-bottom: 1px solid ${INK}; padding-bottom: 3px;
  }
  .foot {
    margin-top: 44px; font-family: "Courier New", Courier, monospace; font-size: 9px; letter-spacing: 2.5px;
    text-transform: uppercase; color: ${INK_FAINT}; line-height: 2;
  }
  .foot a { color: inherit; text-decoration: none; }
</style>
</head>
<body>
  <main>
    <h1 class="wordmark">VINTAGE</h1>
    <div class="rule"></div>${body}

    <section class="club">
      <p>VINTAGE is a private social network<br>for photographs worth keeping.</p>
      <p class="by">Membership by invitation.</p>
      <a class="ask" href="${escapeHtml(`/s/${token}/request`)}">Request membership</a>
      <a class="have" href="/invite">I have an invitation</a>
    </section>

    <div class="foot">Members only · Est. 2026<br><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div>
  </main>
</body>
</html>`;
}
