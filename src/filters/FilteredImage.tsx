import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { PixelRatio, StyleProp, ViewStyle } from "react-native";
import { GLView, ExpoWebGLRenderingContext } from "expo-gl";
import { Asset } from "expo-asset";
import { perfStart } from "@/utils/perf";
import { BAKE_MAX_SIDE, BAKE_QUALITY, BAKE_TIMEOUT_MS, bakeOutputSize, grainCells } from "./bakeSize";
import { buildColorMatrix, toShaderUniforms } from "./colorMatrix";
import { coverUV } from "./coverFit";
import {
  afterFrames,
  canMipmap,
  centreOf,
  createReadyGate,
  isEmptyPixel,
  sizeProblem,
  uriProblem,
  waitUntilReady,
} from "./renderGate";
import { FRAGMENT_SHADER, UNIFORMS, VERTEX_SHADER } from "./shader";
import type { UniformName } from "./shader";
import type { FilterSpec } from "./types";

export interface BakeOptions {
  /** Cap on the long side, in pixels. Defaults to the feed's 1440. */
  maxSide?: number;
  /** JPEG quality, 0 to 1. Defaults to 0.92. */
  quality?: number;
  /** How long to wait for a renderer that is still loading. Defaults to 2000 ms. */
  timeoutMs?: number;
}

export interface BakeResult {
  uri: string;
  width: number;
  height: number;
}

export interface FilteredImageHandle {
  /**
   * Render the current filter OFFSCREEN at output size, independent of the
   * view: long side = min(maxSide, source long side), each dimension rounded
   * down to a multiple of the screen scale. Read back from an app-owned FBO
   * (explicit framebuffer), and return the JPEG.
   * Waits for the renderer to be ready, up to timeoutMs (default 2000).
   * Rejects if the texture is empty or invalid.
   */
  bake(opts?: BakeOptions): Promise<BakeResult>;
  /** Kept for compatibility: same as bake({}). */
  snapshot(): Promise<BakeResult>;
}

interface Props {
  /** The photograph, as a local `file://` JPEG or PNG: the only thing the
   * GL decoder reads. Anything else is reported through `onError`. */
  uri: string;
  /**
   * The photograph's own size. With it the picture is cropped to cover
   * the view like a print trimmed to a frame; without it the renderer has
   * to assume the two match, and a portrait in a 4:5 frame comes out
   * squashed.
   */
  width?: number | null;
  height?: number | null;
  filter: FilterSpec;
  style?: StyleProp<ViewStyle>;
  /** The first filtered frame is on screen: whatever stood in for it can go. */
  onReady?: () => void;
  /** The photograph could not be read into the renderer — a format the
   * decoder does not know, a file that is not there, one too large for the
   * GPU — or the renderer itself failed. Nothing was drawn. */
  onError?: (error: Error) => void;
}

type Uniforms = Record<UniformName, WebGLUniformLocation>;

interface GLState {
  gl: ExpoWebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  uniforms: Uniforms;
  maxTextureSize: number;
  /** The preview frame in pixels. expo-gl sizes the drawing buffer once,
   * when the context is made, so this holds for the renderer's life. */
  frame: { width: number; height: number };
}

/** Where a draw goes: the view's own framebuffer (null), or a bake's. */
interface DrawTarget {
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
}

/** GL objects this renderer made, released when it closes or fails. */
interface Owned {
  program?: WebGLProgram | null;
  buffer?: WebGLBuffer | null;
  texture?: WebGLTexture | null;
}

/** The same GPU serves every context, so its texture limit is asked once,
 * not once per swatch: each question is a blocking trip to the GL thread. */
let deviceMaxTextureSize: number | null = null;

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

export const FilteredImage = forwardRef<FilteredImageHandle, Props>(function FilteredImage(props, ref) {
  // A renderer reads its photograph once, when its context is made. Keyed
  // by the uri, a different photograph gets a renderer of its own instead
  // of being ignored; the film tray, for one, may be handed a smaller copy
  // of the photograph once that copy is made.
  return <Renderer key={props.uri} {...props} ref={ref} />;
});

const Renderer = forwardRef<FilteredImageHandle, Props>(function Renderer(
  { uri, width, height, filter, style, onReady, onError },
  ref,
) {
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const stateRef = useRef<GLState | null>(null);
  const ownedRef = useRef<Owned>({});
  const aliveRef = useRef(true);
  const drawnRef = useRef(false);
  const bakeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const [gate] = useState(createReadyGate);
  const filterRef = useRef(filter);
  const sizeRef = useRef({ width: width ?? null, height: height ?? null });
  sizeRef.current = { width: width ?? null, height: height ?? null };
  // The callbacks are read when the frame lands, well after the render
  // that passed them; the latest ones are the ones that count.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // A stable seed per mount keeps grain still between re-renders but
  // unique per photo, and the preview and its bake share it.
  const grainSeed = useMemo(() => Math.random() * 100, []);

  /**
   * One frame of the current filter into the target. It makes no blocking
   * calls: every uniform location was looked up when the program linked.
   * The framebuffer, viewport and texture are set each time rather than
   * assumed, because a bake draws into its own framebuffer at its own size
   * between two preview frames.
   */
  const draw = useCallback(
    (state: GLState, target: DrawTarget) => {
      const { gl, program, texture, uniforms: u } = state;
      const spec = filterRef.current;
      const { matrix, offset } = toShaderUniforms(
        buildColorMatrix(spec.adjustments, spec.monochrome),
      );
      const fit = coverUV(sizeRef.current.width, sizeRef.current.height, target.width, target.height);
      const cells = grainCells(state.frame.width, state.frame.height, target.width, target.height);

      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2fv(u.uUVScale, new Float32Array(fit.scale));
      gl.uniform2fv(u.uUVOffset, new Float32Array(fit.offset));
      gl.uniformMatrix4fv(u.uColorMatrix, false, new Float32Array(matrix));
      gl.uniform4fv(u.uColorOffset, new Float32Array(offset));
      gl.uniform1f(u.uFade, spec.artifacts.fade);
      gl.uniform3fv(u.uFadeColor, new Float32Array(spec.artifacts.fadeColor));
      gl.uniform1f(u.uVignette, spec.artifacts.vignette);
      gl.uniform1f(u.uGrain, spec.artifacts.grain);
      gl.uniform1f(u.uGrainSeed, grainSeed);
      gl.uniform2fv(u.uGrainCells, new Float32Array(cells));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    [grainSeed],
  );

  const drawPreview = useCallback(
    (state: GLState) => {
      draw(state, { framebuffer: null, width: state.frame.width, height: state.frame.height });
      state.gl.endFrameEXP();
    },
    [draw],
  );

  /**
   * Delete what this renderer made. GL calls are only queued until the
   * batch ends, and a closing context never runs the batch it was building,
   * so the frame is ended to send the deletes now: the photograph's texture
   * is the largest thing a renderer holds. A renderer that never showed a
   * checked frame is cleared first, so ending the frame cannot put an
   * undrawn buffer on screen.
   */
  const release = useCallback((gl: ExpoWebGLRenderingContext, showsCheckedFrame: boolean) => {
    const owned = ownedRef.current;
    ownedRef.current = {};
    if (owned.texture) gl.deleteTexture(owned.texture);
    if (owned.buffer) gl.deleteBuffer(owned.buffer);
    if (owned.program) gl.deleteProgram(owned.program);
    if (!showsCheckedFrame) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.endFrameEXP();
  }, []);

  // Redraw whenever the selected filter or the stated size changes.
  useEffect(() => {
    filterRef.current = filter;
    if (stateRef.current) drawPreview(stateRef.current);
  }, [filter, width, height, drawPreview]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      gate.fail(new Error("The filter renderer was closed"));
      const gl = glRef.current;
      stateRef.current = null;
      if (gl) release(gl, drawnRef.current);
    };
  }, [gate, release]);

  /**
   * Compile, upload, check, and draw the first frame. Resolves once that
   * frame has been checked and handed to the display; throws, for
   * onContextCreate to report, when the photograph cannot be shown.
   */
  const setUp = useCallback(
    async (gl: ExpoWebGLRenderingContext) => {
      const stop = perfStart("filters.setUp");
      // Refused before anything is decoded: the decoder runs on the JS
      // thread and fails silently, into an empty texture.
      const unreadable = uriProblem(uri);
      if (unreadable) throw new Error(`The renderer cannot read this photograph: ${unreadable}`);

      const program = linkProgram(gl);
      ownedRef.current.program = program;
      const uniforms = locateUniforms(gl, program);
      gl.useProgram(program);

      // Full-screen quad.
      const buffer = gl.createBuffer();
      ownedRef.current.buffer = buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
      const aPosition = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

      if (deviceMaxTextureSize == null) {
        const reported = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
        if (reported > 0) deviceMaxTextureSize = reported;
      }
      const maxTextureSize = deviceMaxTextureSize ?? 0;
      const tooLarge = sizeProblem(sizeRef.current.width, sizeRef.current.height, maxTextureSize);
      if (tooLarge) throw new Error(`The renderer cannot read this photograph: ${tooLarge}`);

      // Source photo as a texture. expo-gl reads a JPEG or PNG from a local
      // path; it has no HEIC decoder and no idea of EXIF orientation, which
      // is why library originals are re-encoded before they get here (see
      // prepareForDarkroom). The asset only normalises the file URL.
      const asset = Asset.fromURI(uri);
      await asset.downloadAsync();
      // Closed while the file was found: the cleanup released what was made.
      if (!aliveRef.current) return;

      const texture = gl.createTexture();
      ownedRef.current.texture = texture;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        asset as unknown as TexImageSource,
      );
      if (!textureHasPixels(gl, texture)) {
        throw new Error("The renderer could not decode this photograph");
      }

      // Mipmapped, because the tray shows the photograph at a seventh of its
      // size or less and the preview at about two thirds: sampled from the
      // full-size level alone, fine detail aliased and the swatches
      // sparkled. The context is OpenGL ES 3, where a texture of any size
      // can carry mipmaps; an ES 2 fallback keeps plain linear filtering.
      const webgl2 = (gl as unknown as { supportsWebGL2?: boolean }).supportsWebGL2 === true;
      if (canMipmap(webgl2, sizeRef.current.width, sizeRef.current.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      gl.uniform1i(uniforms.uTexture, 0);

      const state: GLState = {
        gl,
        program,
        texture,
        uniforms,
        maxTextureSize,
        frame: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      };

      // Before anything is shown, the frame's centre is drawn on its own
      // into a throwaway 1×1 target and read back, so a frame with nothing
      // in it is never put on screen and never baked. A target of its own
      // makes the check independent of how the view's framebuffer is set
      // up. readPixels is also what makes the GL work so far run now, so
      // the renderer is truly ready once it returns.
      const probe = createTarget(gl, 1, 1);
      const pixel = new Uint8Array(4);
      try {
        draw(state, { framebuffer: probe.framebuffer, width: 1, height: 1 });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      } finally {
        deleteTarget(gl, probe);
      }
      if (isEmptyPixel(pixel)) {
        throw new Error("The renderer drew nothing: the photograph did not reach it");
      }

      drawPreview(state);
      drawnRef.current = true;
      stateRef.current = state;
      gate.open();
      stop({ width: sizeRef.current.width, height: sizeRef.current.height });
    },
    [uri, draw, drawPreview, gate],
  );

  const onContextCreate = useCallback(
    async (gl: ExpoWebGLRenderingContext) => {
      if (!aliveRef.current) return;
      glRef.current = gl;
      try {
        await setUp(gl);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        stateRef.current = null;
        gate.fail(error);
        release(gl, false);
        if (aliveRef.current) onErrorRef.current?.(error);
        return;
      }
      if (gate.state !== "ready") return;
      // endFrameEXP only queues the frame; the view presents it on its next
      // display-link tick. Announcing it sooner let the photograph standing
      // in for the renderer go before the film was on screen.
      await afterFrames(2);
      if (aliveRef.current) onReadyRef.current?.();
    },
    [setUp, gate, release],
  );

  const bakeOnce = useCallback(
    async (opts: BakeOptions): Promise<BakeResult> => {
      const maxSide = opts.maxSide ?? BAKE_MAX_SIDE;
      const quality = opts.quality ?? BAKE_QUALITY;
      await waitUntilReady(gate, opts.timeoutMs ?? BAKE_TIMEOUT_MS);
      const state = stateRef.current;
      if (!state) throw new Error("The filter renderer was closed before the bake");
      const { gl } = state;
      const stop = perfStart("filters.bake");

      // The bake is the frame the member saw (the preview's crop of the
      // photograph, with its vignette and grain), drawn at the size it is
      // published at rather than at the size of the screen.
      const size = bakeOutputSize({
        sourceWidth: sizeRef.current.width,
        sourceHeight: sizeRef.current.height,
        frameWidth: state.frame.width,
        frameHeight: state.frame.height,
        maxSide,
        scale: PixelRatio.get(),
        maxTextureSize: state.maxTextureSize,
      });
      if (!size) throw new Error("The renderer has no frame to bake");

      const target = createTarget(gl, size.width, size.height);
      const { framebuffer } = target;
      try {
        // Never left to expo-gl's default framebuffer (see the snapshot below).
        if (!framebuffer) throw new Error("The renderer could not make a framebuffer to bake into");
        const status: unknown = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        // A destroyed context answers every call with undefined rather than
        // an error. That is how a re-parented GL view fails, so it is named.
        if (typeof status !== "number") throw new Error("The renderer's GL context is gone");
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`The renderer cannot bake at ${size.width}×${size.height}`);
        }

        // Same program, same uniforms, same seed; only the target differs.
        // draw() binds the photograph back to unit 0, so the bake never
        // samples the texture it is drawing into.
        draw(state, { framebuffer, width: size.width, height: size.height });

        // Blocking: the bake's GL work has run once this returns, so the
        // snapshot below reads a finished frame, even if the app is sent to
        // the background in between (expo-gl stops flushing there, and a
        // snapshot taken then would read an undrawn texture).
        const { x, y } = centreOf(size.width, size.height);
        const pixel = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (isEmptyPixel(pixel)) throw new Error("The bake came out empty");

        // The framebuffer is passed explicitly. Without it expo-gl reads
        // `defaultFramebuffer || prev`, a logical OR that is always 1: the
        // view's resolve buffer, recycled by the display link, which could
        // hand back an older film's frame or black.
        //
        // Orientation: the shader flips Y, so the photograph's top row is
        // drawn at the top of the framebuffer (GL's y = height - 1), in this
        // framebuffer exactly as in the view's. glReadPixels returns rows
        // bottom first for any framebuffer, and the snapshot's CGImage takes
        // the first row as its top, so the image it builds is upside down;
        // drawing that into UIKit's flipped context turns it back. The two
        // flips cancel for this framebuffer as they always have for the
        // view's, so no `flip` is asked for and the bake comes out upright.
        //
        // Each side is a multiple of the screen scale (see bakeOutputSize),
        // so the snapshot's conversion to points keeps every pixel as drawn.
        const shot = await GLView.takeSnapshotAsync(gl, {
          framebuffer,
          rect: { x: 0, y: 0, width: size.width, height: size.height },
          format: "jpeg",
          compress: quality,
        });
        const out = typeof shot.uri === "string" && shot.uri ? shot.uri : shot.localUri;
        if (!out) throw new Error("The bake was not written");
        stop({ width: shot.width, height: shot.height, maxSide, quality });
        return { uri: out, width: shot.width, height: shot.height };
      } finally {
        // The preview's framebuffer and viewport come back, the bake's
        // objects go, and the preview frame is drawn again, which also sends
        // the deletes to the GL thread. All of it waits until the snapshot
        // has read the bake's framebuffer, since it is awaited above.
        deleteTarget(gl, target);
        if (stateRef.current === state) drawPreview(state);
        else gl.endFrameEXP();
      }
    },
    [gate, draw, drawPreview],
  );

  useImperativeHandle(
    ref,
    () => {
      // One bake at a time: two at once would share the context's bindings.
      const bake = (opts: BakeOptions = {}): Promise<BakeResult> => {
        // The chain itself never rejects, so a failed bake does not stop
        // the next one.
        const run = bakeChainRef.current.then(() => bakeOnce(opts));
        bakeChainRef.current = run.catch(() => undefined);
        return run;
      };
      return { bake, snapshot: () => bake({}) };
    },
    [bakeOnce],
  );

  return (
    <GLView
      style={style}
      // The GL view's own wrapper always stays a real view. Fabric flattens
      // a plain View out of the native tree, and when an ancestor's style
      // changes (an opacity coming or going) it is flattened or restored,
      // which re-parents its children. expo-gl tears its context down in
      // removeFromSuperview, so a re-parented GL view stops drawing for
      // good and its bake fails. GLView passes this to the wrapper it puts
      // around the native view; with it, only that wrapper ever moves.
      collapsable={false}
      // Multisampling smooths the edges of geometry, and a full-frame quad
      // has none. Off, each renderer's colour and depth-stencil buffers are
      // single-sampled, a quarter of their size at 4x, sixteen renderers to
      // a screen.
      msaaSamples={0}
      onContextCreate={onContextCreate}
    />
  );
});

/**
 * Compile and link the filter program. Compile status is only asked for if
 * linking fails, since every question is a blocking trip to the GL thread
 * and a failed compile always fails the link.
 */
function linkProgram(gl: ExpoWebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  if (!program || !vertex || !fragment) throw new Error("Could not create the GL program");
  gl.shaderSource(vertex, VERTEX_SHADER);
  gl.compileShader(vertex);
  gl.shaderSource(fragment, FRAGMENT_SHADER);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  const linked = !!gl.getProgramParameter(program, gl.LINK_STATUS);
  let reason: string | null = null;
  if (!linked) {
    for (const shader of [vertex, fragment]) {
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        reason = gl.getShaderInfoLog(shader) || "Shader compile failed";
        break;
      }
    }
    reason = reason ?? (gl.getProgramInfoLog(program) || "Program link failed");
  }
  // The linked program keeps what it needs; the shader objects are only
  // flagged while attached and go with it.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (reason) {
    gl.deleteProgram(program);
    throw new Error(reason);
  }
  return program;
}

/** Every uniform location, looked up once (see UNIFORMS). */
function locateUniforms(gl: ExpoWebGLRenderingContext, program: WebGLProgram): Uniforms {
  const found: Partial<Uniforms> = {};
  for (const name of UNIFORMS) {
    const location = gl.getUniformLocation(program, name);
    if (location == null) throw new Error(`The filter program has no uniform ${name}`);
    found[name] = location;
  }
  return found as Uniforms;
}

/** An offscreen RGBA target: a texture, and a framebuffer drawing into it. */
interface Target {
  texture: WebGLTexture | null;
  framebuffer: WebGLFramebuffer | null;
}

/** Make a target and leave its framebuffer bound. It replaces the texture
 * on unit 0, which draw() binds back before it samples. */
function createTarget(gl: ExpoWebGLRenderingContext, width: number, height: number): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { texture, framebuffer };
}

/** Put the view's framebuffer back and delete the target. */
function deleteTarget(gl: ExpoWebGLRenderingContext, target: Target): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
  if (target.texture) gl.deleteTexture(target.texture);
}

/**
 * Whether the upload left the texture with any pixels.
 *
 * A failed decode gives no error: expo-gl uploads a 0×0 image instead, and
 * the shader then samples an incomplete texture, which a driver that
 * follows the spec returns as opaque black. That black cannot be told from
 * a black photograph by drawing it, but a 0×0 image can never complete a
 * framebuffer, so the texture is attached to a throwaway one and asked.
 */
function textureHasPixels(gl: ExpoWebGLRenderingContext, texture: WebGLTexture): boolean {
  const probe = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, probe);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(probe);
  return status === gl.FRAMEBUFFER_COMPLETE;
}
