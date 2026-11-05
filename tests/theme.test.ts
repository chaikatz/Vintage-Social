import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { colors, dark, light } from "@/theme";
import { GATE_BUTTON, GATE_ON_BUTTON } from "@/components/gate/palette";

// The theme reads the platform for its faces and its dynamic colours. Read
// as iOS, each dynamic colour comes back as its two prints, so both can be held.
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  DynamicColorIOS: (o: { light: string; dark: string }) => ({ light: o.light, dark: o.dark }),
}));

/**
 * The two prints. Light is the page VINTAGE has always been printed on,
 * held here to the letter. Dark is the page every phone's dark mode is:
 * black, white type, white marks, greys for everything quieter, and no
 * brown, cream or gold anywhere in it.
 */

type Token = keyof typeof colors;
type Print = { light: string; dark: string };

/** A token's two prints; a fixed colour is the same on both. */
function print(token: Token): Print {
  const c = colors[token] as unknown;
  return typeof c === "string" ? { light: c, dark: c } : (c as Print);
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG's contrast ratio. */
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const HEX = /^#[0-9A-F]{6}$/i;

describe("the light print", () => {
  it("is the one it has always been", () => {
    expect(light).toEqual({
      paper: "#FAF6EF",
      paperRaised: "#FFFDF8",
      paperSunken: "#F3EDE2",
      ink: "#2B2620",
      inkSoft: "#6E655A",
      inkFaint: "#9C927F",
      border: "#E6DECF",
      borderStrong: "#D5CBB8",
      accent: "#A65B2A",
      accentDeep: "#8C4A20",
    });
  });

  it("is what every token shows on paper, the ones added for black included", () => {
    const onPaper = Object.fromEntries((Object.keys(colors) as Token[]).map((t) => [t, print(t).light]));
    expect(onPaper).toEqual({
      ...light,
      wash: light.paperSunken,
      like: "#B3402E",
      danger: "#A03B2E",
      success: "#5C7048",
      badge: light.accent,
      card: "#3A322A",
      cardDeep: "#2F2821",
      gold: "#D6BE94",
      goldSoft: "#B9A47E",
      stamp: "#FFB03A",
      stampGlow: "rgba(255, 150, 40, 0.55)",
      shutter: "#1C1915",
      onShutter: "#F2EBDD",
      // The camera's two are the shutter's own on paper, and a knob is the raised paper.
      camera: "#1C1915",
      onCamera: "#F2EBDD",
      // A mark on a photograph in the feed keeps the off-white it was always drawn in.
      onPhoto: "#F6F1E8",
      knob: light.paperRaised,
    });
    expect((GATE_BUTTON as unknown as Print).light).toBe("#3F3C35");
    expect((GATE_ON_BUTTON as unknown as Print).light).toBe("#F6F1E8");
  });
});

describe("the dark print", () => {
  it("is a black page with white type and white marks", () => {
    expect(dark.paper).toBe("#000000");
    expect(dark.ink).toBe("#FFFFFF");
    expect(dark.accent).toBe("#FFFFFF");
    // Each token reads its plain string on black.
    for (const key of Object.keys(dark) as (keyof typeof dark)[]) {
      expect(print(key).dark, key).toBe(dark[key]);
      expect(print(key).light, key).toBe(light[key]);
    }
    // The one button is white with black on it; the door's inks trade places the same way.
    expect(print("shutter").dark).toBe("#FFFFFF");
    expect(print("onShutter").dark).toBe("#000000");
    expect((GATE_BUTTON as unknown as Print).dark).toBe("#FFFFFF");
    expect((GATE_ON_BUTTON as unknown as Print).dark).toBe("#000000");
    // The invitation card's ink is white on black, as the accent is.
    expect(print("gold").dark).toBe("#FFFFFF");
  });

  it("has no brown, cream or gold left in it", () => {
    // Only the colours that mean something keep a hue: the heart, danger, success, unread, the date stamp.
    const hued = new Set<Token>(["like", "danger", "success", "badge", "stamp", "stampGlow"]);
    const dyes = [
      ...(Object.keys(colors) as Token[]).filter((t) => !hued.has(t)).map((t) => [t, print(t).dark] as const),
      ["GATE_BUTTON", (GATE_BUTTON as unknown as Print).dark] as const,
      ["GATE_ON_BUTTON", (GATE_ON_BUTTON as unknown as Print).dark] as const,
    ];
    for (const [name, hex] of dyes) {
      expect(hex, name).toMatch(HEX);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      // A grey: no channel more than a few steps from the others (iOS's greys lean a hair blue).
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${name} ${hex}`).toBeLessThanOrEqual(5);
      expect(b, `${name} ${hex} leans warm`).toBeGreaterThanOrEqual(r);
    }
  });

  it("sets type at AA on the page and on a card, and the faintest at AA on the page", () => {
    for (const ink of ["ink", "inkSoft", "accent", "danger"] as const) {
      for (const ground of ["paper", "paperRaised"] as const) {
        expect(ratio(print(ink).dark, print(ground).dark), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(ratio(print("inkFaint").dark, print("paper").dark)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(print("inkFaint").dark, print("paperRaised").dark)).toBeGreaterThanOrEqual(4.5);
    // Secondary reads above tertiary, and both below the white.
    expect(luminance(dark.inkSoft)).toBeGreaterThan(luminance(dark.inkFaint));
    expect(luminance(dark.ink)).toBeGreaterThan(luminance(dark.inkSoft));
  });

  it("keeps what is set on a fill legible on it, on either print", () => {
    const pairs: [Token, Token][] = [
      ["onShutter", "shutter"],
      ["onCamera", "camera"],
      ["onPhoto", "camera"],
      ["gold", "card"],
    ];
    for (const [on, fill] of pairs) {
      for (const side of ["light", "dark"] as const) {
        expect(ratio(print(on)[side], print(fill)[side]), `${on} on ${fill}, ${side}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const side of ["light", "dark"] as const) {
      const g = ratio((GATE_ON_BUTTON as unknown as Print)[side], (GATE_BUTTON as unknown as Print)[side]);
      expect(g, side).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lifts its surfaces off the black, and draws its rules where they can be seen", () => {
    const d = (t: Token) => print(t).dark;
    expect(ratio(d("paperRaised"), d("paper"))).toBeGreaterThanOrEqual(1.2);
    // A well shows on the page and on a card both.
    expect(ratio(d("paperSunken"), d("paper"))).toBeGreaterThanOrEqual(1.4);
    expect(ratio(d("paperSunken"), d("paperRaised"))).toBeGreaterThanOrEqual(1.2);
    // The quiet grey rule under a photograph, and the stronger one above a print's label.
    expect(ratio(d("border"), d("paper"))).toBeGreaterThanOrEqual(1.6);
    expect(ratio(d("borderStrong"), d("paper"))).toBeGreaterThan(ratio(d("border"), d("paper")));
    // The card's edge is what draws it on the black.
    expect(ratio(d("goldSoft"), d("paper"))).toBeGreaterThanOrEqual(3);
    // An unread notice is washed, not filled: seen on the black, and a page of them still a black page.
    expect(ratio(d("wash"), d("paper"))).toBeGreaterThanOrEqual(1.1);
    expect(ratio(d("wash"), d("paper"))).toBeLessThan(ratio(d("paperRaised"), d("paper")));
  });

  it("marks with colour where white would be lost", () => {
    const d = (t: Token) => print(t).dark;
    // The heart is red, and reads on the page.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(d("like").slice(i, i + 2), 16));
    expect(r).toBe(255);
    expect(Math.max(g, b)).toBeLessThan(96);
    expect(ratio(d("like"), d("paper"))).toBeGreaterThanOrEqual(3);
    // The unread dot sits on the white letter-tray icon: it must show against the white as well as the black.
    expect(ratio(d("badge"), d("ink"))).toBeGreaterThanOrEqual(3);
    expect(ratio(d("badge"), d("paper"))).toBeGreaterThanOrEqual(3);
    // A switch: the off knob shows on the grey track, the on knob on the white one.
    expect(ratio(d("knob"), d("borderStrong"))).toBeGreaterThanOrEqual(3);
    expect(ratio(d("paperRaised"), d("accent"))).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Where the tokens are used
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every .ts and .tsx under the app and src, outside the Memory Room's own files. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, name);
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(name)) out.push(rel);
    }
  };
  walk("app");
  walk("src");
  return out.filter(
    (f) => !f.startsWith("src/components/darkroom/") && !f.startsWith("src/darkroom/") && f !== "app/darkroom.tsx",
  );
}

/** One named style's body, from `name: {` to its closing brace. */
function style(src: string, name: string): string {
  const start = src.search(new RegExp(`\\n\\s*${name}: \\{`));
  expect(start, name).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return "";
}

describe("the black page", () => {
  it("runs under the screens, the header and the tab bar", () => {
    const stack = code("app/_layout.tsx");
    expect(stack).toMatch(/headerStyle: \{ backgroundColor: colors\.paper as unknown as string \}/);
    expect(stack).toMatch(/contentStyle: \{ backgroundColor: colors\.paper \}/);
    const tabs = code("app/(tabs)/_layout.tsx");
    expect(style(tabs, "header")).toMatch(/backgroundColor: colors\.paper,/);
    expect(style(tabs, "bar")).toMatch(/backgroundColor: colors\.paper,/);
    expect(tabs).toMatch(/sceneStyle: \{ backgroundColor: colors\.paper \}/);
  });

  it("is what the Settings page says it is", () => {
    const settings = code("app/settings.tsx");
    expect(settings).toMatch(/The same page, printed light or on black\./);
    expect(settings).not.toMatch(/brown/i);
  });

  it("is the launch screen's colour on a phone set to Dark, with a splash image or without one", () => {
    const expo = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8")).expo;
    // The launch screen follows the phone's appearance only while the app does.
    expect(expo.userInterfaceStyle).toBe("automatic");
    expect(expo.ios.userInterfaceStyle ?? expo.userInterfaceStyle).toBe("automatic");
    // With no splash image, prebuild leaves the launch storyboard on the
    // system background: white on Light, black on Dark. Once an image is
    // set, the storyboard paints this colour set instead, and with no dark
    // value in it a phone set to Dark would launch white. So the dark value
    // is here already: black, the app's own page; the light one white, as
    // the launch has always been.
    expect(expo.ios.splash.dark.backgroundColor).toBe("#000000");
    expect(expo.ios.splash.dark.backgroundColor).toBe(dark.paper);
    expect(expo.ios.splash.backgroundColor).toBe("#FFFFFF");
    // And that is what prebuild makes of it: Expo's own iOS splash config,
    // resolved as the CLI resolves it. Without ios.splash it has no dark
    // value at all.
    const fromExpo = createRequire(createRequire(path.join(root, "package.json")).resolve("expo/package.json"));
    const fromCli = createRequire(fromExpo.resolve("@expo/cli/package.json"));
    const { getIosSplashConfig } = fromCli(
      "@expo/prebuild-config/build/plugins/unversioned/expo-splash-screen/getIosSplashConfig",
    ) as { getIosSplashConfig: (c: unknown, p: null) => { backgroundColor: string; dark?: { backgroundColor?: string } } };
    const launch = getIosSplashConfig(expo, null);
    expect(launch.backgroundColor).toBe("#FFFFFF");
    expect(launch.dark?.backgroundColor).toBe("#000000");
    expect(getIosSplashConfig({}, null).dark).toBeUndefined();
  });
});

describe("the tokens, where they are used", () => {
  const files = sources();

  it("leaves no brown dark-print value and no plain dark string outside the theme and the print", () => {
    const old = /#(3B2C27|47362F|2F221E|F6ECDF|DDC7AC|B39A80|52403A|74604F|D4B48F|B08E67|261B17|F3E6D3|E07A6A|E28A7A|9DB48A)\b/i;
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(old);
      // A plain dark string would print the black page on Light too; only the export's own print takes one.
      if (f !== "src/theme/index.ts" && f !== "src/components/ExportCard.tsx") expect(src, f).not.toMatch(/\bdark\.(paper|ink|border|accent)\w*/);
    }
  });

  it("gives every switch a knob that shows on its track, off and on", () => {
    let seen = 0;
    for (const f of files) {
      for (const sw of code(f).match(/<Switch\b[\s\S]*?\/>/g) ?? []) {
        seen++;
        const value = sw.match(/value=\{([^}]+)\}/)?.[1];
        expect(value, f).toBeTruthy();
        expect(sw, f).toMatch(/trackColor=\{\{ true: colors\.accent, false: colors\.borderStrong \}\}/);
        expect(sw, f).toContain(`thumbColor={${value} ? colors.paperRaised : colors.knob}`);
      }
    }
    expect(seen).toBe(3);
  });

  it("sets the shutter's ink only on the shutter, and the camera's on a photograph", () => {
    for (const f of files) {
      const src = code(f);
      if (/colors\.onShutter\b/.test(src)) expect(src, f).toMatch(/colors\.shutter\b/);
    }
    const compose = code("app/compose.tsx");
    expect(style(compose, "preview")).toMatch(/backgroundColor: colors\.camera,/);
    expect(style(compose, "previewFilmText")).toMatch(/color: colors\.onCamera,/);
    expect(compose.match(/<Feather [^>]*color=\{colors\.onCamera\} \/>/g)).toHaveLength(2);
    const inspector = code("src/components/PhotoInspector.tsx");
    expect(style(inspector, "sound")).toMatch(/backgroundColor: colors\.camera,/);
    expect(inspector).toMatch(/size=\{15\} color=\{colors\.onCamera\} \/>/);
    for (const f of ["app/memories.tsx", "app/library-picker.tsx"]) {
      expect(code(f), f).toMatch(/<ActivityIndicator color=\{colors\.onCamera\} \/>/);
    }
  });

  it("draws the feed's marks on a photograph white on black, not a fixed cream", () => {
    expect(print("onPhoto").dark).toBe("#FFFFFF");
    const media = code("src/components/PostMedia.tsx");
    // The double-tap heart, the stalled film's play mark and the sound control.
    expect(media).toMatch(/<MaterialCommunityIcons name="heart" size=\{92\} color=\{colors\.onPhoto\} \/>/);
    expect(media).toMatch(/<Feather name="play" size=\{22\} color=\{colors\.onPhoto\} \/>/);
    expect(media).toMatch(/<Feather name=\{muted \? "volume-x" : "volume-2"\} size=\{15\} color=\{colors\.onPhoto\} \/>/);
    expect(media).not.toMatch(/#F6F1E8/i);
  });

  it("marks a letter unread in the badge's colour, on the tray's icon and in the list", () => {
    expect(style(code("app/(tabs)/_layout.tsx"), "badge")).toMatch(/backgroundColor: colors\.badge,/);
    expect(style(code("app/messages/index.tsx"), "dot")).toMatch(/backgroundColor: colors\.badge,/);
  });

  it("washes an unread notice rather than filling it", () => {
    expect(code("app/(tabs)/activity.tsx")).toMatch(/\n\s*unread: \{ backgroundColor: colors\.wash \},/);
  });
});
