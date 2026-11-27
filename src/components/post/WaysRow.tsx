import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { LINE_HEIGHT, LINE_TYPE, type Box } from "@/post/roll";
import { colors, type } from "@/theme";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";

/**
 * The line under the photograph, as the owner's mock sets it, from the
 * frame's left edge to its right: LIBRARY at the left, in small, widely
 * spaced capitals in the soft ink (the iPhone's own picker, which needs
 * no permission), and POST → at the right, in bold, widely spaced
 * capitals in ink, which opens the selected photograph in the editor.
 *
 * Beside LIBRARY, in its type, VIDEO: the clip's way in (up to a minute,
 * in the same feed and grid). The picker the clip needs is the iPhone's
 * own with its trimmer (expo-image-picker's UIImagePickerController,
 * `allowsEditing`), which holds a clip to the minute; LIBRARY's is the
 * photo picker (PHPicker), which has no trimmer and would crop a
 * photograph square if it were asked to edit. One picker for both would
 * hand the editor a different file for a clip and lose the trimmer, so
 * the two stay two words on the one line. Where there is no roll on a
 * phone (Android) the camera is a word here too.
 *
 * POST stands only while there is a photograph to post; in every other
 * state its place is kept empty, so the line keeps its shape. At the
 * larger text sizes the words on the left wrap under one another, and
 * POST stays at the right.
 */

const BAR_TYPE_CAP = 1.8;

export type WayName = "camera" | "video" | "photo";

export function WaysRow({
  frame,
  camera,
  canPost,
  posting,
  busy,
  held,
  onLibrary,
  onVideo,
  onCamera,
  onPost,
}: {
  frame: Box;
  /** The camera as a word: where there is no roll to carry the camera's tile. */
  camera: boolean;
  /** There is a photograph to post. */
  canPost: boolean;
  /** The photograph is opening in the editor. */
  posting: boolean;
  busy: WayName | null;
  held: boolean;
  onLibrary: () => void;
  onVideo: () => void;
  onCamera?: () => void;
  onPost: () => void;
}) {
  return (
    <View testID="post-line" style={[styles.line, { marginLeft: frame.left, width: frame.width }]}>
      <View style={styles.ways}>
        <Way
          testID="post-way-library"
          label="Library"
          hint="Opens your photo library. Nothing is shared until you choose Share to VINTAGE."
          busy={busy === "photo"}
          held={held}
          onPress={onLibrary}
        />
        <Way
          testID="post-way-video"
          word="Video"
          label="Short video"
          hint={`Up to ${MAX_VIDEO_SECONDS} seconds, same feed, same grid`}
          busy={busy === "video"}
          held={held}
          onPress={onVideo}
        />
        {camera && onCamera ? (
          <Way testID="post-way-camera" label="Camera" hint="Take one now" busy={busy === "camera"} held={held} onPress={onCamera} />
        ) : null}
      </View>
      <Pressable
        testID="post-post"
        onPress={onPost}
        disabled={held || !canPost}
        hitSlop={{ top: 6, bottom: 6, left: 12, right: 6 }}
        style={({ pressed }) => [styles.post, !canPost && styles.gone, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Post"
        accessibilityHint="Opens the selected photograph in the editor. Nothing is shared until you choose Share to VINTAGE."
        accessibilityState={{ busy: posting, disabled: held || !canPost }}
        accessibilityElementsHidden={!canPost}
        importantForAccessibility={canPost ? "auto" : "no-hide-descendants"}
      >
        <View style={[styles.postInside, posting && styles.hidden]}>
          <Text style={styles.postWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
            Post
          </Text>
          <Arrow />
        </View>
        {posting ? <ActivityIndicator size="small" color={colors.ink} style={StyleSheet.absoluteFill} /> : null}
      </Pressable>
    </View>
  );
}

/** One way in: its word; while it is the one opening, a spinner in the word's place. */
function Way({
  testID,
  word,
  label,
  hint,
  busy,
  held,
  onPress,
}: {
  testID: string;
  /** What the line prints, when it is not what VoiceOver hears. */
  word?: string;
  label: string;
  hint: string;
  busy: boolean;
  held: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={held}
      hitSlop={{ left: 8, right: 8 }}
      style={({ pressed }) => [styles.way, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ busy, disabled: held }}
    >
      <Text style={[styles.wayWord, busy && styles.hidden]} maxFontSizeMultiplier={BAR_TYPE_CAP}>
        {word ?? label}
      </Text>
      {busy ? <ActivityIndicator size="small" color={colors.inkSoft} style={StyleSheet.absoluteFill} /> : null}
    </Pressable>
  );
}

/** POST's arrow, as the mock draws it: a long thin stroke and a small head, 12 points long, in ink. */
function Arrow() {
  const { length, head, stroke } = LINE_TYPE.arrow;
  // Each half of the head is a short stroke turned 45 degrees about its middle, its outer end on the tip.
  const half = head * Math.SQRT2;
  const reach = (half / 2) * Math.SQRT1_2;
  return (
    <View style={[styles.arrow, { width: length, height: head * 2 + stroke }]} pointerEvents="none">
      <View style={[styles.stroke, { width: length, height: stroke, top: head }]} />
      <View
        style={[styles.stroke, { width: half, height: stroke, top: head - reach, left: length - reach - half / 2 - stroke / 2, transform: [{ rotate: "45deg" }] }]}
      />
      <View
        style={[styles.stroke, { width: half, height: stroke, top: head + reach, left: length - reach - half / 2 - stroke / 2, transform: [{ rotate: "-45deg" }] }]}
      />
    </View>
  );
}

const caps = { textTransform: "uppercase" as const };

const styles = StyleSheet.create({
  line: { minHeight: LINE_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ways: { flexShrink: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: LINE_TYPE.between },
  way: { minHeight: 44, justifyContent: "center" },
  wayWord: {
    fontFamily: type.mono,
    fontSize: LINE_TYPE.library.size,
    letterSpacing: LINE_TYPE.library.tracking,
    ...caps,
    color: colors.inkSoft,
  },
  post: { minHeight: 44, justifyContent: "center", flexShrink: 0, marginLeft: 12 },
  postInside: { flexDirection: "row", alignItems: "center" },
  postWord: {
    fontFamily: type.mono,
    fontSize: LINE_TYPE.post.size,
    fontWeight: "700",
    letterSpacing: LINE_TYPE.post.tracking,
    ...caps,
    color: colors.ink,
  },
  // POST's own spacing follows its T, as the typewriter's does; the arrow stands this far past it.
  arrow: { marginLeft: LINE_TYPE.arrow.gap },
  stroke: { position: "absolute", left: 0, backgroundColor: colors.ink },
  gone: { opacity: 0 },
  hidden: { opacity: 0 },
  pressed: { opacity: 0.6 },
});
