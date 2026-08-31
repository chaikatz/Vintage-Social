import { beforeEach, describe, expect, it } from "vitest";
import {
  demoAddComment,
  demoCurrentProfile,
  demoDecideApplication,
  demoFetchActivity,
  demoFetchApplications,
  demoFetchFeedPage,
  demoFetchProfileByUsername,
  demoFollow,
  demoJoinWithInvite,
  demoLike,
  demoReset,
  demoSearchProfiles,
  demoSignIn,
  demoSignOut,
  demoSubmitApplication,
  demoUnlike,
} from "@/demo/store";
import { DEMO_IDS, DEMO_POSTS, DEMO_PROFILES } from "@/demo/fixtures";

/** The demo store backs the browser-review build; keep its behavior honest. */
describe("demo store", () => {
  beforeEach(() => demoReset());

  it("signs in as a member by default and as admin for admin emails", () => {
    demoSignIn("reviewer@example.com");
    expect(demoCurrentProfile()?.role).toBe("member");
    demoSignIn("admin@vintage.club");
    expect(demoCurrentProfile()?.role).toBe("admin");
    demoSignOut();
    expect(demoCurrentProfile()).toBeNull();
  });

  it("serves a chronological feed of followed members only", () => {
    const feed = demoFetchFeedPage(DEMO_IDS.elena, 0, 50);
    expect(feed.length).toBeGreaterThan(0);
    const followees = new Set<string>([
      DEMO_IDS.elena, DEMO_IDS.tomas, DEMO_IDS.june, DEMO_IDS.arthur,
      DEMO_IDS.margot, DEMO_IDS.niko,
    ]);
    for (const post of feed) {
      expect(followees.has(post.author_id)).toBe(true);
    }
    const times = feed.map((p) => p.created_at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("likes and comments update counts and reverse cleanly", () => {
    const before = demoFetchFeedPage(DEMO_IDS.elena, 0, 1)[0];
    demoLike(DEMO_IDS.elena, before.id);
    let after = demoFetchFeedPage(DEMO_IDS.elena, 0, 1)[0];
    expect(after.like_count).toBe(before.like_count + 1);
    demoUnlike(DEMO_IDS.elena, before.id);
    after = demoFetchFeedPage(DEMO_IDS.elena, 0, 1)[0];
    expect(after.like_count).toBe(before.like_count);

    demoAddComment(DEMO_IDS.elena, before.id, "Lovely.");
    after = demoFetchFeedPage(DEMO_IDS.elena, 0, 1)[0];
    expect(after.comment_count).toBe(before.comment_count + 1);
  });

  it("follow updates counts and the feed", () => {
    const tomasBefore = demoFetchProfileByUsername("tomas.lindqvist")!;
    demoFollow(DEMO_IDS.niko, DEMO_IDS.tomas);
    const tomasAfter = demoFetchProfileByUsername("tomas.lindqvist")!;
    expect(tomasAfter.follower_count).toBe(tomasBefore.follower_count + 1);
    const feed = demoFetchFeedPage(DEMO_IDS.niko, 0, 50);
    expect(feed.some((p) => p.author_id === DEMO_IDS.tomas)).toBe(true);
  });

  it("runs the whole application flow: apply → pending → approve", () => {
    demoSubmitApplication({
      fullName: "Review Er",
      desiredUsername: "review.er",
      avatarUri: null,
      socialHandle: "",
      city: "",
      inviter: "",
      reason: "Testing the flow.",
    });
    expect(demoCurrentProfile()?.status).toBe("applied");

    demoSignIn("admin@vintage.club");
    const pending = demoFetchApplications("pending");
    const mine = pending.find((a) => a.desired_username === "review.er");
    expect(mine).toBeDefined();
    demoDecideApplication(mine!.id, "approved");

    const profile = demoFetchProfileByUsername("review.er");
    expect(profile?.status).toBe("approved");
    expect(profile?.invite_quota).toBeGreaterThan(0);
  });

  it("invite join admits immediately with a live feed", () => {
    demoJoinWithInvite({ fullName: "New Member", desiredUsername: "new.member" });
    const me = demoCurrentProfile();
    expect(me?.status).toBe("approved");
    expect(demoFetchFeedPage(me!.id, 0, 10).length).toBeGreaterThan(0);
  });

  it("derives seeded activity for members", () => {
    const activity = demoFetchActivity(DEMO_IDS.elena);
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.some((a) => a.type === "like")).toBe(true);
    expect(activity.some((a) => a.type === "follow")).toBe(true);
  });

  it("searches approved members only", () => {
    expect(demoSearchProfiles("elena").length).toBe(1);
    // ruby is still an applicant and must not surface in member search
    expect(demoSearchProfiles("ruby").length).toBe(0);
  });
});

/**
 * Regression guard: the demo world must be self-contained. Photographs ship
 * as bundled assets (`demo:` paths) and avatars as inline SVG. If someone
 * reintroduces a remote image host, the app silently depends on a third
 * party again — and typecheck alone will not notice.
 */
describe("demo media is bundled, not remote", () => {
  it("every post points at a bundled photograph", () => {
    for (const post of DEMO_POSTS) {
      if (post.media_type === "photo") {
        expect(post.media_path.startsWith("demo:"), `${post.id} media_path`).toBe(true);
      }
      if (post.thumb_path) {
        expect(post.thumb_path.startsWith("demo:"), `${post.id} thumb_path`).toBe(true);
      }
    }
  });

  it("every avatar is an inline image, never a remote URL", () => {
    for (const profile of DEMO_PROFILES) {
      if (profile.avatar_url) {
        expect(profile.avatar_url.startsWith("data:"), `${profile.username} avatar`).toBe(true);
      }
    }
  });

  it("keeps the two short-video posts (video lives in the same feed)", () => {
    const videos = DEMO_POSTS.filter((p) => p.media_type === "video");
    expect(videos).toHaveLength(2);
    for (const v of videos) {
      expect(v.media_path).toMatch(/^https:/);
      expect(v.duration_seconds).toBeGreaterThan(0);
      expect(v.thumb_path?.startsWith("demo:")).toBe(true);
    }
  });

  it("no fixture references an image host", () => {
    const blob = JSON.stringify([DEMO_POSTS, DEMO_PROFILES]);
    expect(blob).not.toContain("picsum.photos");
  });
});
