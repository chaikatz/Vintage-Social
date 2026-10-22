import React from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { countLabel } from "@/darkroom/labels";
import type { YearCount } from "@/darkroom/discovery";
import { room, roomType } from "./room";

/**
 * The library's contents page: every year it holds photographs from,
 * oldest first, the way a photography book lists its chapters — the year
 * in the serif, the count in small mono, a hairline between. The chapter
 * open now is marked with the gold rule.
 */
export function YearIndex({
  visible,
  years,
  current,
  onChoose,
  onClose,
}: {
  visible: boolean;
  years: readonly YearCount[];
  current: number | null;
  onChoose: (year: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={roomType.eyebrow}>Contents</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close the contents">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Your library, by year.</Text>
        <FlatList
          data={years as YearCount[]}
          keyExtractor={(y) => String(y.year)}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.hairline} />}
          renderItem={({ item }) => {
            const chosen = item.year === current;
            return (
              <Pressable
                onPress={() => onChoose(item.year)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${item.year}, ${item.count} photographs`}
                accessibilityState={{ selected: chosen }}
              >
                <View style={[styles.mark, { backgroundColor: chosen ? room.gold : "transparent" }]} />
                <Text style={[styles.year, chosen && { color: room.gold }]}>{item.year}</Text>
                <Text style={styles.count}>{countLabel(item.count)}</Text>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: room.page },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 22,
  },
  done: { fontFamily: roomType.serif, fontSize: 16, color: room.ink },
  title: { fontFamily: roomType.serif, fontSize: 26, color: room.ink, paddingHorizontal: 24, marginTop: 14, marginBottom: 18 },
  list: { paddingHorizontal: 24, paddingBottom: 40 },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: room.lineStrong },
  row: { flexDirection: "row", alignItems: "baseline", paddingVertical: 14, minHeight: 56 },
  pressed: { opacity: 0.6 },
  mark: { width: 14, height: 1, marginRight: 12, alignSelf: "center" },
  year: { flex: 1, fontFamily: roomType.serif, fontSize: 28, color: room.ink, fontVariant: ["tabular-nums"] },
  count: { fontFamily: roomType.mono, fontSize: 11, letterSpacing: 1.4, color: room.faint },
});
