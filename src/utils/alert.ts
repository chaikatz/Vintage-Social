import { Alert, Platform } from "react-native";

/**
 * Cross-platform dialogs. React Native's Alert is a silent no-op in the
 * browser, so on web these fall back to the native window dialogs — plain,
 * but every confirmation keeps working during browser review. Native
 * behavior is untouched.
 */

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = [title, message].filter(Boolean).join("\n\n");
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }

  const action = buttons.find((b) => b.style !== "cancel") ?? buttons[0];
  const cancel = buttons.find((b) => b.style === "cancel");
  const confirmed = window.confirm(`${text}\n\nOK → ${action.text}`);
  if (confirmed) action.onPress?.();
  else cancel?.onPress?.();
}

export function showPrompt(
  title: string,
  message: string | undefined,
  onSubmit: (value: string) => void,
  fallbackValue?: string,
): void {
  if (Platform.OS === "web") {
    const value = window.prompt([title, message].filter(Boolean).join("\n\n"), fallbackValue);
    if (value && value.trim()) onSubmit(value.trim());
    return;
  }
  if (Platform.OS === "ios") {
    Alert.prompt(title, message, (value) => {
      if (value && value.trim()) onSubmit(value.trim());
    });
    return;
  }
  // Android has no Alert.prompt; confirm sending the provided default text.
  if (!fallbackValue) return;
  Alert.alert(title, `${message ?? ""}\n\n“${fallbackValue}”`.trim(), [
    { text: "Send", onPress: () => onSubmit(fallbackValue) },
    { text: "Cancel", style: "cancel" },
  ]);
}
