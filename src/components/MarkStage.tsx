import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, View, useColorScheme, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { WebView } from "react-native-webview";
import { MARK_HTML } from "@/brand/markHtml.generated";

/** A still of the same scene, shown until the scene draws — and instead of it where WebGL is unavailable. */
const STILL = require("../../assets/brand/mark-v.png");
/** The same still with the V cut in white, for the black page. */
const STILL_ON_BLACK = require("../../assets/brand/mark-v-dark.png");

/**
 * The colour the V is cut in on the black page: white, a hair cool, so the
 * scene's warm studio light leaves it white rather than cream. On paper it
 * is the espresso it has always been.
 */
const INK_ON_BLACK = "f6f8ff";

/** How long to give the scene before settling for the still. */
const GIVE_UP_MS = 6000;

/**
 * The VINTAGE mark, turning — the same three.js scene as vintagesocial.app,
 * carried inside the app in a transparent web view (src/brand/markHtml.generated.ts,
 * built from public/3d/app.js). It fetches nothing and takes no touches.
 *
 * `fill` sets how much of the box the mark takes, as on the web stage: the
 * box's half-height is `fill` × the mark's radius. The still beneath is
 * sized to match, so the swap from it to the scene is quiet.
 *
 * It follows the print: on the black page the V is white, as the rest of
 * the marks are. A web view takes no dynamic colours, so this is the one
 * place the appearance is read rather than left to the theme; the page is
 * black only where the theme prints it so, on the iPhone.
 */
export function MarkStage({
  height,
  width,
  fill = 1.3,
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  fill?: number;
  style?: ViewStyle;
}) {
  const scheme = useColorScheme();
  const onBlack = Platform.OS === "ios" && scheme === "dark";
  // Which print the scene has drawn for: a change of appearance reloads it in
  // the other ink, and the still stands in again until it has.
  const [readyOn, setReadyOn] = useState<boolean | null>(null);
  const ready = readyOn === onBlack;
  const [failed, setFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const html = useMemo(
    () =>
      MARK_HTML.replace('data-fill="__FILL__"', `data-fill="${fill}"`).replace(
        'data-ink="__INK__"',
        `data-ink="${onBlack ? INK_ON_BLACK : ""}"`,
      ),
    [fill, onBlack],
  );

  useEffect(() => {
    if (!ready) {
      opacity.setValue(0);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [ready, opacity]);

  useEffect(() => {
    if (ready || failed) return;
    const t = setTimeout(() => setFailed(true), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [ready, failed]);

  const stillHeight = Math.round(height / fill);

  return (
    <View style={[styles.box, { height, width: width ?? "100%" }, style]} pointerEvents="none">
      {!ready || failed ? (
        <Image
          source={onBlack ? STILL_ON_BLACK : STILL}
          style={{ height: stillHeight, width: Math.round(stillHeight * 0.905) }}
          contentFit="contain"
          transition={0}
          accessibilityLabel="The VINTAGE mark, a serif V"
        />
      ) : null}
      {!failed ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
          <WebView
            source={{ html }}
            originWhitelist={["*"]}
            style={styles.web}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            javaScriptEnabled
            setSupportMultipleWindows={false}
            allowsInlineMediaPlayback
            androidLayerType="hardware"
            onMessage={(e) => {
              if (e.nativeEvent.data === "ready") setReadyOn(onBlack);
            }}
            onError={() => setFailed(true)}
            accessibilityLabel="The VINTAGE mark, a serif V, turning"
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  web: { flex: 1, backgroundColor: "transparent" },
});
