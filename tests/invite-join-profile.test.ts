import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Joining by invitation lands in the app, not in the waiting room.
 *
 * The invitation card's join signs the new member up, takes up the
 * invitation, and then asks for the profile with the `refreshProfile` it
 * had from its last draw, made while nobody was signed in. That one took
 * the new member for nobody: no read, no profile, and "loaded", so the
 * root sent a member just let in to "NO APPLICATION YET". And the read the
 * provider sends as the member signs in can leave before the invitation is
 * taken up, and say "applied".
 *
 * The real provider, drawn with react-dom in node (every component draws
 * nothing), against a Supabase whose profile reads are answered by hand.
 */

const h = vi.hoisted(() => ({
  reads: [] as { id: string; resolve: (v: unknown) => void }[],
  authCb: null as ((event: string, session: unknown) => void) | null,
  current: null as unknown,
}));

vi.mock("expo-router", () => ({ router: { dismissAll: () => undefined, replace: () => undefined } }));
vi.mock("@/lib/supabase", () => ({
  forgetStoredSession: vi.fn(),
  readStoredSession: vi.fn(),
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.authCb = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      getSession: async () => ({ data: { session: h.current } }),
    },
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: () => new Promise((resolve) => h.reads.push({ id, resolve })),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/unsignedRead", () => ({ memberSignedIn: () => undefined, takeUnsignedRead: () => false }));
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: vi.fn(), clear: vi.fn() } }));
vi.mock("@/utils/retry", () => ({ withRetry: (fn: () => unknown) => fn(), isTransient: () => false }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/demo/store", () => ({}));
vi.mock("@/utils/push", () => ({ forgetPushTokensEverywhere: vi.fn() }));
vi.mock("@/api/messages", () => ({ forgetSharedPosts: vi.fn() }));
vi.mock("@/darkroom/forget", () => ({ claimDarkroom: vi.fn(), forgetDarkroom: vi.fn() }));
vi.mock("@/uploads", () => ({ forgetOutbox: vi.fn() }));
vi.mock("@/utils/searchHistory", () => ({ clearRecent: vi.fn() }));
vi.mock("@/providers/rememberedMember", () => ({
  forgetMember: vi.fn(),
  recallMember: () => null,
  rememberMember: vi.fn(),
}));
vi.mock("@/providers/launchSession", () => ({
  // Nobody on this phone: the app opens signed out.
  openSession: (_auth: unknown, _stored: unknown, setSession: (s: unknown) => void) => {
    setSession(null);
    return () => undefined;
  },
}));
vi.mock("@/providers/endSession", () => ({ endSession: vi.fn() }));

// react-dom in node, with nothing to draw into but a container it never writes to.
const g = globalThis as Record<string, unknown>;
g.IS_REACT_ACT_ENVIRONMENT = true;
g.window ??= globalThis;
g.HTMLIFrameElement ??= class {};
const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
const container = () => ({
  nodeType: 1,
  nodeName: "DIV",
  tagName: "DIV",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  ownerDocument: doc,
  addEventListener() {},
  removeEventListener() {},
  textContent: "",
  firstChild: null,
  removeChild() {},
  appendChild() {},
});

type Seen = {
  session: unknown;
  profile: { status?: string } | null;
  profileLoaded: boolean;
  refreshProfile: (options?: { fresh?: boolean }) => Promise<boolean>;
};

// react-dom ships no types here (no @types/react-dom); what is used of it, typed by hand.
const reactDomClient = "react-dom/client";
const { createRoot } = (await import(/* @vite-ignore */ reactDomClient)) as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const { act } = await import("react");
const { SessionProvider, useSession } = await import("@/providers/SessionProvider");

async function drawProvider() {
  const seen: Seen[] = [];
  function Probe() {
    seen.push(useSession() as unknown as Seen);
    return null;
  }
  const root = createRoot(container());
  await act(async () => {
    root.render(React.createElement(SessionProvider, null, React.createElement(Probe)));
  });
  return { seen, last: () => seen[seen.length - 1], unmount: () => act(async () => root.unmount()) };
}

const NEW_MEMBER = { user: { id: "new" }, access_token: "t" };
const answer = (status: string) => ({ data: { id: "new", status }, error: null });

/** The root's rule (app/index.tsx): where a signed-in visitor is sent once the profile has loaded. */
function rootSends(s: Seen): "splash" | "app" | "waiting room" {
  if (!s.profileLoaded) return "splash";
  return s.profile?.status === "approved" ? "app" : "waiting room";
}

beforeEach(() => {
  h.reads.length = 0;
  h.current = null;
});

describe("the profile asked for straight after a join", () => {
  it("is read for the new member, with the function the card had while they were signed out", async () => {
    const { last, unmount } = await drawProvider();
    expect(last().session).toBeNull();
    // What the card's submit holds: the function from its last draw, signed out.
    const fromTheCard = last().refreshProfile;

    // The account is made: auth says SIGNED_IN, and the provider reads.
    h.current = NEW_MEMBER;
    await act(async () => h.authCb!("SIGNED_IN", NEW_MEMBER));
    expect(h.reads).toHaveLength(1);
    expect(h.reads[0].id).toBe("new");

    // The invitation is taken up; the card asks for the profile fresh.
    let asked!: Promise<boolean>;
    await act(async () => {
      asked = fromTheCard({ fresh: true });
    });
    // Not taken for nobody: no profile thrown away, nothing called loaded.
    expect(last().profileLoaded).toBe(false);
    // And it waits for the read already out before sending its own.
    expect(h.reads).toHaveLength(1);

    // The provider's read left before the invitation was taken up.
    await act(async () => h.reads[0].resolve(answer("applied")));
    // Then the fresh one goes out, and its answer is the one that stays.
    expect(h.reads).toHaveLength(2);
    expect(h.reads[1].id).toBe("new");
    let landed: boolean | undefined;
    await act(async () => {
      h.reads[1].resolve(answer("approved"));
      landed = await asked;
    });
    expect(landed).toBe(true);
    expect(last().profile?.status).toBe("approved");
    expect(rootSends(last())).toBe("app");
    await unmount();
  });

  it("asked for without fresh, joins the read already out for the new member rather than blanking it", async () => {
    const { last, unmount } = await drawProvider();
    const fromTheCard = last().refreshProfile;
    h.current = NEW_MEMBER;
    await act(async () => h.authCb!("SIGNED_IN", NEW_MEMBER));
    let asked!: Promise<boolean>;
    await act(async () => {
      asked = fromTheCard();
    });
    // The read already out answers it: no second read, and no null profile marked loaded.
    expect(h.reads).toHaveLength(1);
    expect(last().profile).toBeNull();
    expect(last().profileLoaded).toBe(false);
    expect(rootSends(last())).toBe("splash");
    let landed: boolean | undefined;
    await act(async () => {
      h.reads[0].resolve(answer("approved"));
      landed = await asked;
    });
    expect(landed).toBe(true);
    expect(rootSends(last())).toBe("app");
    await unmount();
  });

  it("a read asked for while the fresh one is out joins it, and the earlier read finishing does not let go of it", async () => {
    const { last, unmount } = await drawProvider();
    h.current = NEW_MEMBER;
    await act(async () => h.authCb!("SIGNED_IN", NEW_MEMBER));
    let fresh!: Promise<boolean>;
    await act(async () => {
      fresh = last().refreshProfile({ fresh: true });
    });
    await act(async () => h.reads[0].resolve(answer("applied")));
    expect(h.reads).toHaveLength(2);
    // Asked again while the fresh read is out (the waiting room, say): it joins that one.
    let again!: Promise<boolean>;
    await act(async () => {
      again = last().refreshProfile();
    });
    expect(h.reads).toHaveLength(2);
    await act(async () => {
      h.reads[1].resolve(answer("approved"));
      await Promise.all([fresh, again]);
    });
    expect(last().profile?.status).toBe("approved");
    await unmount();
  });

  it("signed out for real, there is still no profile, and nothing to wait for", async () => {
    const { last, unmount } = await drawProvider();
    let landed: boolean | undefined;
    await act(async () => {
      landed = await last().refreshProfile({ fresh: true });
    });
    expect(landed).toBe(true);
    expect(h.reads).toHaveLength(0);
    expect(last().session).toBeNull();
    expect(last().profile).toBeNull();
    expect(last().profileLoaded).toBe(true);
    await unmount();
  });
});

describe("the screens ask for it", () => {
  const code = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("the invitation card reads the profile fresh once the invitation is taken up, then goes in", () => {
    expect(code("app/(gate)/invite.tsx")).toMatch(
      /await joinWithInvite\(\{[\s\S]*?\}\);\s*await refreshProfile\(\{ fresh: true \}\);\s*await goIn\(\);/,
    );
  });

  it("the waiting room reads the profile fresh once an invitation is taken up there, then goes in", () => {
    // Not joined to the read it made as it opened, which may have left
    // before the invitation was taken up and would send the member back.
    expect(code("app/(gate)/pending.tsx")).toMatch(
      /const takeUp = async \(slug: string\) => \{[\s\S]*?await redeemInviteLink\(slug\);[\s\S]*?await refreshProfile\(\{ fresh: true \}\);\s*await enterApp\(\);/,
    );
  });

  it("the waiting room reads the profile once as it opens, above its redirect", () => {
    const pending = code("app/(gate)/pending.tsx");
    expect(pending).toMatch(/React\.useEffect\(\(\) => \{\s*refreshProfile\(\)\.catch\(\(\) => undefined\);\s*\}, \[\]\);/);
    expect(pending.indexOf("refreshProfile().catch(() => undefined);\n  }, []);")).toBeLessThan(
      pending.indexOf("if (session === null) return <Redirect"),
    );
  });
});
