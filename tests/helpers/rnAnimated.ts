import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { root } from "./screenSource";

/**
 * React Native's own Animated nodes — the very files in node_modules that
 * the phone runs — loaded in node against a fake of the native side, so a
 * test can follow what the native driver would be told and what it would
 * draw. The Flow types are stripped with Babel, as Metro strips them; the
 * modules they lean on that are not Animated's own (the native module and
 * its event emitter, the feature flags, colours, Platform) are small
 * stand-ins. Nothing here renders: a view is a node that reads another, as
 * a component's animated style does, and attaches or lets go of it as a
 * render would.
 */

const RN = path.join(root, "node_modules/react-native");
const requireHere = createRequire(path.join(root, "package.json"));

/** The native side, as far as these nodes speak to it: its nodes, their connections, and the scroll events bound to them. */
export class FakeNative {
  readonly nodes = new Map<number, { config: Record<string, unknown>; value: number; offset: number }>();
  /** Child tag → parent tags, as `connectAnimatedNodes` made them. */
  private readonly parents = new Map<number, Set<number>>();
  /** A view's scroll events, and the value node each is bound to (`addAnimatedEventToView`). */
  readonly drivers: { view: number; event: string; tag: number }[] = [];
  private next = 1;

  readonly API = {
    createAnimatedNode: (tag: number, config: Record<string, unknown>) => {
      this.nodes.set(tag, { config, value: Number(config.value ?? 0), offset: Number(config.offset ?? 0) });
    },
    dropAnimatedNode: (tag: number) => {
      this.nodes.delete(tag);
    },
    connectAnimatedNodes: (parent: number, child: number) => {
      const set = this.parents.get(child) ?? new Set<number>();
      set.add(parent);
      this.parents.set(child, set);
    },
    disconnectAnimatedNodes: (parent: number, child: number) => {
      this.parents.get(child)?.delete(parent);
    },
    connectAnimatedNodeToView: () => undefined,
    disconnectAnimatedNodeFromView: () => undefined,
    restoreDefaultValues: () => undefined,
    addAnimatedEventToView: (view: number, event: string, mapping: { animatedValueTag: number }) => {
      this.drivers.push({ view, event, tag: mapping.animatedValueTag });
    },
    removeAnimatedEventFromView: (view: number, event: string, tag: number) => {
      const i = this.drivers.findIndex((d) => d.view === view && d.event === event && d.tag === tag);
      if (i >= 0) this.drivers.splice(i, 1);
    },
    setAnimatedNodeValue: (tag: number, value: number) => {
      const node = this.nodes.get(tag);
      if (node) node.value = value;
    },
    setAnimatedNodeOffset: (tag: number, offset: number) => {
      const node = this.nodes.get(tag);
      if (node) node.offset = offset;
    },
    flattenAnimatedNodeOffset: () => undefined,
    extractAnimatedNodeOffset: () => undefined,
    getValue: (tag: number, done: (value: number) => void) => done(this.nodes.get(tag)?.value ?? 0),
    startListeningToAnimatedNodeValue: () => undefined,
    stopListeningToAnimatedNodeValue: () => undefined,
    startAnimatingNode: () => undefined,
    stopAnimation: () => undefined,
    flushQueue: () => undefined,
    setWaitingForIdentifier: () => undefined,
    unsetWaitingForIdentifier: () => undefined,
  };

  readonly helper = {
    API: this.API,
    generateNewNodeTag: () => this.next++,
    generateNewAnimationId: () => this.next++,
    assertNativeAnimatedModule: () => undefined,
    shouldUseNativeDriver: (config: { useNativeDriver?: boolean } | null) => !!config?.useNativeDriver,
    shouldSignalBatch: false,
    transformDataType: (v: unknown) => v,
    nativeEventEmitter: { addListener: () => ({ remove: () => undefined }) },
  };

  /** The pager's scroll view reports an offset, as UIKit does for a swipe or a scroll the list made itself. */
  scroll(view: number, x: number): void {
    for (const d of this.drivers) {
      if (d.view !== view || d.event !== "onScroll") continue;
      const node = this.nodes.get(d.tag);
      if (node) node.value = x;
    }
  }

  /** The value node a view's scroll is bound to, if any. */
  boundTo(view: number): number | null {
    return this.drivers.find((d) => d.view === view && d.event === "onScroll")?.tag ?? null;
  }

  /** What the native side computes for node `tag`, as it would set it on the view. */
  evaluate(tag: number): number {
    const node = this.nodes.get(tag);
    if (!node) throw new Error(`no native node ${tag}`);
    const c = node.config as {
      type: string;
      input?: number[];
      inputRange?: number[];
      outputRange?: number[];
      extrapolateLeft?: string;
      extrapolateRight?: string;
    };
    const parents = [...(this.parents.get(tag) ?? [])];
    switch (c.type) {
      case "value":
        return node.value + node.offset;
      case "addition":
        return (c.input ?? []).reduce((sum, t) => sum + this.evaluate(t), 0);
      case "multiplication":
        return (c.input ?? []).reduce((product, t) => product * this.evaluate(t), 1);
      case "interpolation": {
        const x = this.evaluate(parents[0]);
        const [i0, i1] = c.inputRange ?? [0, 1];
        const [o0, o1] = c.outputRange ?? [0, 1];
        let t = (x - i0) / (i1 - i0);
        if (c.extrapolateLeft === "clamp") t = Math.max(0, t);
        if (c.extrapolateRight === "clamp") t = Math.min(1, t);
        return o0 + t * (o1 - o0);
      }
      case "view":
        return this.evaluate(parents[0]);
      default:
        throw new Error(`no evaluation for ${c.type}`);
    }
  }
}

type Node = {
  __attach(): void;
  __detach(): void;
  __addChild(child: unknown): void;
  __removeChild(child: unknown): void;
  __makeNative(config?: unknown): void;
  __getNativeTag(): number;
  __getValue(): number;
  __isNative: boolean;
  __nativeTag?: number;
  interpolate(config: unknown): Node;
};
export type AnimatedNode = Node;
export type AnimatedValueNode = Node & { setValue(value: number): void };

export interface LoadedAnimated {
  Value: new (value: number) => AnimatedValueNode;
  Addition: new (a: Node, b: Node) => Node;
  Multiplication: new (a: Node, b: Node) => Node;
  /** A view whose animated style reads one node at a time, as a component's opacity does. */
  View: new () => { tag: number; read(node: Node): void; opacity(): number; reads(): Node | null };
  /** The pager's `Animated.event` on its scroll, attached to the scroll view `view`, as `useAnimatedProps` attaches it. */
  attachScroll(view: number, value: Node): { detach(): void };
}

/** Loads Animated's nodes afresh, speaking to `native`. */
export function loadAnimated(native: FakeNative): LoadedAnimated {
  const babel = requireHere("@babel/core") as typeof import("@babel/core");
  const plugins = [
    requireHere.resolve("babel-plugin-syntax-hermes-parser"),
    requireHere.resolve("@babel/plugin-transform-flow-strip-types"),
    requireHere.resolve("@babel/plugin-transform-modules-commonjs"),
  ];
  const stubs: Record<string, Record<string, unknown>> = {
    "src/private/animated/NativeAnimatedHelper": { default: native.helper },
    "src/private/animated/NativeAnimatedValidation": { validateInterpolation: () => undefined, validateStyles: () => undefined, validateTransform: () => undefined },
    "src/private/featureflags/ReactNativeFeatureFlags": new Proxy({}, { get: () => () => false }),
    "Libraries/Interaction/InteractionManager": { default: { createInteractionHandle: () => 0, clearInteractionHandle: () => undefined } },
    "Libraries/StyleSheet/normalizeColor": { default: () => null },
    "Libraries/StyleSheet/processColor": { default: () => null },
    "Libraries/StyleSheet/flattenStyle": { default: (s: unknown) => s },
    "Libraries/Utilities/Platform": { default: { OS: "ios" } },
    "Libraries/ReactNative/RendererProxy": { findNodeHandle: (v: unknown) => v },
  };
  const invariant = (ok: unknown, message?: string) => {
    if (!ok) throw new Error(message ?? "invariant");
  };
  const outside: Record<string, unknown> = {
    invariant: Object.assign(invariant, { default: invariant }),
    nullthrows: Object.assign((x: unknown) => x, { default: (x: unknown) => x }),
    react: { isValidElement: () => false },
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();

  const load = (abs: string): Record<string, unknown> => {
    const rel = path.relative(RN, abs).replace(/\.js$/, "");
    if (stubs[rel]) return { __esModule: true, ...stubs[rel] };
    const file = abs.endsWith(".js") ? abs : `${abs}.js`;
    const kept = cache.get(file);
    if (kept) return kept.exports;
    const out = babel.transformSync(readFileSync(file, "utf8"), { filename: file, babelrc: false, configFile: false, plugins })?.code ?? "";
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(file, mod);
    const local = (spec: string) => (spec in outside ? outside[spec] : load(path.resolve(path.dirname(file), spec)));
    new Function("require", "module", "exports", "__DEV__", out)(local, mod, mod.exports, false);
    return mod.exports;
  };
  const from = (f: string) => load(path.join(RN, "Libraries/Animated", f));

  const Value = from("nodes/AnimatedValue").default as LoadedAnimated["Value"];
  const Addition = from("nodes/AnimatedAddition").default as LoadedAnimated["Addition"];
  const Multiplication = from("nodes/AnimatedMultiplication").default as LoadedAnimated["Multiplication"];
  const WithChildren = from("nodes/AnimatedWithChildren").default as new () => Node;
  const event = from("AnimatedEvent") as { attachNativeEventImpl?: Attach; attachNativeEvent?: Attach };
  type Attach = (view: unknown, name: string, mapping: unknown[]) => { detach(): void };
  const attach = (event.attachNativeEventImpl ?? event.attachNativeEvent) as Attach;

  /** A component's animated props, reduced to the one node its opacity reads. */
  class Reader extends WithChildren {
    constructor(readonly parent: Node) {
      super();
    }
    __attach() {
      this.parent.__addChild(this);
    }
    __detach() {
      this.parent.__removeChild(this);
      super.__detach();
    }
    __getNativeConfig() {
      return { type: "view" };
    }
  }

  let views = 100;
  class View {
    readonly tag = views++;
    private reader: Reader | null = null;
    /** A render that hands the view `node`: the new one attaches before the old lets go, as `useAnimatedProps` does. */
    read(node: Node): void {
      if (this.reader?.parent === node) return;
      const next = new Reader(node);
      next.__attach();
      this.reader?.__detach();
      this.reader = next;
    }
    reads(): Node | null {
      return this.reader?.parent ?? null;
    }
    /** What the native driver draws: the native graph's value for the node this view reads. */
    opacity(): number {
      const r = this.reader;
      if (!r) return 1;
      if (!r.__isNative) return r.parent.__getValue();
      return native.evaluate(r.__getNativeTag());
    }
  }

  return {
    Value,
    Addition,
    Multiplication,
    View,
    attachScroll: (view, value) => attach(view, "onScroll", [{ nativeEvent: { contentOffset: { x: value } } }]),
  };
}
