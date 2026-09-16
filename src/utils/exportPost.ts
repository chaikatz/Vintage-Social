import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Directory, File, Paths } from "expo-file-system";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { Asset } from "expo-asset";
import { EXPORT_ICON, exportPalette } from "@/components/ExportCard";
import { dateStampText } from "@/utils/time";
import { exportLabelText, exportLayout, printRatio, type ExportFormat, type ExportPaper } from "@/utils/exportLayout";
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
  memberNo: number | null | undefined,
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
  const iconUri = await iconFile();
  const width = VIDEO_WIDTH[format];
  const words = exportLabelText(post, memberNo);
  const L = exportLayout(printRatio(post.width, post.height), format, width, { placeLines: words.placeLines });
  const c = exportPalette(paper);
  const date = post.taken_at ?? post.created_at;
  const options: BrandOptions = {
    width: L.width,
    height: L.height,
    photo: L.photo,
    rule: L.rule,
    wordmark: L.wordmark,
    place: L.place,
    byline: L.byline,
    credit: L.credit,
    stamp: L.stamp,
    icon: L.icon,
    iconUri,
    paper: c.paper,
    well: c.well,
    ink: c.ink,
    inkSoft: c.inkSoft,
    inkFaint: c.inkFaint,
    ruleColor: c.rule,
    wordmarkText: "VINTAGE",
    placeText: words.place ?? "",
    bylineText: words.date,
    creditText: words.credit,
    stampText: post.show_date_stamp ? dateStampText(date) : "",
  };
  const result = await native.brand(local.uri, options);
  return result.uri;
}

/** The app icon as a file on disk for the native side; "" when it cannot be had, and the film goes without. */
async function iconFile(): Promise<string> {
  try {
    const asset = Asset.fromModule(EXPORT_ICON);
    if (!asset.localUri) await asset.downloadAsync();
    return asset.localUri ?? "";
  } catch {
    return "";
  }
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
