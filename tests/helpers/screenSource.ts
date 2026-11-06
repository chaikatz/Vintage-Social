import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reading a screen's source, for the guards that only the source can
 * show (nothing here can render a screen).
 */

export const root = path.resolve(import.meta.dirname, "..", "..");

/** The file without its comments, so a sentence in a comment proves nothing. */
export function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The hooks the default-exported screen calls after its first early
 * return. A hook below an early return is called on some renders and not
 * others, and React throws ("Rendered fewer hooks than expected"): that was
 * "Sign out crashes the waitlist screen". Read from the component's own
 * statements, which the formatter indents by two spaces. Throws when the
 * screen has no default export or no early return, so a guard cannot pass
 * by finding nothing to look at.
 */
export function hooksAfterFirstReturn(src: string): string[] {
  const start = src.indexOf("export default function");
  if (start < 0) throw new Error("no default-exported screen");
  const lines = src.slice(start).split("\n");
  const end = lines.findIndex((l, i) => i > 0 && l === "}");
  const body = lines.slice(1, end < 0 ? undefined : end).filter((l) => /^ {2}\S/.test(l));
  const first = body.findIndex((l) => /^ {2}(if \(.*\) )?return\b/.test(l));
  if (first < 0) throw new Error("no early return to look behind");
  return body.slice(first + 1).filter((l) => /\b(React\.)?use[A-Z]\w*\(/.test(l));
}
