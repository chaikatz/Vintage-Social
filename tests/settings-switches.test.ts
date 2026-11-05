import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSettingWriter } from "@/components/settingWriter";

/**
 * Settings' switches: each does what it says when it is flipped, the
 * newest flip is the one the server keeps, and a refusal puts the switch
 * back. The private account switch is one of them, not a field for Save.
 */

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("a setting written as it is flipped", () => {
  it("writes one value at a time, and the newest last", async () => {
    const calls: { value: string; d: ReturnType<typeof deferred> }[] = [];
    const saved = vi.fn();
    const failed = vi.fn();
    const w = createSettingWriter<string>({
      write: (value) => {
        const d = deferred();
        calls.push({ value, d });
        return d.promise;
      },
      onSaved: saved,
      onFailed: failed,
    });
    w.set("a");
    w.set("b");
    w.set("c");
    await flush();
    // Only the first is in flight; b is skipped, c waits for it.
    expect(calls.map((c) => c.value)).toEqual(["a"]);
    expect(w.busy).toBe(true);
    calls[0].d.resolve();
    await flush();
    expect(calls.map((c) => c.value)).toEqual(["a", "c"]);
    // "a" landed, but something newer was waiting: nothing is called saved yet.
    expect(saved).not.toHaveBeenCalled();
    calls[1].d.resolve();
    await flush();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith("c");
    expect(failed).not.toHaveBeenCalled();
    expect(w.busy).toBe(false);
  });

  it("never has two writes in flight, however the server answers", async () => {
    let inFlight = 0;
    let most = 0;
    const order: number[] = [];
    const w = createSettingWriter<number>({
      write: async (n) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, n % 2 ? 5 : 1));
        order.push(n);
        inFlight--;
      },
      onSaved: () => undefined,
      onFailed: () => undefined,
    });
    for (let i = 1; i <= 6; i++) {
      w.set(i);
      await new Promise((r) => setTimeout(r, 2));
    }
    await new Promise((r) => setTimeout(r, 40));
    expect(most).toBe(1);
    expect(order.at(-1)).toBe(6);
  });

  it("on a refusal drops what was waiting and says so, once", async () => {
    const calls: { value: boolean; d: ReturnType<typeof deferred> }[] = [];
    const saved = vi.fn();
    const failed = vi.fn();
    const w = createSettingWriter<boolean>({
      write: (value) => {
        const d = deferred();
        calls.push({ value, d });
        return d.promise;
      },
      onSaved: saved,
      onFailed: failed,
    });
    w.set(true);
    w.set(false);
    await flush();
    calls[0].d.reject(new Error("offline"));
    await flush();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(w.busy).toBe(false);
    // A later flip is written again.
    w.set(true);
    await flush();
    expect(calls).toHaveLength(2);
  });
});

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the Settings screen", () => {
  const settings = code("app/settings.tsx");

  it("writes the private account switch as it is flipped, and puts it back if refused", () => {
    expect(settings).toMatch(/onValueChange=\{togglePrivate\}/);
    expect(settings).toMatch(/setIsPrivate\(on\);\s*privacyWriter\.set\(on\);/);
    expect(settings).toMatch(/await updateOwnProfile\(userIdRef\.current, \{ is_private: on \}\);/);
    expect(settings).toMatch(/onFailed: \(err\) => \{\s*setIsPrivate\(savedPrivate\.current\);/);
    // Save no longer carries it: the switch is its one writer.
    const save = settings.slice(settings.indexOf("const save = async"), settings.indexOf("const openDoc"));
    expect(save).not.toMatch(/is_private/);
  });

  it("sends the notification switches through one writer, and goes back to the saved ones if refused", () => {
    expect(settings).toMatch(/prefsWriter\.set\(next\);/);
    expect(settings).not.toMatch(/updateNotificationPrefs\(userId, next\)\s*\.then/);
    expect(settings).toMatch(/onFailed: \(err\) => \{\s*registerAfterSave\.current = false;\s*setPrefsEdit\(null\);/);
    expect(settings).toMatch(
      /await updateNotificationPrefs\(userIdRef\.current, next\);\s*queryClient\.setQueryData\(\["notification-prefs", userIdRef\.current\], next\);/,
    );
  });

  it("writes no notification switch until the member's own row has been read", () => {
    expect(settings).toMatch(/const prefsKnown = prefsQuery\.data != null;/);
    expect(settings).toMatch(/if \(!userId \|\| !prefsKnown\) return;\s*const next = \{ \.\.\.prefs, \[key\]: on \};/);
    expect(settings).toMatch(/onValueChange=\{togglePref\(key\)\}\s*disabled=\{!prefsKnown\}/);
    expect(settings).toMatch(/prefsQuery\.isError && !prefsKnown \? \(\s*<Pressable onPress=\{\(\) => prefsQuery\.refetch\(\)\}/);
  });

  it("names every switch for VoiceOver", () => {
    const switches = settings.match(/<Switch\b[\s\S]*?\/>/g) ?? [];
    expect(switches.length).toBeGreaterThanOrEqual(2);
    for (const s of switches) expect(s).toMatch(/accessibilityLabel=/);
  });

  it("asks whether there is another admin before anything of the only admin's is deleted", () => {
    const del = settings.slice(settings.indexOf("setDeleting(true);"), settings.indexOf("queryClient.clear();", settings.indexOf("setDeleting(true);")));
    const check = del.indexOf("if (isAdmin && !(await anotherAdminExists(userId))) {");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(del.indexOf("await deleteMyAccount(userId);"));
    expect(del.slice(check, del.indexOf("await deleteMyAccount(userId);"))).toMatch(/setDeleting\(false\);[\s\S]*return;/);
    const fn = settings.slice(settings.indexOf("async function anotherAdminExists"), settings.indexOf("export default function Settings"));
    expect(fn).toMatch(/\.eq\("role", "admin"\)\s*\.neq\("id", myId\);\s*if \(error\) throw error;\s*return \(count \?\? 0\) > 0;/);
  });

  it("says where to write when the phone has no mail account", () => {
    expect(settings).toMatch(/Linking\.openURL\(supportMailto\("VINTAGE support"\) \?\? ""\)\.catch\(/);
  });
});
