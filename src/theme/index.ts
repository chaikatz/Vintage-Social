import { Platform } from "react-native";

/**
 * VINTAGE design tokens.
 *
 * Warm off-white paper, ink-dark text, hairline borders, compact controls.
 * Photography dominates; chrome recedes. No gradients, no glass.
 */
export const colors = {
  // Surfaces
  paper: "#FAF6EF", // app background — warm off-white
  paperRaised: "#FFFDF8", // cards, inputs
  paperSunken: "#F3EDE2", // pressed states, wells

  // Ink
  ink: "#2B2620", // primary text
  inkSoft: "#6E655A", // secondary text
  inkFaint: "#9C927F", // tertiary text, placeholders

  // Lines
  border: "#E6DECF", // hairline borders
  borderStrong: "#D5CBB8",

  // Accents — muted, film-toned
  accent: "#A65B2A", // burnt sienna, links and primary actions
  accentDeep: "#8C4A20",
  like: "#B3402E", // faded red for the like heart
  danger: "#A03B2E",
  success: "#5C7048",

  // The invitation card: a dark, printed object rather than a screen. Used
  // only where VINTAGE presents itself — the invitation, and the gate.
  card: "#3A322A", // deep printed brown
  cardDeep: "#2F2821", // the same, one shade down
  gold: "#D6BE94", // the ink the rule and the wordmark are struck in
  goldSoft: "#B9A47E", // the same, receded

  // Photographic details
  stamp: "#FFB03A", // date-stamp amber
  stampGlow: "rgba(255, 150, 40, 0.55)",
  shutter: "#1C1915", // camera / capture surfaces
  onShutter: "#F2EBDD",
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
