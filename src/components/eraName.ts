import { Alert, Platform } from "react-native";
import { ERA_TITLE_MAX } from "@/utils/eraEdits";

/**
 * Asking a member for an era's name, as iOS asks for an album's: its own
 * alert, with a field already holding the name the era shows. Save keeps
 * what is written (cleaned, and an empty field is the automatic name
 * again); "Use the automatic name" is offered once the era has a name of
 * the member's. In the browser, where the demo is reviewed, it is the
 * browser's own prompt, and an empty answer does the same.
 *
 * Android has no text alert of its own, so renaming is not offered there
 * (`canNameEras`); the photographs still move.
 */

export const canNameEras = Platform.OS !== "android";

export const ERA_NAME_TITLE = "Rename this era";

/** The line under the question: what the era goes back to, and how long a name may be. */
export function eraNameMessage(automatic: string): string {
  return `Its automatic name is “${automatic}”. Up to ${ERA_TITLE_MAX} characters.`;
}

export function askEraName(
  era: { key: string; title: string; renamed: boolean },
  onName: (title: string | null) => void,
): void {
  const message = eraNameMessage(era.key);
  if (Platform.OS === "web") {
    const value = window.prompt(`${ERA_NAME_TITLE}\n\n${message} Leave it empty to use it.`, era.title);
    if (value !== null) onName(value);
    return;
  }
  if (!canNameEras) return;
  Alert.prompt(
    ERA_NAME_TITLE,
    message,
    [
      { text: "Cancel", style: "cancel" },
      ...(era.renamed ? [{ text: "Use the automatic name", onPress: () => onName(null) }] : []),
      { text: "Save", onPress: (value?: string) => onName(value ?? "") },
    ],
    "plain-text",
    era.title,
  );
}
