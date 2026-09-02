#!/usr/bin/env node
/**
 * Curate the house photographs.
 *
 * Searches Wikimedia Commons theme by theme and keeps only images that are
 * public domain or CC0 — the licences that carry no attribution condition
 * and no share-alike obligation on a derivative. That matters here because
 * VINTAGE bakes a filter into what it shows, which makes every displayed
 * frame a derivative work: under CC BY-SA the app would inherit the
 * licence, and under CC BY every card would owe a visible credit.
 *
 * Nothing is invented. Each entry keeps the file it came from, its licence,
 * its author where one is recorded, and its capture date where the file
 * carries one, so seed/CREDITS.md can be generated from the same data.
 *
 *   node seed/curate.mjs            # writes seed/photos.json
 *   node seed/curate.mjs --limit 40 # smaller run while iterating
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isLikelyPhotograph } from "./photoFilter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const API = "https://commons.wikimedia.org/w/api.php";
// Wikimedia asks that automated traffic identify itself and a way to be
// contacted; this is polite, low-volume, and run by hand.
const UA = "VINTAGE-seed/1.0 (https://github.com/chaikatz/Vintage-Social)";

/** Licences with no attribution requirement and no share-alike. */
const FREE = /^(cc0|public domain|pd|no restrictions|cc pdm)/i;

/**
 * Kept short on purpose. Commons search negates against the whole
 * description, and photographers write "print", "portrait" and "poster"
 * about photographs all the time — a longer list threw away more real
 * photography than artwork. The precise work is done on the way back, by
 * isLikelyPhotograph.
 */
const NEGATIVE = "-painting -drawing -engraving -lithograph -woodcut -etching";

/**
 * Themes, and the caption voice each one is written in. `place` marks a
 * theme whose search term is a real location, so a post from it can carry
 * that location honestly; the rest leave the location blank rather than
 * claim somewhere the photograph was not taken.
 */
export const THEMES = [
  { key: "poolside", term: "swimming pool 1970s", place: null },
  { key: "poolside", term: "swimming pool mid-century modern", place: null },
  { key: "poolside", term: "hotel swimming pool 1960s", place: null },
  { key: "poolside", term: "lido swimming", place: null },
  { key: "desert", term: "Palm Springs mid-century", place: "Palm Springs" },
  { key: "desert", term: "Palm Springs architecture", place: "Palm Springs" },
  { key: "desert", term: "Joshua Tree National Park", place: "Joshua Tree" },
  { key: "riviera", term: "French Riviera beach", place: "Côte d'Azur" },
  { key: "riviera", term: "Saint-Tropez", place: "Saint-Tropez" },
  { key: "riviera", term: "Capri Italy", place: "Capri" },
  { key: "riviera", term: "Amalfi Coast", place: "Amalfi" },
  { key: "riviera", term: "Portofino", place: "Portofino" },
  { key: "sea", term: "sailing yacht 1960s", place: null },
  { key: "sea", term: "harbour boats Mediterranean", place: null },
  { key: "sea", term: "surfing 1970s", place: null },
  { key: "sea", term: "lighthouse coast", place: null },
  { key: "music", term: "jazz musician performing", place: null },
  { key: "music", term: "jazz club 1960s", place: null },
  { key: "music", term: "record shop interior", place: null },
  { key: "music", term: "vinyl records", place: null },
  { key: "music", term: "concert audience 1970s", place: null },
  { key: "music", term: "piano player", place: null },
  { key: "art", term: "art gallery interior visitors", place: null },
  { key: "art", term: "artist studio workshop", place: null },
  { key: "art", term: "darkroom photography", place: null },
  { key: "art", term: "neon sign night", place: null },
  { key: "art", term: "mural street wall", place: null },
  // DOCUMERICA and the FSA/OWI colour work are the closest thing Commons
  // has to the era this app is dressed as, and both are public domain.
  { key: "americana", term: "DOCUMERICA", place: null },
  { key: "americana", term: "DOCUMERICA beach", place: null },
  { key: "americana", term: "DOCUMERICA street", place: null },
  { key: "americana", term: "Farm Security Administration color photographs", place: null },
  { key: "americana", term: "diner interior 1970s", place: null },
  { key: "americana", term: "motel sign roadside", place: null },
  { key: "americana", term: "drive-in theater", place: null },
  { key: "clothing", term: "fashion photography 1970s", place: null },
  { key: "clothing", term: "tailor shop", place: null },
  { key: "clothing", term: "vintage clothing shop", place: null },
  { key: "clothing", term: "milliner hat shop", place: null },
  { key: "clothing", term: "shoemaker workshop", place: null },
  { key: "travel", term: "Kyoto street", place: "Kyoto" },
  { key: "travel", term: "Tokyo street night", place: "Tokyo" },
  { key: "travel", term: "Lisbon tram street", place: "Lisbon" },
  { key: "travel", term: "Venice canal", place: "Venice" },
  { key: "travel", term: "Rome street", place: "Rome" },
  { key: "travel", term: "Paris cafe", place: "Paris" },
  { key: "travel", term: "New York City street 1970s", place: "New York" },
  { key: "travel", term: "London street 1960s", place: "London" },
  { key: "travel", term: "Havana street", place: "Havana" },
  { key: "travel", term: "Marrakech", place: "Marrakech" },
  { key: "travel", term: "Istanbul street", place: "Istanbul" },
  { key: "travel", term: "Copenhagen harbour", place: "Copenhagen" },
  { key: "travel", term: "Mexico City street", place: "Mexico City" },
  { key: "travel", term: "Athens street", place: "Athens" },
  { key: "mountains", term: "ski resort 1960s", place: null },
  { key: "mountains", term: "alpine chalet snow", place: null },
  { key: "mountains", term: "mountain hiking trail", place: null },
  { key: "interiors", term: "mid-century modern living room", place: null },
  { key: "interiors", term: "library reading room", place: null },
  { key: "interiors", term: "hotel lobby 1960s", place: null },
  { key: "interiors", term: "bookshop interior", place: null },
  { key: "cars", term: "vintage car street", place: null },
  { key: "cars", term: "classic sports car", place: null },
  { key: "cars", term: "motorcycle 1970s", place: null },
  { key: "food", term: "cafe interior espresso", place: null },
  { key: "food", term: "market stall produce", place: null },
  { key: "food", term: "restaurant dining room 1960s", place: null },
  { key: "food", term: "wine cellar barrels", place: null },
  { key: "still", term: "film camera photograph", place: null },
  { key: "still", term: "typewriter desk photograph", place: null },
  { key: "still", term: "flowers window sunlight photograph", place: null },
  { key: "desert", term: "desert road photograph", place: null },
  { key: "desert", term: "Arizona landscape photograph", place: null },
  { key: "food", term: "market stall fruit photograph", place: null },
  { key: "food", term: "coffee cup table photograph", place: null },
  { key: "food", term: "vineyard harvest photograph", place: null },
  { key: "mountains", term: "Alps mountain photograph", place: null },
  { key: "mountains", term: "snow skiing photograph", place: null },
  { key: "sea", term: "beach summer photograph", place: null },
  { key: "sea", term: "swimmers sea photograph", place: null },
  { key: "cars", term: "car 1970s photograph", place: null },
  { key: "interiors", term: "living room 1970s photograph", place: null },
];

const argLimit = Number(process.argv[process.argv.indexOf("--limit") + 1]);
const PER_THEME = Number.isFinite(argLimit) && argLimit > 0 ? argLimit : 50;
const OFFSETS = [0, 50, 100];

async function search(term, offset) {
  const url =
    `${API}?action=query&format=json&generator=search&gsrnamespace=6` +
    `&gsrlimit=${PER_THEME}&gsroffset=${offset}` +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${term} ${NEGATIVE}`)}` +
    `&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1400`;
  // Commons occasionally accepts a connection and then never answers. A run
  // of 240 requests will meet that at least once, and with no deadline the
  // whole curation simply stops, with no error to show for it.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Commons ${res.status}`);
      const json = await res.json();
      return Object.values(json?.query?.pages ?? {});
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(`${lastError?.message ?? lastError} for "${term}"`);
}

/** extmetadata values arrive as HTML fragments often enough to matter. */
function plain(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function captureDate(em) {
  const raw = plain(em.DateTimeOriginal?.value) ?? plain(em.DateTime?.value);
  if (!raw) return null;
  const iso = raw.match(/(\d{4})[-:](\d{2})[-:](\d{2})/);
  if (!iso) return null;
  const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() < 1900 || date.getTime() > Date.now()) return null;
  return date.toISOString();
}

// --clean re-applies the photograph test to an existing photos.json without
// going back to Commons. The rules get sharper as junk turns up, and a full
// re-query takes half an hour.
/**
 * Contemporary photography, as a second source.
 *
 * Public-domain material skews archival — most of what is old enough to be
 * out of copyright was shot before 1930 — which is atmospheric but does not
 * look like a feed of people posting this year. Lorem Picsum publishes a
 * catalogue of about a thousand Unsplash photographs with stable ids; the
 * Unsplash licence permits commercial use with no attribution required, the
 * same freedom the public-domain material gives, and the pictures are
 * modern and in colour.
 *
 * There is no subject metadata, so these carry no location: better to say
 * nothing about where a photograph was taken than to guess.
 */
async function picsum() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=100`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) break;
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const item of batch) {
      // Crop to a feed-friendly shape rather than shipping a panorama.
      const ratio = Math.min(Math.max(item.width / item.height, 0.8), 1.5);
      const w = 1200;
      const h = Math.round(w / ratio);
      out.push({
        file: `Picsum ${item.id} by ${item.author}`,
        theme: "modern",
        place: null,
        url: `https://picsum.photos/id/${item.id}/${w}/${h}`,
        thumb: `https://picsum.photos/id/${item.id}/480/${Math.round(480 / ratio)}`,
        width: w,
        height: h,
        licence: "Unsplash Licence",
        author: item.author ?? null,
        takenAt: null,
        descriptionUrl: item.url ?? null,
      });
    }
  }
  return out;
}

if (process.argv.includes("--picsum")) {
  const file = join(here, "photos.json");
  const existing = JSON.parse(readFileSync(file, "utf8"));
  const modern = await picsum();
  const kept = existing.photos.filter((p) => p.theme !== "modern");
  const merged = { ...existing, photos: [...kept, ...modern] };
  writeFileSync(file, JSON.stringify(merged, null, 2));
  console.log(`${modern.length} contemporary photographs added (${merged.photos.length} in total)`);
  process.exit(0);
}

if (process.argv.includes("--clean")) {
  const file = join(here, "photos.json");
  const before = JSON.parse(readFileSync(file, "utf8"));
  const kept = before.photos
    .filter((p) => isLikelyPhotograph(p.file, ""))
    .map((p) => ({ ...p, url: p.url.split("?")[0], thumb: p.thumb.split("?")[0] }));
  writeFileSync(file, JSON.stringify({ ...before, photos: kept }, null, 2));
  const dropped = before.photos.length - kept.length;
  console.log(`${kept.length} kept, ${dropped} dropped as artwork or scans`);
  process.exit(0);
}

const seen = new Set();
const photos = [];

for (const theme of THEMES) {
  let kept = 0;
  for (const offset of OFFSETS) {
    let pages;
    try {
      pages = await search(theme.term, offset);
    } catch (err) {
      console.warn(`  ! ${theme.term} @${offset}: ${err.message}`);
      break;
    }
    if (pages.length === 0) break;

    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const em = info.extmetadata ?? {};
      const licence = plain(em.LicenseShortName?.value) ?? "";
      if (!FREE.test(licence.replace(/[-\s]+/g, " ").trim())) continue;
      // Portrait or squarish crops sit best in the feed; skip panoramas.
      if (!info.width || !info.height) continue;
      const ratio = info.width / info.height;
      if (ratio < 0.6 || ratio > 1.9) continue;
      if (seen.has(page.title)) continue;

      // Second pass at keeping artwork out, on everything the file says
      // about itself rather than on what the query asked for.
      if (!isLikelyPhotograph(page.title, plain(em.ObjectName?.value) ?? "")) continue;

      seen.add(page.title);

      const clean = (u) => (u ?? "").split("?")[0];
      photos.push({
        file: page.title,
        theme: theme.key,
        place: theme.place,
        url: clean(info.thumburl ?? info.url),
        thumb: clean(info.thumburl ?? info.url).replace("/1400px-", "/480px-"),
        width: info.thumbwidth ?? info.width,
        height: info.thumbheight ?? info.height,
        licence,
        author: plain(em.Artist?.value),
        takenAt: captureDate(em),
        descriptionUrl: info.descriptionurl ?? null,
      });
      kept++;
    }
  }
  console.log(`${String(kept).padStart(3)}  ${theme.key.padEnd(10)} ${theme.term}`);
}

const out = join(here, "photos.json");
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), photos }, null, 2));
const byTheme = photos.reduce((acc, p) => ({ ...acc, [p.theme]: (acc[p.theme] ?? 0) + 1 }), {});
console.log(`\n${photos.length} photographs kept`);
console.log(Object.entries(byTheme).map(([k, v]) => `${k}:${v}`).join("  "));
console.log(`→ ${out}`);
