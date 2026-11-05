import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVACY_POLICY } from "@/legal/documents";

/**
 * The privacy manifest (PrivacyInfo.xcprivacy) the build writes from
 * app.json → ios.privacyManifests, and whether it says the same thing as
 * the Privacy Policy and the App Store privacy label.
 *
 * Expo's prebuild writes app.json's manifest into the app target; then
 * React Native's `pod install` appends the required-reason APIs it finds
 * in each pod's own manifest. The app's manifest still declares every
 * category the linked code uses, so it is complete even where a pod ships
 * none, and it alone carries what the app collects.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const require = createRequire(path.join(root, "package.json"));

interface Manifest {
  NSPrivacyTracking: boolean;
  NSPrivacyTrackingDomains: string[];
  NSPrivacyAccessedAPITypes: { NSPrivacyAccessedAPIType: string; NSPrivacyAccessedAPITypeReasons: string[] }[];
  NSPrivacyCollectedDataTypes: {
    NSPrivacyCollectedDataType: string;
    NSPrivacyCollectedDataTypeLinked: boolean;
    NSPrivacyCollectedDataTypeTracking: boolean;
    NSPrivacyCollectedDataTypePurposes: string[];
  }[];
}

const manifest = (): Manifest => JSON.parse(read("app.json")).expo.ios.privacyManifests;

// Apple's names: https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests
const DATA_TYPES = new Set(
  [
    "Name", "EmailAddress", "PhoneNumber", "PhysicalAddress", "OtherUserContactInfo", "Health", "Fitness",
    "PaymentInfo", "CreditInfo", "OtherFinancialInfo", "PreciseLocation", "CoarseLocation", "SensitiveInfo",
    "Contacts", "EmailsOrTextMessages", "PhotosorVideos", "AudioData", "GameplayContent", "CustomerSupport",
    "OtherUserContent", "BrowsingHistory", "SearchHistory", "UserID", "DeviceID", "PurchaseHistory",
    "ProductInteraction", "AdvertisingData", "OtherUsageData", "CrashData", "PerformanceData",
    "OtherDiagnosticData", "EnvironmentScanning", "Hands", "Head", "OtherDataTypes",
  ].map((t) => `NSPrivacyCollectedDataType${t}`),
);
const PURPOSES = new Set(
  ["ThirdPartyAdvertising", "DeveloperAdvertising", "Analytics", "ProductPersonalization", "AppFunctionality", "Other"].map(
    (p) => `NSPrivacyCollectedDataTypePurpose${p}`,
  ),
);
// Apple's approved reasons, for the categories this app's code can reach.
const REASONS: Record<string, string[]> = {
  NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1", "1C8F.1", "C56D.1", "AC6B.1"],
  NSPrivacyAccessedAPICategoryFileTimestamp: ["DDA9.1", "C617.1", "3B52.1", "0A2A.1"],
  NSPrivacyAccessedAPICategorySystemBootTime: ["35F9.1", "8FFB.1", "3D61.1"],
  NSPrivacyAccessedAPICategoryDiskSpace: ["85F4.1", "E174.1", "7D9E.1", "B728.1"],
  NSPrivacyAccessedAPICategoryActiveKeyboards: ["3EC4.1", "54BD.1"],
};

/**
 * What the app collects, each with where the Privacy Policy says so —
 * the label in App Store Connect is the same list (APP_STORE_LAUNCH.md).
 */
const COLLECTED: Record<string, { policy: string[]; purpose: string }> = {
  EmailAddress: { policy: ["Your email address"], purpose: "AppFunctionality" },
  Name: { policy: ["the name and username you choose"], purpose: "AppFunctionality" },
  OtherUserContactInfo: { policy: ["where your photographs live online"], purpose: "AppFunctionality" },
  PhotosorVideos: { policy: ["Photographs and short films you publish", "optional portrait"], purpose: "AppFunctionality" },
  EmailsOrTextMessages: { policy: ["the messages you send to other members"], purpose: "AppFunctionality" },
  OtherUserContent: { policy: ["your caption", "your likes and comments", "the answers you give"], purpose: "AppFunctionality" },
  PreciseLocation: { policy: ["the point on the map it stands for"], purpose: "AppFunctionality" },
  CoarseLocation: { policy: ["bio and city"], purpose: "AppFunctionality" },
  UserID: { policy: ["the name and username you choose"], purpose: "AppFunctionality" },
  DeviceID: { policy: ["Device token."], purpose: "AppFunctionality" },
  ProductInteraction: { policy: ["Sharing outside VINTAGE."], purpose: "Analytics" },
};

function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, ext) : ext.test(e.name) ? [p] : [];
  });
}

const declared = () => new Map(manifest().NSPrivacyAccessedAPITypes.map((t) => [t.NSPrivacyAccessedAPIType, t.NSPrivacyAccessedAPITypeReasons]));

describe("the privacy manifest", () => {
  it("says the app does not track, with no tracking domains", () => {
    expect(manifest().NSPrivacyTracking).toBe(false);
    expect(manifest().NSPrivacyTrackingDomains).toEqual([]);
    for (const t of manifest().NSPrivacyCollectedDataTypes) {
      expect(t.NSPrivacyCollectedDataTypeTracking, t.NSPrivacyCollectedDataType).toBe(false);
      expect(t.NSPrivacyCollectedDataTypePurposes, t.NSPrivacyCollectedDataType).not.toContain(
        "NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising",
      );
    }
  });

  it("uses only Apple's names, and an approved reason for each API category", () => {
    for (const t of manifest().NSPrivacyCollectedDataTypes) {
      expect(DATA_TYPES.has(t.NSPrivacyCollectedDataType), t.NSPrivacyCollectedDataType).toBe(true);
      expect(typeof t.NSPrivacyCollectedDataTypeLinked).toBe("boolean");
      expect(t.NSPrivacyCollectedDataTypePurposes.length).toBeGreaterThan(0);
      for (const p of t.NSPrivacyCollectedDataTypePurposes) expect(PURPOSES.has(p), p).toBe(true);
    }
    for (const [category, reasons] of declared()) {
      expect(REASONS[category], category).toBeDefined();
      expect(reasons.length, category).toBeGreaterThan(0);
      for (const r of reasons) expect(REASONS[category], `${category} ${r}`).toContain(r);
    }
  });

  it("declares every required-reason category the app's own native code uses", () => {
    const swift = walk(path.join(root, "modules"), /\.swift$/).map((f) => readFileSync(f, "utf8")).join("\n");
    const uses: [string, RegExp][] = [
      ["NSPrivacyAccessedAPICategoryFileTimestamp", /contentModificationDateKey|creationDateKey|attributesOfItem|\.modificationDate|\.creationDate\b|fileModificationDate|\bstat\(/],
      ["NSPrivacyAccessedAPICategoryUserDefaults", /UserDefaults|NSUserDefaults/],
      ["NSPrivacyAccessedAPICategorySystemBootTime", /systemUptime|mach_absolute_time/],
      ["NSPrivacyAccessedAPICategoryDiskSpace", /volumeAvailableCapacity|NSFileSystemFreeSize|systemFreeSize|statfs/],
      ["NSPrivacyAccessedAPICategoryActiveKeyboards", /activeInputModes/],
    ];
    // The Memory Room's cache sweep reads file dates in the app's own caches folder: C617.1.
    expect(swift).toMatch(/contentModificationDateKey/);
    for (const [category, pattern] of uses) {
      if (pattern.test(swift)) expect(declared().has(category), category).toBe(true);
    }
    expect(declared().get("NSPrivacyAccessedAPICategoryFileTimestamp")).toContain("C617.1");
  });

  it("covers every category the linked libraries declare, so it holds even if the pods' manifests are not merged", () => {
    const deps = Object.keys(JSON.parse(read("package.json")).dependencies);
    const shipped = walk(path.join(root, "node_modules/react-native/React/Resources"), /^PrivacyInfo\.xcprivacy$/);
    for (const dep of deps) {
      try {
        shipped.push(...walk(path.join(root, "node_modules", dep, "ios"), /^PrivacyInfo\.xcprivacy$/));
      } catch {
        // no ios folder: nothing native to declare
      }
    }
    expect(shipped.length).toBeGreaterThan(3);
    const categories = new Set(
      shipped.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/<string>(NSPrivacyAccessedAPICategory\w+)<\/string>/g)].map((m) => m[1])),
    );
    // React Native's own pod step adds the boot-time reason for the core (privacy_manifest_utils.rb).
    categories.add("NSPrivacyAccessedAPICategorySystemBootTime");
    for (const c of categories) expect(declared().has(c), c).toBe(true);
  });

  it("is written by Expo's prebuild step into a valid PrivacyInfo.xcprivacy, merged with what is already there", () => {
    const { mergePrivacyInfo } = require("@expo/config-plugins/build/ios/PrivacyInfo.js");
    const plist = require("@expo/plist").default;
    const core = plist.parse(read("node_modules/react-native/React/Resources/PrivacyInfo.xcprivacy"));
    const merged = plist.parse(plist.build(mergePrivacyInfo(core, manifest())));
    expect(merged.NSPrivacyTracking).toBe(false);
    expect(merged.NSPrivacyCollectedDataTypes.map((t: { NSPrivacyCollectedDataType: string }) => t.NSPrivacyCollectedDataType)).toEqual(
      manifest().NSPrivacyCollectedDataTypes.map((t) => t.NSPrivacyCollectedDataType),
    );
    const reasons = new Map(
      merged.NSPrivacyAccessedAPITypes.map((t: { NSPrivacyAccessedAPIType: string; NSPrivacyAccessedAPITypeReasons: string[] }) => [
        t.NSPrivacyAccessedAPIType,
        t.NSPrivacyAccessedAPITypeReasons,
      ]),
    );
    expect(reasons.get("NSPrivacyAccessedAPICategoryUserDefaults")).toContain("CA92.1");
    expect(reasons.get("NSPrivacyAccessedAPICategoryFileTimestamp")).toContain("C617.1");
    expect(reasons.get("NSPrivacyAccessedAPICategorySystemBootTime")).toContain("35F9.1");
    expect(reasons.get("NSPrivacyAccessedAPICategoryDiskSpace")).toContain("E174.1");
  });
});

describe("what the app collects", () => {
  it("is the same list in the manifest and the Privacy Policy", () => {
    const listed = manifest().NSPrivacyCollectedDataTypes.map((t) => t.NSPrivacyCollectedDataType.replace("NSPrivacyCollectedDataType", ""));
    expect([...listed].sort()).toEqual(Object.keys(COLLECTED).sort());
    for (const t of manifest().NSPrivacyCollectedDataTypes) {
      const name = t.NSPrivacyCollectedDataType.replace("NSPrivacyCollectedDataType", "");
      expect(t.NSPrivacyCollectedDataTypeLinked, name).toBe(true);
      expect(t.NSPrivacyCollectedDataTypePurposes, name).toEqual([`NSPrivacyCollectedDataTypePurpose${COLLECTED[name].purpose}`]);
      for (const phrase of COLLECTED[name].policy) expect(PRIVACY_POLICY, `${name}: "${phrase}"`).toContain(phrase);
    }
  });

  it("includes the share notes, because the app writes them with the member's id", () => {
    const shares = read("src/api/shares.ts");
    expect(shares).toMatch(/from\("share_events"\)\.insert\(\{[\s\S]*actor_id: userId/);
    expect(manifest().NSPrivacyCollectedDataTypes.some((t) => t.NSPrivacyCollectedDataType === "NSPrivacyCollectedDataTypeProductInteraction")).toBe(true);
  });

  it("includes the post's point, because a typed place is stored as one", () => {
    expect(read("src/api/places.ts")).toMatch(/lat: place\.lat, lng: place\.lng/);
    expect(manifest().NSPrivacyCollectedDataTypes.some((t) => t.NSPrivacyCollectedDataType === "NSPrivacyCollectedDataTypePreciseLocation")).toBe(true);
  });
});
