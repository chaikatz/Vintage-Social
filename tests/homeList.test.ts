import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Home's list, read from the source: how many cards it holds at once, and
 * when it asks for the next page.
 *
 * Every card held is a full-width photograph decoded in memory and, for a
 * clip, a player buffering it. The list's default holds ten screens of
 * cards either side of the reader and keeps the ten of its first draw for
 * good; Home now holds four screens either side and keeps four.
 */

function code(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const home = code("app/(tabs)/index.tsx");
const list = home.slice(home.indexOf("<FlatList"), home.indexOf("</Screen>"));

const constant = (name: string) => Number(home.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);

describe("Home's list", () => {
  it("holds four screens of cards either side of the reader, not the default ten", () => {
    expect(list).toMatch(/windowSize=\{HOME_WINDOW\}/);
    expect(constant("HOME_WINDOW")).toBe(9);
  });

  it("keeps only a first screen's worth of its first draw, and draws on a few cards at a time", () => {
    expect(list).toMatch(/initialNumToRender=\{HOME_FIRST_DRAW\}/);
    expect(list).toMatch(/maxToRenderPerBatch=\{HOME_BATCH\}/);
    expect(constant("HOME_FIRST_DRAW")).toBe(4);
    expect(constant("HOME_BATCH")).toBe(4);
  });

  it("asks for the next page two screens before the end, and only once at a time", () => {
    expect(list).toMatch(/onEndReachedThreshold=\{2\}/);
    expect(list).toMatch(/if \(feed\.hasNextPage && !feed\.isFetchingNextPage\) feed\.fetchNextPage\(\);/);
  });

  it("is not the profile grid, which draws three screens of squares either side, not the default ten", () => {
    const grid = code("src/components/PhotoGrid.tsx");
    const gridList = grid.slice(grid.indexOf("<FlatList"), grid.indexOf("export function PhotoTile("));
    expect(gridList).toMatch(/windowSize=\{GRID_SCREENS\}/);
    expect(Number(grid.match(/const GRID_SCREENS = (\d+);/)?.[1])).toBe(7);
  });

  it("keeps the grid's squares in memory, so a square scrolled back to is not read and decoded again", () => {
    // expo-image's own default is the disk alone (ImageModule.swift: cachePolicy ?? .disk).
    const grid = code("src/components/PhotoGrid.tsx");
    const tile = grid.slice(grid.indexOf("export function PhotoTile("));
    expect(tile.match(/<Image\b[\s\S]*?\/>/g)).toHaveLength(1);
    expect(tile.match(/<Image\b[\s\S]*?\/>/)?.[0]).toMatch(/cachePolicy="memory-disk"/);
  });

  it("fetches the first screen's photographs first", () => {
    expect(home).toMatch(/priority=\{index < FIRST_SCREEN \? "high" : "normal"\}/);
    expect(constant("FIRST_SCREEN")).toBe(2);
    expect(home).toMatch(/\(\{ item, index \}: \{ item: \(typeof posts\)\[number\]; index: number \}\) =>/);
  });
});
