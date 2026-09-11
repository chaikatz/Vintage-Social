import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Appearance: { setColorScheme: vi.fn() } }));
vi.mock("expo-file-system", () => ({ Paths: { document: "/documents" }, File: class {} }));

const { parseAppearance } = await import("@/utils/appearance");

describe("the appearance choice", () => {
  it("reads only the three prints and falls back to the phone's", () => {
    expect(parseAppearance("dark")).toBe("dark");
    expect(parseAppearance("light")).toBe("light");
    expect(parseAppearance("system")).toBe("system");
    expect(parseAppearance("sepia")).toBe("system");
    expect(parseAppearance(null)).toBe("system");
  });
});
