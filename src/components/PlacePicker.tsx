import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { canSearchPlaces, searchPlaces, type Place } from "@/api/places";
import { MAX_LOCATION_LENGTH } from "@/utils/validation";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";

/** What the composer holds: a chosen place, or words with no point behind them. */
export type PlaceChoice = { kind: "place"; place: Place } | { kind: "text"; text: string } | null;

interface Props {
  visible: boolean;
  value: PlaceChoice;
  onChange: (next: PlaceChoice) => void;
  onClose: () => void;
}

/**
 * Where the photograph was taken.
 *
 * A sheet over the darkroom. Type a few letters and Apple Maps answers
 * with real places — a restaurant, a hotel, a beach, a town — each with
 * enough of its address to tell it from another of the same name. Choose
 * one and the post is pinned to that place's own point on the map. The
 * words you typed are always offered as a plain caption-line too, for a
 * place that is not on any map, and the picker never asks where you are.
 */
export function PlacePicker({ visible, value, onChange, onClose }: Props) {
  const [q, setQ] = useState(value?.kind === "text" ? value.text : value?.kind === "place" ? value.place.name : "");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const searchable = canSearchPlaces();

  // Debounced: the map is asked once the typing pauses, never per key.
  useEffect(() => {
    if (!visible) return;
    const query = q.trim();
    if (query.length < 2 || !searchable) {
      setResults([]);
      setSearching(false);
      setFailed(false);
      return;
    }
    let live = true;
    setSearching(true);
    setFailed(false);
    const t = setTimeout(() => {
      searchPlaces(query)
        .then((found) => {
          if (!live) return;
          setResults(found);
          setSearching(false);
        })
        .catch(() => {
          if (!live) return;
          setResults([]);
          setFailed(true);
          setSearching(false);
        });
    }, 280);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, visible, searchable]);

  const choose = (place: Place) => {
    onChange({ kind: "place", place });
    onClose();
  };
  const useTyped = () => {
    const text = q.trim().slice(0, MAX_LOCATION_LENGTH);
    onChange(text ? { kind: "text", text } : null);
    onClose();
  };
  const clear = () => {
    setQ("");
    onChange(null);
    onClose();
  };

  const typed = q.trim();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.head}>
          <Text style={styles.title}>Where was this</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Done">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Feather name="map-pin" size={15} color={colors.inkFaint} />
          <TextInput
            inputAccessoryViewID={KEYBOARD_DONE}
            value={q}
            onChangeText={(t) => setQ(t.slice(0, MAX_LOCATION_LENGTH))}
            placeholder={searchable ? "A restaurant, a hotel, a town…" : "A town, a street, a bar"}
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={useTyped}
            style={styles.input}
          />
          {q ? (
            <Pressable hitSlop={10} onPress={() => setQ("")} accessibilityLabel="Clear">
              <Feather name="x" size={15} color={colors.inkFaint} />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {typed.length > 0 ? (
                <Pressable style={styles.row} onPress={useTyped}>
                  <View style={styles.mark}>
                    <Feather name="type" size={14} color={colors.inkSoft} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      “{typed}”
                    </Text>
                    <Text style={styles.subtitle}>Just the words — no point on the map</Text>
                  </View>
                </Pressable>
              ) : null}
              {searching ? <ActivityIndicator style={styles.spinner} color={colors.inkFaint} /> : null}
              {failed ? <Text style={styles.note}>Places couldn’t be searched just now. You can still write the name.</Text> : null}
              {!searchable && typed.length > 0 ? (
                <Text style={styles.note}>Place search is on the phone. Here the name is kept as written.</Text>
              ) : null}
              {searchable && !searching && !failed && typed.length >= 2 && results.length === 0 ? (
                <Text style={styles.note}>Nothing by that name on the map.</Text>
              ) : null}
            </>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => choose(item)}>
              <View style={styles.mark}>
                <Feather name="map-pin" size={14} color={colors.accent} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            value ? (
              <Pressable style={styles.remove} onPress={clear} hitSlop={8}>
                <Text style={styles.removeText}>Remove the place</Text>
              </Pressable>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontFamily: type.serif, fontSize: 18, color: colors.ink },
  done: { fontSize: 15, fontWeight: "600", color: colors.accent },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, paddingVertical: 9, fontSize: 15, color: colors.ink },
  spinner: { marginTop: spacing.md },
  note: { ...type.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.md, color: colors.inkFaint },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 3,
  },
  mark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  name: { fontSize: 15, color: colors.ink },
  subtitle: { fontSize: 12, color: colors.inkFaint, marginTop: 1 },
  remove: { alignItems: "center", paddingVertical: spacing.lg },
  removeText: { ...type.caption, color: colors.danger },
});
