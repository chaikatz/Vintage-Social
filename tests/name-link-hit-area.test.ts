import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A name or an @name is a link inside the words around it (NameLink, a
 * nested Text with onPress; MentionText's @names are NameLinks). On the
 * iPhone (React Native 0.81, the new architecture) the words are drawn at
 * the paragraph's content origin, inside its padding, but a finger is
 * matched to a character at the touch point taken from the paragraph's own
 * corner, with nothing taken off for the padding
 * (RCTParagraphComponentView touchEventEmitterAtPoint ->
 * RCTTextLayoutManager getEventEmitterWithAttributeString:frame:atPoint:).
 * In a Text padded 16 points from the left, every name's live area sat 16
 * points left of the name: its right part missed, and the words just
 * before an @name opened that member's page. So a Text that holds a name
 * link keeps its distance with margins, never padding, and the link sits
 * where it is drawn. Web walks cannot show this (the browser hit-tests the
 * drawn span), so it is held here, from the source.
 */

const root = path.resolve(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

/** Each <Text ...> whose words (up to its own </Text>) hold a name link, with its style prop. */
function textsHoldingLinks(source: string): { line: number; style: string }[] {
  const found: { line: number; style: string }[] = [];
  for (const open of source.matchAll(/<Text\b([^>]*?)>/g)) {
    if (open[1].trimEnd().endsWith("/")) continue;
    let depth = 1;
    let at = open.index + open[0].length;
    while (depth > 0) {
      const close = source.indexOf("</Text>", at);
      if (close === -1) break;
      const inner = source.slice(at, close).match(/<Text\b[^>]*?>/);
      if (inner && inner.index !== undefined && !inner[0].endsWith("/>")) {
        depth += 1;
        at += inner.index + inner[0].length;
      } else {
        depth -= 1;
        at = close + "</Text>".length;
      }
    }
    const words = source.slice(open.index + open[0].length, at);
    if (!/<NameLink\b|<MentionText\b|\bnameOf\(/.test(words)) continue;
    const style = open[1].match(/style=\{([^}]*)\}/)?.[1] ?? "";
    found.push({ line: source.slice(0, open.index).split("\n").length, style });
  }
  return found;
}

/** A sheet entry's body, one line or several. */
function rule(source: string, name: string): string | undefined {
  return (
    source.match(new RegExp(`\\n {2}${name}: \\{([^\\n]*)\\},`))?.[1] ??
    source.match(new RegExp(`\\n {2}${name}: \\{([\\s\\S]*?)\\n {2}\\},`))?.[1]
  );
}

describe("a Text that holds a name link", () => {
  const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))];
  const sites: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/NameLink|MentionText|nameOf\(/.test(source)) continue;
    for (const { line, style } of textsHoldingLinks(source)) {
      const where = `${path.relative(root, file)}:${line}`;
      sites.push(where);
      for (const [, name] of style.matchAll(/\bstyles\.(\w+)/g)) {
        it(`${where}: styles.${name} keeps its distance with margins, not padding`, () => {
          const body = rule(source, name);
          expect(body, `${where}: styles.${name} not found in its sheet`).toBeDefined();
          expect(body, `${where}: styles.${name}`).not.toMatch(/\bpadding\w*\s*:/);
        });
      }
      it(`${where}: no padding written into the Text's own style`, () => {
        expect(style).not.toMatch(/\bpadding\w*\s*:/);
      });
    }
  }

  it("is found where names are links: Home's cards, the pending card, a post's page, Comments, Activity, a thread", () => {
    const files = new Set(sites.map((s) => s.split(":")[0]));
    for (const f of [
      "src/components/PostCard.tsx",
      "src/components/PendingPostCard.tsx",
      "app/post/[id].tsx",
      "app/comments.tsx",
      "app/(tabs)/activity.tsx",
      "app/messages/[id].tsx",
      "app/admin/reports.tsx",
    ]) {
      expect(files.has(f), f).toBe(true);
    }
    expect(sites.length).toBeGreaterThanOrEqual(11);
  });
});
