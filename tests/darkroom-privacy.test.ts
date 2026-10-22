import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the Darkroom never does, checked against its source.
 *
 * Everything the room reads stays on the phone: no location, no EXIF, no
 * Photos moments or albums, nothing fetched or logged, nothing sent to the
 * backend, and no ph:// prefetch (which would ask Photos for the full-size
 * image). The one place allowed to ask the library for an asset's details
 * is the fallback that finds a local file when the native module is absent,
 * and it may read only three of the answer's fields.
 *
 * Comments are stripped before matching — the doc comments say "no EXIF"
 * on purpose — and so are import paths, since develop.ts takes its date
 * check from `@/utils/exif`.
 */

const root = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const FILES = [
  path.join(root, "app/darkroom.tsx"),
  ...walk(path.join(root, "src/darkroom")),
  ...walk(path.join(root, "src/components/darkroom")),
];

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/from\s+["'][^"']+["']/g, 'from ""');
}

const FORBIDDEN: [string, RegExp][] = [
  ["location", /\.location\b|\blocation\s*:/],
  ["exif", /exif/i],
  ["moments", /getMomentsAsync/],
  ["albums", /getAlbums?Async|getAlbumAsync/],
  ["network", /\bfetch\s*\(|XMLHttpRequest|\baxios\b/],
  ["backend", /supabase/i],
  ["prefetch", /Image\.prefetch|\.prefetch\s*\(/],
  ["logging", /\bconsole\./],
  ["cursor", /\bafter\s*:/],
];

const ASSET_INFO = /getAssetInfoAsync|pairedVideoAsset/;
const LOCAL_FILE = path.join(root, "src/darkroom/localFile.ts");

describe("the Darkroom's privacy guard", () => {
  it("covers the room, its engine and its components", () => {
    const names = FILES.map((f) => path.relative(root, f));
    expect(names).toContain("app/darkroom.tsx");
    expect(names).toContain("src/darkroom/discovery.ts");
    expect(names).toContain("src/darkroom/develop.ts");
    expect(names).toContain("src/components/darkroom/PrintPage.tsx");
    expect(FILES.length).toBeGreaterThan(30);
  });

  it("reads no location, EXIF, moments or albums, sends and logs nothing, and pages without cursors", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      const source = code(file);
      for (const [name, rule] of FORBIDDEN) if (rule.test(source)) hits.push(`${path.relative(root, file)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it("asks for an asset's details only in the local-file fallback", () => {
    const hits = FILES.filter((f) => f !== LOCAL_FILE && ASSET_INFO.test(code(f))).map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });

  it("reads only localUri, isNetworkAsset and pairedVideoAsset from that answer, and never downloads for it", () => {
    const source = code(LOCAL_FILE);
    expect(source).toMatch(/getAssetInfoAsync\(\s*\w+\s*,\s*\{\s*shouldDownloadFromNetwork:\s*false\s*\}\s*\)/);
    const fields = new Set([...source.matchAll(/\binfo\??\.(\w+)/g)].map((m) => m[1]));
    for (const f of fields) expect(["localUri", "isNetworkAsset", "pairedVideoAsset"]).toContain(f);
    expect(fields.has("localUri")).toBe(true);
  });
});
