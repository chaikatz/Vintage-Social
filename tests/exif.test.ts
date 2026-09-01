import { describe, expect, it } from "vitest";
import { captureDateFrom, parseExifDate } from "@/utils/exif";

describe("parseExifDate", () => {
  it("reads EXIF's own colon-separated format", () => {
    const iso = parseExifDate("2019:07:04 18:32:10");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(2019);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(4);
    expect(d.getHours()).toBe(18);
  });

  it("accepts a T separator and trailing subsecond junk", () => {
    expect(parseExifDate("2021:01:09T07:05:00")).not.toBeNull();
    expect(parseExifDate("2021:01:09 07:05:00.221")).not.toBeNull();
  });

  it("rejects anything that isn't an EXIF date", () => {
    for (const bad of ["", "not a date", "2019-07-04T18:32:10Z", 1562265130, null, undefined, {}]) {
      expect(parseExifDate(bad)).toBeNull();
    }
  });

  it("rejects a dead-clock date and a date in the future", () => {
    // Cameras with a flat backup battery write 1970 or 1980.
    expect(parseExifDate("1899:12:31 00:00:00")).toBeNull();
    const nextYear = new Date().getFullYear() + 1;
    expect(parseExifDate(`${nextYear}:06:01 12:00:00`)).toBeNull();
  });

  it("rejects an impossible calendar date rather than rolling it over", () => {
    // Date() would silently turn month 13 into January of the next year.
    expect(parseExifDate("2019:13:04 18:32:10")).toBeNull();
  });
});

describe("captureDateFrom", () => {
  it("prefers DateTimeOriginal over the weaker keys", () => {
    const iso = captureDateFrom({
      DateTime: "2020:01:01 00:00:00",
      DateTimeDigitized: "2019:07:04 18:00:00",
      DateTimeOriginal: "2019:07:04 18:32:10",
    });
    expect(new Date(iso!).getMinutes()).toBe(32);
  });

  it("falls through to the next key when the first is unusable", () => {
    const iso = captureDateFrom({ DateTimeOriginal: "", DateTime: "2020:03:05 09:00:00" });
    expect(new Date(iso!).getFullYear()).toBe(2020);
  });

  it("reads a nested {Exif} block", () => {
    const iso = captureDateFrom({ "{Exif}": { DateTimeOriginal: "2018:11:02 06:15:00" } });
    expect(new Date(iso!).getFullYear()).toBe(2018);
  });

  it("returns null for a file with no capture date", () => {
    expect(captureDateFrom(null)).toBeNull();
    expect(captureDateFrom(undefined)).toBeNull();
    expect(captureDateFrom({})).toBeNull();
    expect(captureDateFrom({ Orientation: 1, PixelWidth: 4032 })).toBeNull();
  });
});
