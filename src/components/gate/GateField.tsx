import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, spacing, type } from "@/theme";

/**
 * A field ruled onto the card: a small letterspaced label, gold ink, and a
 * hairline underneath. No box, no fill — a line to write on, the way a
 * printed form has one.
 */
export function GateField({
  label,
  error,
  hint,
  mono,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  error?: string | null;
  hint?: string;
  /** Typewriter face and wide tracking, for codes. */
  mono?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor="rgba(214, 190, 148, 0.32)"
        selectionColor={colors.gold}
        style={[styles.input, mono && styles.mono, inputProps.multiline && styles.multiline]}
      />
      <View style={[styles.rule, error ? styles.ruleError : null]} />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg },
  label: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.goldSoft,
    marginBottom: spacing.xs,
  },
  input: { fontSize: 16, color: colors.gold, paddingVertical: 6 },
  mono: { fontFamily: type.mono, letterSpacing: 3 },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  rule: { height: 1, backgroundColor: colors.goldSoft, opacity: 0.38 },
  ruleError: { backgroundColor: colors.stamp, opacity: 0.9 },
  error: { fontSize: 11, color: colors.stamp, marginTop: spacing.xs },
  hint: { fontSize: 11, color: colors.goldSoft, opacity: 0.7, marginTop: spacing.xs },
});
