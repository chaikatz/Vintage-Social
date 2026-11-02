import { Alert, Platform } from "react-native";
import { ERA_TITLE_MAX, cleanEraTitle } from "@/utils/eraEdits";
import { showAlert } from "@/utils/alert";

/**
 * Asking a member for an era's name, as iOS asks for an album's: its own
 * alert, with a field already holding the name the era shows. Save keeps
 * what is written (cleaned, and an empty field is the automatic name
 * again); "Use the automatic name" is offered once the era has a name of
 * the member's. An era the member made has no automatic name to go back
 * to, so it offers "Delete era" in its place, asked once more before it
 * goes. In the browser, where the demo is reviewed, it is the browser's
 * own prompt, and an empty answer does the same: the automatic name, or,
 * for an era the member made, the question whether to delete it.
 *
 * Android has no text alert of its own, so renaming is not offered there
 * (`canNameEras`); the photographs still move, and an era the member made
 * is deleted from its own control (EraList).
 */

export const canNameEras = Platform.OS !== "android";

export const ERA_NAME_TITLE = "Rename this era";

/** The line under the question: what the era goes back to, and how long a name may be. */
export function eraNameMessage(automatic: string): string {
  return `Its automatic name is “${automatic}”. Up to ${ERA_TITLE_MAX} characters.`;
}

/** The same line for an era the member made, which has no automatic name. */
export const MADE_ERA_NAME_MESSAGE = `An era of your own. Up to ${ERA_TITLE_MAX} characters.`;

/**
 * Whether to delete an era the member made, asked once more: its
 * photographs go back where they were, and none of them is deleted.
 */
export function confirmDeleteEra(title: string, onDelete: () => void): void {
  showAlert(`Delete “${title}”?`, "Its photographs go back where they were. None of them is deleted.", [
    { text: "Delete era", style: "destructive", onPress: onDelete },
    { text: "Cancel", style: "cancel" },
  ]);
}

export function askEraName(
  era: { key: string; title: string; renamed: boolean; made: boolean },
  onName: (title: string | null) => void,
  onDelete: () => void,
): void {
  const message = era.made ? MADE_ERA_NAME_MESSAGE : eraNameMessage(era.key);
  if (Platform.OS === "web") {
    if (era.made) {
      const value = window.prompt(`${ERA_NAME_TITLE}\n\n${message} Leave it empty to delete it.`, era.title);
      if (value === null) return;
      if (cleanEraTitle(value)) onName(value);
      else confirmDeleteEra(era.title, onDelete);
      return;
    }
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
      ...(era.made ? [{ text: "Delete era", style: "destructive" as const, onPress: () => confirmDeleteEra(era.title, onDelete) }] : []),
      ...(era.renamed ? [{ text: "Use the automatic name", onPress: () => onName(null) }] : []),
      { text: "Save", onPress: (value?: string) => onName(value ?? "") },
    ],
    "plain-text",
    era.title,
  );
}
