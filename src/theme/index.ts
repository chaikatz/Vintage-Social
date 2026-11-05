import { DynamicColorIOS, Platform, type ColorValue } from "react-native";

/**
 * VINTAGE design tokens.
 *
 * Two prints of the same page. Light: warm off-white paper, ink-dark text,
 * hairline borders. Dark: the page every phone's dark mode is — black,
 * with white type, white marks, and greys for everything quieter, as iOS
 * sets its own. Photography dominates either way; chrome recedes. No
 * gradients, no glass.
 *
 * Every token is a dynamic colour on iOS, so the whole app follows the
 * appearance setting at render time without a single component knowing;
 * `Appearance.setColorScheme` in `utils/appearance` is the switch. Other
 * platforms read the light print.
 */
function dyn(light: string, dark: string): ColorValue {
  return Platform.OS === "ios" ? DynamicColorIOS({ light, dark }) : light;
}

/** The dark print, for anything that needs a plain string. Neutral throughout: no brown, no cream, no gold. */
export const dark = {
  paper: "#000000", // the page, the header and the tab bar: black
  paperRaised: "#1C1C1E", // cards, inputs, buttons, sheets — a step up from the black
  paperSunken: "#2C2C2E", // wells, pressed states, an unread row — a step further, so they show on black and on a card
  ink: "#FFFFFF", // white type
  inkSoft: "#AEAEB2", // secondary: "2d ago", a name's second line
  inkFaint: "#8E8E93", // tertiary and placeholders: iOS's own system grey
  border: "#38383A", // a hairline: iOS's own separator on black
  borderStrong: "#48484A", // button edges, and the quiet grey rule under a print's photograph
  accent: "#FFFFFF", // white marks
  accentDeep: "#D1D1D6",
} as const;

/** The light print, as it has always been. */
export const light = {
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
} as const;

export const colors = {
  // Surfaces
  paper: dyn(light.paper, dark.paper), // app background, the header, the tab bar
  paperRaised: dyn(light.paperRaised, dark.paperRaised), // cards, inputs, buttons
  paperSunken: dyn(light.paperSunken, dark.paperSunken), // pressed states, wells

  // Ink
  ink: dyn(light.ink, dark.ink), // primary text
  inkSoft: dyn(light.inkSoft, dark.inkSoft), // secondary text
  inkFaint: dyn(light.inkFaint, dark.inkFaint), // tertiary text, placeholders

  // Lines
  border: dyn(light.border, dark.border), // hairline borders
  borderStrong: dyn(light.borderStrong, dark.borderStrong),

  // Accents — burnt sienna on paper, white on black
  accent: dyn(light.accent, dark.accent),
  accentDeep: dyn(light.accentDeep, dark.accentDeep),
  like: dyn("#B3402E", "#FF3040"), // the like heart: a faded red on paper, a clear red on black
  danger: dyn("#A03B2E", "#FF453A"),
  success: dyn("#5C7048", "#30D158"),
  // Something unread — a letter in the tray. The accent on paper; on black
  // the accent is white, which the white icon beside it would swallow, so
  // it is the heart's red, as every app marks it.
  badge: dyn(light.accent, "#FF3040"),

  // The invitation card: a dark, printed object rather than a screen. Used
  // only where VINTAGE presents itself — the invitation, and the gate. On
  // paper it is printed brown, ruled and lettered in gold; on black it is
  // a card a step up from the page, lettered in white and edged in grey.
  card: dyn("#3A322A", dark.paperRaised),
  cardDeep: dyn("#2F2821", "#121212"), // the same, one shade down
  gold: dyn("#D6BE94", "#FFFFFF"), // the ink the rule and the wordmark are struck in
  goldSoft: dyn("#B9A47E", "#636366"), // the same, receded

  // Photographic details
  stamp: "#FFB03A", // date-stamp amber
  stampGlow: "rgba(255, 150, 40, 0.55)",
  // The primary button. On black the shutter is white with black on it,
  // so the one button on a screen still reads as the one button.
  shutter: dyn("#1C1915", "#FFFFFF"),
  onShutter: dyn("#F2EBDD", "#000000"),
  // The dark of a camera, whichever the print: the box a photograph is
  // previewed in, and the discs set over a photograph or a film. What is
  // set on them is light on both prints.
  camera: dyn("#1C1915", "#000000"),
  onCamera: dyn("#F2EBDD", "#FFFFFF"),
  // A switch's knob while it is off. On, the knob is the raised paper
  // over the accent's track; off, on paper it is the same, and on black it
  // is white over the grey track, as iOS sets one.
  knob: dyn(light.paperRaised, "#FFFFFF"),
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 3,
  md: 6,
  lg: 10,
  round: 999,
} as const;

const serif = Platform.select({ ios: "Georgia", default: "serif" });
const mono = Platform.select({ ios: "Courier New", default: "monospace" });
/**
 * The engraved script of an invitation. Snell Roundhand ships with iOS;
 * everywhere else this degrades to an italic serif, which is the right
 * shape even if it isn't the right hand.
 */
const script = Platform.select({ ios: "Snell Roundhand", default: "serif" });

export const type = {
  /** The wordmark and section headers — quiet serif. */
  serif,
  /** Date stamps and counters — typewriter mono. */
  mono,
  /** Invitations only — copperplate script. */
  script,
  title: {
    fontFamily: serif,
    fontSize: 22,
    letterSpacing: 0.5,
    color: colors.ink,
  },
  wordmark: {
    fontFamily: serif,
    fontSize: 34,
    letterSpacing: 6,
    color: colors.ink,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  label: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
    color: colors.inkFaint,
  },
} as const;

export const hairline = {
  borderColor: colors.border,
  borderWidth: 1,
} as const;
