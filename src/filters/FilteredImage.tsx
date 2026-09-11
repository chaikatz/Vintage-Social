import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { StyleProp, ViewStyle } from "react-native";
import { GLView, ExpoWebGLRenderingContext } from "expo-gl";
import { Asset } from "expo-asset";
import { buildColorMatrix, toShaderUniforms } from "./colorMatrix";
import { coverUV } from "./coverFit";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shader";
import type { FilterSpec } from "./types";

export interface FilteredImageHandle {
  /** Bake the current render to a JPEG file and return its uri. */
  snapshot(): Promise<{ uri: string; width: number; height: number }>;
}

interface Props {
  /** Local or remote image uri. */
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
  onReady?: () => void;
  /** The photograph could not be read into the renderer — a format the
   * decoder does not know, or a file that is not there. */
  onError?: (error: Error) => void;
}

interface GLState {
  gl: ExpoWebGLRenderingContext;
  program: WebGLProgram;
}

export const FilteredImage = forwardRef<FilteredImageHandle, Props>(
  function FilteredImage({ uri, width, height, filter, style, onReady, onError }, ref) {
    const glViewRef = useRef<GLView>(null);
    const stateRef = useRef<GLState | null>(null);
    const filterRef = useRef(filter);
    const sizeRef = useRef({ width: width ?? null, height: height ?? null });
    sizeRef.current = { width: width ?? null, height: height ?? null };
    // A stable seed per mount keeps grain still between re-renders but
    // unique per photo.
    const grainSeed = useMemo(() => Math.random() * 100, []);

    const draw = useCallback(
      (state: GLState) => {
        const { gl, program } = state;
        const spec = filterRef.current;
        const { matrix, offset } = toShaderUniforms(
          buildColorMatrix(spec.adjustments, spec.monochrome),
        );

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.useProgram(program);
        const fit = coverUV(
          sizeRef.current.width,
          sizeRef.current.height,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
        );
        gl.uniform2fv(gl.getUniformLocation(program, "uUVScale"), new Float32Array(fit.scale));
        gl.uniform2fv(gl.getUniformLocation(program, "uUVOffset"), new Float32Array(fit.offset));
        gl.uniformMatrix4fv(
          gl.getUniformLocation(program, "uColorMatrix"),
          false,
          new Float32Array(matrix),
        );
        gl.uniform4fv(gl.getUniformLocation(program, "uColorOffset"), new Float32Array(offset));
        gl.uniform1f(gl.getUniformLocation(program, "uFade"), spec.artifacts.fade);
        gl.uniform3fv(
          gl.getUniformLocation(program, "uFadeColor"),
          new Float32Array(spec.artifacts.fadeColor),
        );
        gl.uniform1f(gl.getUniformLocation(program, "uVignette"), spec.artifacts.vignette);
        gl.uniform1f(gl.getUniformLocation(program, "uGrain"), spec.artifacts.grain);
        gl.uniform1f(gl.getUniformLocation(program, "uGrainSeed"), grainSeed);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.endFrameEXP();
      },
      [grainSeed],
    );

    // Redraw whenever the selected filter or the stated size changes.
    useEffect(() => {
      filterRef.current = filter;
      if (stateRef.current) draw(stateRef.current);
    }, [filter, width, height, draw]);

    const setUp = useCallback(
      async (gl: ExpoWebGLRenderingContext) => {
        const compile = (type: number, source: string): WebGLShader => {
          const shader = gl.createShader(type);
          if (!shader) throw new Error("Could not create shader");
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
          }
          return shader;
        };

        const program = gl.createProgram();
        if (!program) throw new Error("Could not create GL program");
        gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
        }
        gl.useProgram(program);

        // Full-screen quad.
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const aPosition = gl.getAttribLocation(program, "aPosition");
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

        // Source photo as a texture. expo-gl accepts a downloaded Asset —
        // as a JPEG or PNG on a local path; it has no HEIC decoder and no
        // idea of EXIF orientation, which is why library originals are
        // re-encoded before they get here (see prepareForDarkroom).
        const asset = Asset.fromURI(uri);
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error("The photograph could not be read");
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
        gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);

        stateRef.current = { gl, program };
        draw(stateRef.current);
        onReady?.();
      },
      [uri, draw, onReady],
    );

    const onContextCreate = useCallback(
      async (gl: ExpoWebGLRenderingContext) => {
        try {
          await setUp(gl);
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      },
      [setUp, onError],
    );

    useImperativeHandle(ref, () => ({
      async snapshot() {
        const view = glViewRef.current;
        if (!view || !stateRef.current) {
          throw new Error("Filter renderer is not ready yet");
        }
        draw(stateRef.current);
        const shot = await view.takeSnapshotAsync({ format: "jpeg", compress: 0.9 });
        return { uri: String(shot.uri), width: shot.width, height: shot.height };
      },
    }));

    return <GLView ref={glViewRef} style={style} onContextCreate={onContextCreate} />;
  },
);
