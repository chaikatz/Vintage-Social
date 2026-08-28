import React from "react";
import { StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { colors, radii, spacing, type } from "@/theme";

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
}

export function TextField({ label, error, hint, style, ...inputProps }: Props) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.inkFaint}
        style={[styles.input, inputProps.multiline && styles.multiline, error ? styles.inputError : null, style]}
        {...inputProps}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { ...type.label, marginBottom: spacing.xs + 2 },
  input: {
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  inputError: { borderColor: colors.danger },
  error: { fontSize: 12, color: colors.danger, marginTop: spacing.xs },
  hint: { fontSize: 12, color: colors.inkFaint, marginTop: spacing.xs },
});
