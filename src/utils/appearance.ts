import { Appearance, Platform } from "react-native";
import { File, Paths } from "expo-file-system";

/**
 * Light print, dark print, or whatever the phone is doing.
 *
 * Every colour in the app is a dynamic colour (see `theme`), so switching
 * is one call: `Appearance.setColorScheme` overrides the interface style
 * for the whole app and every token follows on the next frame. The choice
 * is kept in a small file on the phone and re-applied at launch, before
 * the first screen draws.
 */

export type AppearanceChoice = "system" | "light" | "dark";

const FILE = "appearance.json";
const KEY = "vintage.appearance";

export function parseAppearance(raw: string | null | undefined): AppearanceChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function loadAppearance(): AppearanceChoice {
  try {
    if (Platform.OS === "web") {
      return parseAppearance(typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null);
    }
    const file = new File(Paths.document, FILE);
    return parseAppearance(file.exists ? file.textSync().trim() : null);
  } catch {
    return "system";
  }
}

function persist(choice: AppearanceChoice): void {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(KEY, choice);
      return;
    }
    const file = new File(Paths.document, FILE);
    if (!file.exists) file.create();
    file.write(choice);
  } catch {
    // A preference that fails to save is not worth an error.
  }
}

/** Apply a choice to the running app. "system" hands control back to the phone. */
export function applyAppearance(choice: AppearanceChoice): void {
  try {
    Appearance.setColorScheme(choice === "system" ? null : choice);
  } catch {
    // Older runtimes without the override simply stay on the system scheme.
  }
}

export function setAppearance(choice: AppearanceChoice): void {
  persist(choice);
  applyAppearance(choice);
}

/** At launch: read the saved choice and put it into effect. */
export function restoreAppearance(): AppearanceChoice {
  const choice = loadAppearance();
  applyAppearance(choice);
  return choice;
}
