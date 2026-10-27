import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAKE_MAX_SIDE,
  BAKE_QUALITY,
  BAKE_TIMEOUT_MS,
  bakeOutputSize,
  grainCells,
  scaleStep,
  snapDown,
} from "@/filters/bakeSize";
import { coverCropPx, coverUV } from "@/filters/coverFit";
import {
  NotReadyError,
  afterFrames,
  canMipmap,
  centreOf,
  createReadyGate,
  extensionOf,
  isEmptyPixel,
  sizeProblem,
  uriProblem,
  waitUntilReady,
  withTimeout,
} from "@/filters/renderGate";
import { FRAGMENT_SHADER, UNIFORMS, VERTEX_SHADER } from "@/filters/shader";

/**
 * The renderer's GL calls need a GPU and are checked on a device; the
 * decisions around them are plain arithmetic and are checked here. Getting
 * them wrong is what the members saw: a bake softer than its preview, cut
 * differently from it, a black frame posted as a photograph, or the
 * photograph under the preview taken away a frame before the film arrived.
 */

/** iPhone frames as compose lays them out: 393 pt wide at 3x, and the
 * frame's height from compose's clamped ratio. */
const PORTRAIT_FRAME = { width: 1179, height: 1474 }; // 4:5, 1473.75 rounded by the layer
const LANDSCAPE_FRAME = { width: 1179, height: 884 }; // 4:3

function cropDifference(
  source: { width: number; height: number },
  a: { width: number; height: number },
  b: { width: number; height: number },
): number {
  const fa = coverUV(source.width, source.height, a.width, a.height);
  const fb = coverUV(source.width, source.height, b.width, b.height);
  return Math.max(
    Math.abs(fa.scale[0] - fb.scale[0]),
    Math.abs(fa.scale[1] - fb.scale[1]),
    Math.abs(fa.offset[0] - fb.offset[0]),
    Math.abs(fa.offset[1] - fb.offset[1]),
  );
}

describe("the screen scale the bake is rounded to", () => {
  it("is the whole scale iPhones report", () => {
    expect(scaleStep(1)).toBe(1);
    expect(scaleStep(2)).toBe(2);
    expect(scaleStep(3)).toBe(3);
  });

  it("forgives a scale that arrives a hair under a whole number", () => {
    expect(scaleStep(2.9999999)).toBe(3);
  });

  it("falls back to 1 for anything that is not a sensible scale", () => {
    for (const bad of [0, -2, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(scaleStep(bad)).toBe(1);
    }
  });

  it("rounds a fractional scale down rather than up", () => {
    expect(scaleStep(2.625)).toBe(2);
  });
});

describe("snapping a dimension to the scale", () => {
  it("leaves a multiple alone", () => {
    expect(snapDown(1440, 3)).toBe(1440);
    expect(snapDown(1152, 3)).toBe(1152);
  });

  it("drops the remainder, as expo-gl's conversion to points would", () => {
    // EXGLContext.mm truncates width / scale to whole points: 1474 px at 3x
    // is 491 pt, which is 1473 px.
    expect(snapDown(1474, 3)).toBe(1473);
    expect(snapDown(1153, 2)).toBe(1152);
  });

  it("does not lose a whole step to a ratio that is a hair short", () => {
    expect(snapDown(1151.9999999, 3)).toBe(1152);
    expect(snapDown((1440 * 4) / 5, 3)).toBe(1152);
  });

  it("never returns less than one step", () => {
    expect(snapDown(1, 3)).toBe(3);
    expect(snapDown(0, 2)).toBe(2);
  });
});

describe("the size a photograph is baked at", () => {
  it("bakes a 3:4 photograph in a 4:5 frame at the feed's size, cropped as framed", () => {
    const source = { width: 1536, height: 2048 };
    const frame = { width: 1080, height: 1350 }; // exactly 4:5
    const size = bakeOutputSize({
      sourceWidth: source.width,
      sourceHeight: source.height,
      frameWidth: frame.width,
      frameHeight: frame.height,
      maxSide: 1440,
      scale: 3,
    });
    expect(size).toEqual({ width: 1152, height: 1440 });
    // The frame's shape exactly, so the crop is exactly the preview's.
    expect(cropDifference(source, frame, size!)).toBeLessThan(1e-12);
  });

  it("is the frame's shape, not the photograph's", () => {
    // The member saw the 4:5 crop of a 3:4 photograph; the bake is that crop.
    const size = bakeOutputSize({
      sourceWidth: 1536,
      sourceHeight: 2048,
      frameWidth: PORTRAIT_FRAME.width,
      frameHeight: PORTRAIT_FRAME.height,
      maxSide: 1440,
      scale: 3,
    })!;
    expect(size.height).toBe(1440);
    expect(size.width / size.height).toBeCloseTo(PORTRAIT_FRAME.width / PORTRAIT_FRAME.height, 2);
    expect(size.width / size.height).not.toBeCloseTo(1536 / 2048, 2);
  });

  it("matches the preview's crop to within one screen step on a real frame", () => {
    const source = { width: 1536, height: 2048 };
    const size = bakeOutputSize({
      sourceWidth: source.width,
      sourceHeight: source.height,
      frameWidth: PORTRAIT_FRAME.width,
      frameHeight: PORTRAIT_FRAME.height,
      maxSide: 1440,
      scale: 3,
    })!;
    expect(size).toEqual({ width: 1149, height: 1440 });
    // A step of 3 px in 1149 moves the crop by a quarter of a percent: about
    // two source pixels at each edge of a 2048-pixel photograph.
    expect(cropDifference(source, PORTRAIT_FRAME, size)).toBeLessThanOrEqual(3 / 1149);
  });

  it("bakes a landscape at the feed's size along its width", () => {
    const size = bakeOutputSize({
      sourceWidth: 2048,
      sourceHeight: 1536,
      frameWidth: LANDSCAPE_FRAME.width,
      frameHeight: LANDSCAPE_FRAME.height,
      maxSide: 1440,
      scale: 3,
    })!;
    expect(size.width).toBe(1440);
    expect(size.height % 3).toBe(0);
    expect(size.height).toBeLessThanOrEqual(1440 / (LANDSCAPE_FRAME.width / LANDSCAPE_FRAME.height));
  });

  it("never blows up a small photograph", () => {
    const size = bakeOutputSize({
      sourceWidth: 800,
      sourceHeight: 1000,
      frameWidth: 1080,
      frameHeight: 1350,
      maxSide: 1440,
      scale: 3,
    })!;
    expect(size.width).toBeLessThanOrEqual(800);
    expect(size.height).toBeLessThanOrEqual(1000);
    expect(size).toEqual({ width: 798, height: 999 });
  });

  it("caps at the crop's own detail, not the uncropped photograph's", () => {
    // A 9:16 frame grab in a 4:5 frame shows 1080 × 1350 of its pixels.
    // Sizing by the source's 1920 long side would upscale that crop to
    // 1152 × 1440.
    const size = bakeOutputSize({
      sourceWidth: 1080,
      sourceHeight: 1920,
      frameWidth: 1080,
      frameHeight: 1350,
      maxSide: 1440,
      scale: 3,
    })!;
    expect(size).toEqual({ width: 1080, height: 1350 });
  });

  it("crops a panorama to the widest frame the feed allows", () => {
    const frame = { width: 1179, height: 617 }; // 1.91:1
    const size = bakeOutputSize({
      sourceWidth: 4000,
      sourceHeight: 1000,
      frameWidth: frame.width,
      frameHeight: frame.height,
      maxSide: 1440,
      scale: 3,
    })!;
    expect(size.width).toBe(1440);
    expect(size.width / size.height).toBeCloseTo(frame.width / frame.height, 2);
  });

  it("keeps to what the GPU can draw into", () => {
    const size = bakeOutputSize({
      sourceWidth: 3000,
      sourceHeight: 3000,
      frameWidth: 1000,
      frameHeight: 1000,
      maxSide: 4096,
      scale: 2,
      maxTextureSize: 2048,
    })!;
    expect(size).toEqual({ width: 2048, height: 2048 });
  });

  it("uses the frame alone when the photograph's size is not known", () => {
    // The preview stretches the texture over the frame in that case, and
    // the bake does the same, at the cap.
    const size = bakeOutputSize({
      sourceWidth: null,
      sourceHeight: null,
      frameWidth: 1080,
      frameHeight: 1350,
      maxSide: 1440,
      scale: 3,
    });
    expect(size).toEqual({ width: 1152, height: 1440 });
  });

  it("bakes the whole photograph when there is no frame to match", () => {
    const size = bakeOutputSize({
      sourceWidth: 2048,
      sourceHeight: 1536,
      frameWidth: 0,
      frameHeight: 0,
      maxSide: 1440,
      scale: 2,
    });
    expect(size).toEqual({ width: 1440, height: 1080 });
  });

  it("has nothing to bake with neither a frame nor a photograph size", () => {
    expect(
      bakeOutputSize({
        sourceWidth: null,
        sourceHeight: undefined,
        frameWidth: 0,
        frameHeight: 0,
        maxSide: 1440,
        scale: 3,
      }),
    ).toBeNull();
  });

  it("falls back to the feed's long side for a cap that is not a number", () => {
    for (const maxSide of [0, -1, Number.NaN]) {
      const size = bakeOutputSize({
        sourceWidth: 4000,
        sourceHeight: 5000,
        frameWidth: 4,
        frameHeight: 5,
        maxSide,
        scale: 1,
      })!;
      expect(size.height).toBe(BAKE_MAX_SIDE);
    }
  });

  it("always lands on the scale, under the cap and the detail, in the frame's shape", () => {
    const sources = [
      [1536, 2048],
      [2048, 1536],
      [1080, 1920],
      [4000, 1000],
      [640, 480],
      [2048, 2048],
      [1179, 2556],
    ];
    const frames = [
      [1179, 1474],
      [1179, 884],
      [1290, 1612],
      [750, 938],
      [1179, 617],
      [1000, 1000],
      [210, 210],
    ];
    for (const [sw, sh] of sources) {
      for (const [fw, fh] of frames) {
        for (const scale of [1, 2, 3]) {
          for (const maxSide of [1440, 1080, 2048]) {
            const size = bakeOutputSize({
              sourceWidth: sw,
              sourceHeight: sh,
              frameWidth: fw,
              frameHeight: fh,
              maxSide,
              scale,
            })!;
            const crop = coverCropPx(sw, sh, fw, fh);
            const detail = Math.max(crop.width, crop.height);
            expect(size.width % scale).toBe(0);
            expect(size.height % scale).toBe(0);
            expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(Math.min(maxSide, detail));
            const drift = Math.abs(size.width / size.height / (fw / fh) - 1);
            expect(drift).toBeLessThanOrEqual((2 * scale) / Math.min(size.width, size.height) + 1e-9);
            expect(cropDifference({ width: sw, height: sh }, { width: fw, height: fh }, size))
              .toBeLessThanOrEqual((2 * scale) / Math.min(size.width, size.height) + 1e-9);
          }
        }
      }
    }
  });

  it("has defaults that match the feed and the contract", () => {
    expect(BAKE_MAX_SIDE).toBe(1440);
    expect(BAKE_QUALITY).toBe(0.92);
    expect(BAKE_TIMEOUT_MS).toBe(2000);
  });
});

describe("the crop in source pixels", () => {
  it("is the cover fit, measured in the photograph's pixels", () => {
    // 3:4 picture in a 4:5 frame: full width, a centred 0.9375 of the height.
    expect(coverCropPx(3000, 4000, 800, 1000)).toEqual({
      x: 0,
      y: (4000 - 3750) / 2,
      width: 3000,
      height: 3750,
    });
  });

  it("takes a centred band of a wider picture", () => {
    const crop = coverCropPx(1920, 1080, 500, 500);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBeCloseTo(1080, 6);
    expect(crop.x).toBeCloseTo((1920 - 1080) / 2, 6);
    expect(crop.y).toBe(0);
  });

  it("is the whole picture when the shapes match", () => {
    expect(coverCropPx(1600, 2000, 800, 1000)).toEqual({ x: 0, y: 0, width: 1600, height: 2000 });
  });
});

describe("grain that looks the same in the preview and the bake", () => {
  /** The shader's cell, in JavaScript: (floor(vFrame * cells) + 0.5) / cells. */
  const cellCentre = (v: number, cells: number) => (Math.floor(v * cells) + 0.5) / cells;
  /** Where the fragment of pixel i of n samples the frame. */
  const pixelCentre = (i: number, n: number) => (i + 0.5) / n;

  it("draws the preview's cells one per preview pixel", () => {
    expect(grainCells(1179, 1474, 1179, 1474)).toEqual([1179, 1474]);
  });

  it("gives the bake the preview's cells, not its own pixels", () => {
    expect(grainCells(1179, 1474, 1149, 1440)).toEqual([1179, 1474]);
    expect(grainCells(750, 938, 1152, 1440)).toEqual([750, 938]);
  });

  it("falls back to the target's pixels without a preview frame", () => {
    expect(grainCells(0, 0, 1152, 1440)).toEqual([1152, 1440]);
    expect(grainCells(0, 0, 0, 0)).toEqual([1, 1]);
  });

  it("hashes the preview at the same points it always did", () => {
    // The old shader hashed vFrame itself, which at a pixel's centre is
    // (i + 0.5) / n; the cell's centre is that same point, so the preview's
    // grain keeps its character exactly.
    const n = 1474;
    for (const i of [0, 1, 2, 500, 1000, 1472, 1473]) {
      expect(cellCentre(pixelCentre(i, n), n)).toBeCloseTo(pixelCentre(i, n), 12);
    }
  });

  it("keeps the grain's size on the frame whatever the bake's size", () => {
    // Per-pixel grain at 1440 px would be 1/1440 of the frame; the preview's
    // was 1/1474. With cells it is 1/1474 in both.
    const previewCells = grainCells(1179, 1474, 1179, 1474)[1];
    for (const bakeRows of [1440, 1080, 2048]) {
      const cells = grainCells(1179, 1474, 1149, bakeRows)[1];
      expect(1 / cells).toBe(1 / previewCells);
      // Every bake pixel lands in one of the preview's cells, and running
      // down the bake they advance in order, never jumping back.
      let last = -1;
      for (let j = 0; j < bakeRows; j++) {
        const cell = Math.floor(pixelCentre(j, bakeRows) * cells);
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(cells);
        expect(cell).toBeGreaterThanOrEqual(last);
        last = cell;
      }
    }
  });

  it("is what the shader does", () => {
    expect(FRAGMENT_SHADER).toContain("floor(vFrame * uGrainCells)");
    expect(FRAGMENT_SHADER).toContain("hash(cell * 512.0)");
    expect(FRAGMENT_SHADER).not.toContain("hash(vFrame");
  });
});

describe("the shader's uniforms", () => {
  const declared = (source: string) =>
    [...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]);

  it("are all looked up once, so drawing never has to ask", () => {
    // A name missing from the list would be looked up never, and expo-gl
    // turns a missing location into location 0: the wrong uniform.
    const all = new Set([...declared(VERTEX_SHADER), ...declared(FRAGMENT_SHADER)]);
    expect(new Set(UNIFORMS)).toEqual(all);
  });

  it("are listed once each", () => {
    expect(new Set(UNIFORMS).size).toBe(UNIFORMS.length);
  });
});

describe("which photographs the renderer will try to read", () => {
  it("reads the extension of a file uri", () => {
    expect(extensionOf("file:///var/mobile/Caches/IMG_0001.HEIC")).toBe("heic");
    expect(extensionOf("file:///var/mobile/Caches/ABC.jpg?v=2")).toBe("jpg");
    expect(extensionOf("file:///var/mobile/Caches/ABC.jpeg#frag")).toBe("jpeg");
    expect(extensionOf("file:///var/mobile/Caches/noext")).toBeNull();
    expect(extensionOf("file:///var/mobile/a.folder/noext")).toBeNull();
    expect(extensionOf("file:///var/mobile/.hidden")).toBeNull();
    expect(extensionOf("file:///var/mobile/trailing.")).toBeNull();
  });

  it("tries local JPEGs and PNGs", () => {
    for (const uri of [
      "file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImageManipulator/A.jpg",
      "file:///var/mobile/Caches/GLView/B.jpeg",
      "file:///var/mobile/Caches/C.PNG",
      "file:///var/mobile/Caches/VideoThumbnails/D.JPG",
      "FILE:///var/mobile/Caches/E.jpg",
    ]) {
      expect(uriProblem(uri)).toBeNull();
    }
  });

  it("lets a local file with no extension through to the decoder", () => {
    expect(uriProblem("file:///var/mobile/tmp/upload")).toBeNull();
  });

  it("refuses anything that is not a local file", () => {
    for (const uri of [
      "https://cdn.example.com/a.jpg",
      "ph://ED7AC36B-A150-4C38-BB8C-B6D696F4F2ED/L0/001",
      "data:image/jpeg;base64,AAAA",
      "assets-library://asset/asset.JPG",
      "/var/mobile/a.jpg",
      "",
      null,
      undefined,
    ]) {
      expect(uriProblem(uri)).toMatch(/not a file on this device/);
    }
  });

  it("refuses the formats its decoder does not know", () => {
    for (const ext of ["heic", "HEIF", "webp", "gif", "avif", "tiff"]) {
      expect(uriProblem(`file:///var/mobile/a.${ext}`)).toMatch(/only JPEG and PNG/);
    }
  });

  it("refuses a photograph larger than the GPU takes, when both sizes are known", () => {
    expect(sizeProblem(4096, 3072, 4096)).toBeNull();
    expect(sizeProblem(4097, 3072, 4096)).toMatch(/4097 pixels/);
    expect(sizeProblem(3072, 8192, 4096)).toMatch(/at most 4096/);
    expect(sizeProblem(null, 8192, 4096)).toBeNull();
    expect(sizeProblem(8192, 8192, 0)).toBeNull();
    expect(sizeProblem(8192, 8192, null)).toBeNull();
  });

  it("speaks plainly, without exclamation marks", () => {
    const messages = [
      uriProblem("https://a/b.jpg"),
      uriProblem("file:///a.heic"),
      sizeProblem(9000, 9000, 4096),
    ];
    for (const message of messages) expect(message).not.toMatch(/!/);
  });
});

describe("mipmaps", () => {
  it("are always available on OpenGL ES 3", () => {
    expect(canMipmap(true, 1536, 2048)).toBe(true);
    expect(canMipmap(true, null, null)).toBe(true);
  });

  it("need power-of-two sides on an ES 2 fallback", () => {
    expect(canMipmap(false, 1024, 2048)).toBe(true);
    expect(canMipmap(false, 1536, 2048)).toBe(false);
    expect(canMipmap(false, null, 1024)).toBe(false);
  });
});

describe("checking a drawn frame", () => {
  it("reads the centre pixel", () => {
    expect(centreOf(1, 1)).toEqual({ x: 0, y: 0 });
    expect(centreOf(1149, 1440)).toEqual({ x: 574, y: 720 });
    expect(centreOf(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("calls a frame empty when nothing was drawn into it", () => {
    // What readPixels leaves behind on a destroyed context.
    expect(isEmptyPixel(new Uint8Array(4))).toBe(true);
    expect(isEmptyPixel([12, 40, 9, 0])).toBe(true);
    expect(isEmptyPixel([])).toBe(true);
  });

  it("does not mistake a black photograph for an empty frame", () => {
    expect(isEmptyPixel(new Uint8Array([0, 0, 0, 255]))).toBe(false);
    expect(isEmptyPixel([200, 180, 160, 255])).toBe(false);
  });
});

describe("the renderer's ready gate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens once", async () => {
    const gate = createReadyGate();
    expect(gate.state).toBe("pending");
    gate.open();
    gate.fail(new Error("late"));
    expect(gate.state).toBe("ready");
    expect(gate.error).toBeNull();
    await expect(gate.promise).resolves.toBeUndefined();
  });

  it("fails once, with the reason", async () => {
    const gate = createReadyGate();
    const reason = new Error("The renderer could not decode this photograph");
    gate.fail(reason);
    gate.open();
    gate.fail(new Error("second"));
    expect(gate.state).toBe("failed");
    expect(gate.error).toBe(reason);
    await expect(gate.promise).rejects.toBe(reason);
  });

  it("fails quietly when nobody is waiting", async () => {
    // The film tray's renderers are never baked. A failure with no bake
    // waiting must not surface as an unhandled rejection (vitest fails the
    // run on one).
    createReadyGate().fail(new Error("unobserved"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("lets a bake through as soon as the renderer is ready", async () => {
    vi.useFakeTimers();
    const gate = createReadyGate();
    const waiting = waitUntilReady(gate, 2000);
    await vi.advanceTimersByTimeAsync(300);
    gate.open();
    await expect(waiting).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a bake through at once when it was ready before", async () => {
    vi.useFakeTimers();
    const gate = createReadyGate();
    gate.open();
    await expect(waitUntilReady(gate, 2000)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up on a renderer that is still loading after the timeout", async () => {
    vi.useFakeTimers();
    const gate = createReadyGate();
    const waiting = waitUntilReady(gate, 2000);
    const settled = expect(waiting).rejects.toBeInstanceOf(NotReadyError);
    await vi.advanceTimersByTimeAsync(1999);
    expect(gate.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await settled;
  });

  it("fails a waiting bake at once when the renderer fails, not at the timeout", async () => {
    vi.useFakeTimers();
    const gate = createReadyGate();
    const waiting = waitUntilReady(gate, 2000);
    const reason = new Error("The filter renderer was closed");
    gate.fail(reason);
    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a timeout that is not a number as no wait at all", async () => {
    vi.useFakeTimers();
    const waiting = withTimeout(new Promise<void>(() => undefined), Number.NaN, "never");
    const settled = expect(waiting).rejects.toThrow("never");
    await vi.advanceTimersByTimeAsync(0);
    await settled;
  });
});

describe("announcing the first frame", () => {
  /** requestAnimationFrame, driven by hand. */
  function frames() {
    const queue: Array<() => void> = [];
    return {
      raf: (callback: () => void) => queue.push(callback),
      tick() {
        const due = queue.splice(0);
        for (const callback of due) callback();
      },
      get pending() {
        return queue.length;
      },
    };
  }

  it("waits two frames after the GL work, so the frame is on screen first", async () => {
    const clock = frames();
    let announced = false;
    const done = afterFrames(2, clock.raf).then(() => {
      announced = true;
    });
    await Promise.resolve();
    expect(announced).toBe(false);
    clock.tick();
    await Promise.resolve();
    expect(announced).toBe(false);
    clock.tick();
    await done;
    expect(announced).toBe(true);
    expect(clock.pending).toBe(0);
  });

  it("asks for one frame at a time", () => {
    const clock = frames();
    void afterFrames(3, clock.raf);
    expect(clock.pending).toBe(1);
    clock.tick();
    expect(clock.pending).toBe(1);
  });

  it("resolves straight away for no frames", async () => {
    const clock = frames();
    await afterFrames(0, clock.raf);
    expect(clock.pending).toBe(0);
  });
});
