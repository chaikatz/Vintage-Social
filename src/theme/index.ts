import { DynamicColorIOS, Platform, type ColorValue } from "react-native";

/**
 * VINTAGE design tokens.
 *
 * Two prints of the same page. Light: warm off-white paper, ink-dark text,
 * hairline borders. Dark: the same page struck on deep brown — the brown
 * of an old darkroom — with cream type and gold marks. Photography
 * dominates either way; chrome recedes. No gradients, no glass.
 *
 * Every token is a dynamic colour on iOS, so the whole app follows the
 * appearance setting at render time without a single component knowing;
 * `Appearance.setColorScheme` in `utils/appearance` is the switch. Other
 * platforms read the light print.
 */
function dyn(light: string, dark: string): ColorValue {
  return Platform.OS === "ios" ? DynamicColorIOS({ light, dark }) : light;
}

/** The dark print, as sampled from the reference, for anything that needs a plain string. */
export const dark = {
  paper: "#3B2C27", // the page: Espresso (SW 2736), the brown of a darkroom wall
  paperRaised: "#47362F", // buttons, inputs — a step up, still brown
  paperSunken: "#2F221E", // the tab bar, the header, the gaps between prints
  ink: "#F6ECDF", // cream type
  inkSoft: "#DDC7AC",
  inkFaint: "#B39A80",
  border: "#52403A", // a hairline you feel more than see
  borderStrong: "#74604F", // button edges and rules — visible against the espresso
  accent: "#D4B48F", // gold marks
  accentDeep: "#B08E67",
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
  paper: dyn(light.paper, dark.paper), // app background
  paperRaised: dyn(light.paperRaised, dark.paperRaised), // cards, inputs, buttons
  paperSunken: dyn(light.paperSunken, dark.paperSunken), // pressed states, wells, the tab bar

  // Ink
  ink: dyn(light.ink, dark.ink), // primary text
  inkSoft: dyn(light.inkSoft, dark.inkSoft), // secondary text
  inkFaint: dyn(light.inkFaint, dark.inkFaint), // tertiary text, placeholders

  // Lines
  border: dyn(light.border, dark.border), // hairline borders
  borderStrong: dyn(light.borderStrong, dark.borderStrong),

  // Accents — burnt sienna on paper, gold on the darkroom brown
  accent: dyn(light.accent, dark.accent),
  accentDeep: dyn(light.accentDeep, dark.accentDeep),
  like: dyn("#B3402E", "#E07A6A"), // faded red for the like heart
  danger: dyn("#A03B2E", "#E28A7A"),
  success: dyn("#5C7048", "#9DB48A"),

  // The invitation card: a dark, printed object rather than a screen. Used
  // only where VINTAGE presents itself — the invitation, and the gate.
  card: dyn("#3A322A", "#2F221E"), // deep printed brown — on the espresso page, one shade down
  cardDeep: dyn("#2F2821", "#261B17"), // the same, one shade down again
  gold: "#D6BE94", // the ink the rule and the wordmark are struck in
  goldSoft: "#B9A47E", // the same, receded

  // Photographic details
  stamp: "#FFB03A", // date-stamp amber
  stampGlow: "rgba(255, 150, 40, 0.55)",
  // Camera / capture surfaces and the primary button. On the dark print
  // the shutter is the cream, so the one button on a screen still reads
  // as the one button.
  shutter: dyn("#1C1915", "#F3E6D3"),
  onShutter: dyn("#F2EBDD", "#3B2C27"),
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
