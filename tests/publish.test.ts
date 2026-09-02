import { describe, expect, it, vi } from "vitest";
import { ownedPath, pathOwner } from "@/utils/storagePath";
import {
  PublishStepError,
  describePublishFailure,
  errorDetail,
  publishStep,
} from "@/utils/publishError";

/**
 * The client half of the publish contract. The database half — who may
 * actually insert a post or a storage object — is covered against a real
 * PostgreSQL by `npm run test:rls`.
 */

describe("storage keys", () => {
  it("namespaces a file under its owner", () => {
    expect(ownedPath("user-1", "abc.jpg")).toBe("user-1/abc.jpg");
  });

  it("round-trips the owner the storage policy will read", () => {
    const path = ownedPath("user-1", "abc.jpg");
    expect(pathOwner(path)).toBe("user-1");
  });

  it("reports no owner for a key at the bucket root", () => {
    // The policies reject these; the client should never build one.
    expect(pathOwner("loose.jpg")).toBeNull();
    expect(pathOwner("/leading.jpg")).toBeNull();
  });

  it("does not let one member's key claim another's folder", () => {
    expect(pathOwner(ownedPath("me", "x.jpg"))).not.toBe("you");
  });
});

describe("publish failures name the step", () => {
  it("tags the step that threw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await publishStep("media-upload", async () => {
      throw new Error("new row violates row-level security policy");
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PublishStepError);
    expect((err as PublishStepError).step).toBe("media-upload");
    expect(describePublishFailure(err)).toContain("uploading the photograph");
    expect(describePublishFailure(err)).toContain("row-level security");
  });

  it("tells the upload steps apart", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = () => Promise.reject(new Error("nope"));
    const media = await publishStep("media-upload", boom).catch((e) => e);
    const thumb = await publishStep("thumbnail-upload", boom).catch((e) => e);
    const insert = await publishStep("post-insert", boom).catch((e) => e);

    expect(describePublishFailure(media)).toContain("uploading the photograph");
    expect(describePublishFailure(thumb)).toContain("uploading the thumbnail");
    expect(describePublishFailure(insert)).toContain("saving the post");
  });

  it("passes a successful step straight through", async () => {
    await expect(publishStep("resize", async () => 42)).resolves.toBe(42);
  });

  it("keeps the Supabase status and code out of the generic message", () => {
    // A storage rejection and a PostgREST rejection carry the same words;
    // the code is what tells them apart in a log.
    expect(errorDetail({ message: "denied", statusCode: "403" })).toBe("denied (status 403)");
    expect(errorDetail({ message: "denied", code: "42501" })).toBe("denied (code 42501)");
  });

  it("describes a plain error unchanged", () => {
    expect(describePublishFailure(new Error("no renderer"))).toBe("no renderer");
  });
});
