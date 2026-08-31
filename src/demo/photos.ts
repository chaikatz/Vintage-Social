/**
 * Demo-mode media.
 *
 * Photographs ship with the app as bundled assets so the demo world looks
 * the same everywhere — on device, in the browser, and offline — with no
 * dependency on a third-party image host. They are real, openly licensed
 * works (CC0 / public domain), cropped to each post's aspect ratio.
 *
 * Avatars are generated rather than photographed: putting a real person's
 * face on a fictional member would misrepresent them.
 */

/** Paths stored on demo posts look like `demo:milan-tram`. */
export const DEMO_PREFIX = "demo:";

export function demoPhotoPath(seed: string): string {
  return DEMO_PREFIX + seed;
}


// --- generated avatars -----------------------------------------------------

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const AVATAR_PALETTES: { sky: [string, string]; mid: string; deep: string; glow: string }[] = [
  { sky: ["#cfd9e2", "#8fa3b4"], mid: "#414d55", deep: "#2b343a", glow: "#f2e6d2" },
  { sky: ["#f0dcc0", "#d8ab7e"], mid: "#7a5136", deep: "#4a3122", glow: "#fff1d8" },
  { sky: ["#dbe3d9", "#9fb098"], mid: "#4d5c47", deep: "#2f3a2c", glow: "#eef3e4" },
  { sky: ["#e6e0d4", "#b9ad99"], mid: "#635846", deep: "#3b3428", glow: "#f7f1e2" },
  { sky: ["#c9d5df", "#7e94a6"], mid: "#37474f", deep: "#212c33", glow: "#e8f0f5" },
  { sky: ["#f2d9c8", "#c99177"], mid: "#6b4133", deep: "#402720", glow: "#ffeada" },
];

/** A soft, deliberately abstract portrait, as an inline SVG data URI. */
export function demoAvatar(seed: string): string {
  const h = hash(seed);
  const p = AVATAR_PALETTES[h % AVATAR_PALETTES.length];
  const cx = (50 + ((h >> 4) % 14) - 7).toFixed(1);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 100 100">' +
    '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">' +
    `<stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/>` +
    '</linearGradient>' +
    '<filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>' +
    '</defs>' +
    '<rect width="100" height="100" fill="url(#b)"/>' +
    `<circle cx="${cx}" cy="42" r="19" fill="${p.mid}" opacity="0.9" filter="url(#s)"/>` +
    `<ellipse cx="${cx}" cy="98" rx="33" ry="26" fill="${p.deep}" opacity="0.85" filter="url(#s)"/>` +
    `<circle cx="${(Number(cx) - 12).toFixed(1)}" cy="30" r="16" fill="${p.glow}" opacity="0.22" filter="url(#s)"/>` +
    '</svg>';
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
