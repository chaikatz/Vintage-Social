import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Directory, File, Paths } from "expo-file-system";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { exportPalette } from "@/components/ExportCard";
import { dateStampText, shortDate } from "@/utils/time";
import { exportByline, exportLayout, printRatio, type ExportFormat, type ExportPaper } from "@/utils/exportLayout";
import type { BrandOptions, VintageVideoModule } from "../../modules/vintage-video";
import type { PostWithAuthor } from "@/types/db";

/**
 * Sending a post out of VINTAGE — to Instagram, WhatsApp, Messages, a
 * camera roll — as a print rather than a bare file, so wherever it lands
 * it is plainly ours.
 *
 * A photograph is the `ExportCard` on screen, captured at the phone's
 * scale. A film goes to the native side, which paints the same paper and
 * label around the moving picture and keeps its sound. Either way the
 * result is handed to the system share sheet, which is where the apps
 * live; nothing is posted anywhere by us.
 */

const native = Platform.OS === "ios" ? requireOptionalNativeModule<VintageVideoModule>("VintageVideo") : null;

export function canExport(): boolean {
  return Platform.OS !== "web";
}

/** Whether a film can leave as a film (branded) rather than as its poster. */
export function canBrandVideo(): boolean {
  return native != null && typeof native.brand === "function";
}

/** The card, as a JPEG file the share sheet can take. */
export async function capturePrint(view: React.Component | React.RefObject<unknown> | number): Promise<string> {
  const uri = await captureRef(view as never, { format: "jpg", quality: 0.95, result: "tmpfile" });
  return uri.startsWith("file://") ? uri : `file://${uri}`;
}

/** Pixel width of a branded film: a story is 1080 wide; a print, 1620. */
const VIDEO_WIDTH: Record<ExportFormat, number> = { print: 1620, story: 1080 };

/**
 * Paint the print around the film. Downloads the clip once into the
 * cache, then asks the native side for the branded copy.
 */
export async function brandVideo(
  post: PostWithAuthor,
  remoteUrl: string,
  format: ExportFormat,
  paper: ExportPaper,
  onStage?: (stage: string) => void,
): Promise<string> {
  if (!native?.brand) throw new Error("Branding a film is not available in this build");
  onStage?.("Fetching the film…");
  const cache = new Directory(Paths.cache, "vintage-export");
  if (!cache.exists) cache.create({ intermediates: true, idempotent: true });
  const local = new File(cache, `${post.id}.mp4`);
  if (!local.exists) {
    await File.downloadFileAsync(remoteUrl, local);
  }

  onStage?.("Printing…");
  const width = VIDEO_WIDTH[format];
  const L = exportLayout(printRatio(post.width, post.height), format, width);
  const c = exportPalette(paper);
  const date = post.taken_at ?? post.created_at;
  const options: BrandOptions = {
    width: L.width,
    height: L.height,
    photo: L.photo,
    rule: L.rule,
    wordmark: L.wordmark,
    byline: L.byline,
    credit: L.credit,
    stamp: L.stamp,
    paper: c.paper,
    well: c.well,
    ink: c.ink,
    inkSoft: c.inkSoft,
    inkFaint: c.inkFaint,
    ruleColor: c.rule,
    wordmarkText: "VINTAGE",
    bylineText: exportByline(post.location, shortDate(date)).toUpperCase(),
    creditText: post.author.username,
    stampText: post.show_date_stamp ? dateStampText(date) : "",
  };
  const result = await native.brand(local.uri, options);
  return result.uri;
}

/** Hand a file to the phone's share sheet. Resolves when the sheet closes. */
export async function shareFile(uri: string, kind: "image" | "video"): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device");
  await Sharing.shareAsync(uri, {
    mimeType: kind === "video" ? "video/mp4" : "image/jpeg",
    UTI: kind === "video" ? "public.mpeg-4" : "public.jpeg",
    dialogTitle: "Share from VINTAGE",
  });
}
