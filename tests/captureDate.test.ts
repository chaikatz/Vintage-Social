import { describe, expect, it } from "vitest";
import { captureDateFromEpoch, plausibleCaptureDate } from "@/utils/exif";

/**
 * Video carries no EXIF, so its capture date comes from the photo library as
 * a millisecond timestamp. It gets the same sanity rules as an EXIF date:
 * better no stamp than a wrong one printed across the corner.
 */
describe("capture date from the photo library", () => {
  it("reads a real timestamp", () => {
    const then = new Date(2019, 6, 4, 18, 32, 10);
    expect(captureDateFromEpoch(then.getTime())).toBe(then.toISOString());
  });

  it("rejects a dead clock", () => {
    expect(captureDateFromEpoch(new Date(1899, 0, 1).getTime())).toBeNull();
  });

  it("rejects the future", () => {
    expect(captureDateFromEpoch(Date.now() + 7 * 86_400_000)).toBeNull();
  });

  it("rejects nothing-at-all", () => {
    expect(captureDateFromEpoch(0)).toBeNull();
    expect(captureDateFromEpoch(-1)).toBeNull();
    expect(captureDateFromEpoch(undefined)).toBeNull();
    expect(captureDateFromEpoch(null)).toBeNull();
    expect(captureDateFromEpoch("2019-07-04")).toBeNull();
    expect(captureDateFromEpoch(Number.NaN)).toBeNull();
  });

  it("accepts today", () => {
    expect(captureDateFromEpoch(Date.now())).not.toBeNull();
  });

  it("shares its rules with the EXIF path", () => {
    expect(plausibleCaptureDate(new Date(1850, 0, 1))).toBeNull();
    expect(plausibleCaptureDate(new Date(Number.NaN))).toBeNull();
  });
});
