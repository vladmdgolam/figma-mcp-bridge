// --- Serialized paint types (discriminated union) ---
type SerializedSolidPaint = {
  type: "SOLID";
  color: string;
  opacity?: number;
};

type SerializedGradientPaint = {
  type:
    | "GRADIENT_LINEAR"
    | "GRADIENT_RADIAL"
    | "GRADIENT_ANGULAR"
    | "GRADIENT_DIAMOND";
  gradientStops: { color: string; opacity: number; position: number }[];
  gradientTransform: Transform;
  opacity?: number;
};

type SerializedImagePaint = {
  type: "IMAGE";
  scaleMode: string;
  imageHash?: string | null;
  imageTransform?: Transform;
  opacity?: number;
};

type SerializedPaint =
  | SerializedSolidPaint
  | SerializedGradientPaint
  | SerializedImagePaint;

// --- Serialized effect types ---
type SerializedShadowEffect = {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  color: string;
  opacity: number;
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
  blendMode: string;
};

type SerializedBlurEffect = {
  type: "LAYER_BLUR" | "BACKGROUND_BLUR";
  radius: number;
};

type SerializedEffect = SerializedShadowEffect | SerializedBlurEffect;

// --- Serialized auto-layout ---
type SerializedAutoLayout = {
  direction: "HORIZONTAL" | "VERTICAL";
  gap: number;
  primaryAxisAlign: string;
  counterAxisAlign: string;
  primaryAxisSizing: string;
  counterAxisSizing: string;
  wrap?: string;
  counterAxisSpacing?: number;
};

// --- Serialized styles ---
type SerializedStyles = {
  opacity?: number;
  blendMode?: string;
  visible?: boolean;
  // Layer-as-mask flags (Figma "Use as mask" / mask groups). isMask=true
  // means the layer's alpha (or luminance, per maskType) is applied as a
  // mask to the sibling layers above it inside the same parent.
  isMask?: boolean;
  maskType?: string;
  fills?: SerializedPaint[] | "mixed";
  strokes?: SerializedPaint[] | "mixed";
  strokeWeight?: number | "mixed";
  strokeAlign?: string;
  dashPattern?: number[];
  effects?: SerializedEffect[];
  cornerRadius?: number | "mixed";
  cornerRadii?: {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  };
  cornerSmoothing?: number;
  autoLayout?: SerializedAutoLayout;
  padding?: { top: number; right: number; bottom: number; left: number };
  clipsContent?: boolean;
  rotation?: number;
  constraints?: { horizontal: string; vertical: string };
};

type SerializedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type NodeStub = {
  id: string;
  name: string;
  type: string;
};

type SerializedLineHeight =
  | { value: number; unit: "PIXELS" | "PERCENT" }
  | { unit: "AUTO" };

type SerializedLetterSpacing = { value: number; unit: "PIXELS" | "PERCENT" };

type SerializedTextSegment = {
  start: number;
  end: number;
  characters: string;
  fills?: SerializedPaint[];
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  fontWeight?: number;
  textDecoration?: string;
  textCase?: string;
  lineHeight?: SerializedLineHeight;
  letterSpacing?: SerializedLetterSpacing;
};

type SerializedNode = {
  id: string;
  name: string;
  type: string;
  bounds?: SerializedBounds;
  characters?: string;
  styles?: SerializedStyles;
  segments?: SerializedTextSegment[];
  children?: (SerializedNode | NodeStub)[];
  childCount?: number;
};

export type SerializeOptions = {
  /**
   * Max depth to serialize fully. At this depth, children are emitted as
   * `{id, name, type}` stubs. 0 = this node + stub children. undefined =
   * unlimited (full recursion, legacy default).
   */
  depth?: number;
};

const isMixed = (value: unknown): value is symbol => typeof value === "symbol";

const toHex = (color: RGB): string => {
  const clamp = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value * 255)));
  const [r, g, b] = [clamp(color.r), clamp(color.g), clamp(color.b)];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const serializeGradientStops = (
  stops: readonly ColorStop[]
): { color: string; opacity: number; position: number }[] =>
  stops.map((stop) => ({
    color: toHex(stop.color),
    opacity: stop.color.a,
    position: stop.position,
  }));

const serializePaints = (
  paints: readonly Paint[] | symbol | undefined
): SerializedPaint[] | "mixed" => {
  if (isMixed(paints)) return "mixed";
  if (!paints || !Array.isArray(paints)) return [];

  return paints
    .filter((paint) => paint.visible !== false)
    .flatMap((paint): SerializedPaint[] => {
      switch (paint.type) {
        case "SOLID":
          return [
            {
              type: "SOLID",
              color: toHex(paint.color),
              opacity: paint.opacity,
            },
          ];
        case "GRADIENT_LINEAR":
        case "GRADIENT_RADIAL":
        case "GRADIENT_ANGULAR":
        case "GRADIENT_DIAMOND":
          return [
            {
              type: paint.type,
              gradientStops: serializeGradientStops(paint.gradientStops),
              gradientTransform: paint.gradientTransform,
              opacity: paint.opacity,
            },
          ];
        case "IMAGE":
          return [
            {
              type: "IMAGE",
              scaleMode: paint.scaleMode,
              imageHash: paint.imageHash,
              imageTransform: paint.imageTransform,
              opacity: paint.opacity,
            },
          ];
        default:
          return [];
      }
    });
};

const serializeEffects = (effects: readonly Effect[]): SerializedEffect[] =>
  effects
    .filter((effect) => effect.visible !== false)
    .flatMap((effect): SerializedEffect[] => {
      switch (effect.type) {
        case "DROP_SHADOW":
        case "INNER_SHADOW":
          return [
            {
              type: effect.type,
              color: toHex(effect.color),
              opacity: effect.color.a,
              offset: effect.offset,
              radius: effect.radius,
              spread: effect.spread,
              blendMode: effect.blendMode,
            },
          ];
        case "LAYER_BLUR":
        case "BACKGROUND_BLUR":
          return [{ type: effect.type, radius: effect.radius }];
        default:
          return [];
      }
    });

const serializeLineHeight = (lineHeight: LineHeight | symbol) => {
  if (isMixed(lineHeight)) return "mixed";
  if ("value" in lineHeight) {
    return { value: lineHeight.value, unit: lineHeight.unit };
  }
  return { unit: lineHeight.unit };
};

const serializeLetterSpacing = (letterSpacing: LetterSpacing | symbol) => {
  if (isMixed(letterSpacing)) return "mixed";
  return { value: letterSpacing.value, unit: letterSpacing.unit };
};

const getBounds = (node: SceneNode): SerializedBounds | undefined => {
  if ("x" in node && "y" in node && "width" in node && "height" in node) {
    return {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }
  return undefined;
};

const SEGMENT_FIELDS = [
  "fills",
  "fontName",
  "fontSize",
  "fontWeight",
  "textDecoration",
  "textCase",
  "lineHeight",
  "letterSpacing",
] as const;

type SegmentField = (typeof SEGMENT_FIELDS)[number];

const getMixedSegmentFields = (node: TextNode): SegmentField[] =>
  SEGMENT_FIELDS.filter((field) => isMixed((node as any)[field]));

const serializeStyledSegments = (
  node: TextNode,
  fields: readonly SegmentField[]
): SerializedTextSegment[] => {
  const raw = node.getStyledTextSegments([...fields]);
  return raw.map((seg) => {
    const out: SerializedTextSegment = {
      start: seg.start,
      end: seg.end,
      characters: node.characters.slice(seg.start, seg.end),
    };
    if ("fills" in seg) {
      const fills = serializePaints(seg.fills as readonly Paint[]);
      if (fills !== "mixed") out.fills = fills;
    }
    if ("fontName" in seg && seg.fontName) {
      out.fontFamily = seg.fontName.family;
      out.fontStyle = seg.fontName.style;
    }
    if ("fontSize" in seg) out.fontSize = seg.fontSize as number;
    if ("fontWeight" in seg) out.fontWeight = seg.fontWeight as number;
    if ("textDecoration" in seg) {
      out.textDecoration = seg.textDecoration as string;
    }
    if ("textCase" in seg) out.textCase = seg.textCase as string;
    if ("lineHeight" in seg) {
      const lh = serializeLineHeight(seg.lineHeight as LineHeight);
      if (lh !== "mixed") out.lineHeight = lh as SerializedLineHeight;
    }
    if ("letterSpacing" in seg) {
      const ls = serializeLetterSpacing(seg.letterSpacing as LetterSpacing);
      if (ls !== "mixed") out.letterSpacing = ls as SerializedLetterSpacing;
    }
    return out;
  });
};

const serializeText = (node: TextNode, base: SerializedNode): SerializedNode => {
  let fontFamily: string | undefined;
  let fontStyle: string | undefined;
  if (typeof node.fontName === "symbol") {
    fontFamily = "mixed";
    fontStyle = "mixed";
  } else if (node.fontName) {
    fontFamily = node.fontName.family;
    fontStyle = node.fontName.style;
  }

  const result: SerializedNode = {
    ...base,
    characters: node.characters,
    styles: {
      ...base.styles,
      fontSize: isMixed(node.fontSize) ? "mixed" : node.fontSize,
      fontFamily,
      fontStyle,
      fontWeight: isMixed(node.fontWeight) ? "mixed" : node.fontWeight,
      textDecoration: isMixed(node.textDecoration)
        ? "mixed"
        : node.textDecoration,
      textCase: isMixed(node.textCase) ? "mixed" : node.textCase,
      lineHeight: serializeLineHeight(node.lineHeight),
      letterSpacing: serializeLetterSpacing(node.letterSpacing),
      textAlignHorizontal: isMixed(node.textAlignHorizontal)
        ? "mixed"
        : node.textAlignHorizontal,
      textAlignVertical: isMixed(node.textAlignVertical)
        ? "mixed"
        : node.textAlignVertical,
      textAutoResize: node.textAutoResize,
    } as unknown as SerializedStyles,
  };

  const mixedFields = getMixedSegmentFields(node);
  if (mixedFields.length > 0) {
    try {
      result.segments = serializeStyledSegments(node, mixedFields);
    } catch {
      // getStyledTextSegments can fail on unloaded fonts; ignore and keep "mixed" markers.
    }
  }

  return result;
};

const serializeStyles = (node: SceneNode): SerializedStyles => {
  const styles: SerializedStyles = {};

  if ("opacity" in node && (node.opacity as number) !== 1) {
    styles.opacity = node.opacity as number;
  }
  if (
    "blendMode" in node &&
    node.blendMode !== "NORMAL" &&
    node.blendMode !== "PASS_THROUGH"
  ) {
    styles.blendMode = node.blendMode as string;
  }
  if ("visible" in node && node.visible === false) {
    styles.visible = false;
  }
  // Mask flags — `isMask` is true on the bottom child of a mask group (or
  // any layer with "Use as mask" toggled). `maskType` further says how it
  // masks: ALPHA, VECTOR, or LUMINANCE. Only emit when actually a mask so
  // typical layers stay terse.
  if ("isMask" in node && (node as { isMask: boolean }).isMask) {
    styles.isMask = true;
    if ("maskType" in node) {
      styles.maskType = (node as { maskType: string }).maskType;
    }
  }

  if ("fills" in node) {
    const fills = serializePaints(node.fills);
    if (fills === "mixed" || fills.length > 0) {
      styles.fills = fills;
    }
  }
  if ("strokes" in node) {
    const strokes = serializePaints(node.strokes);
    if (strokes === "mixed" || strokes.length > 0) {
      styles.strokes = strokes;
      if ("strokeWeight" in node) {
        styles.strokeWeight = isMixed(node.strokeWeight)
          ? "mixed"
          : (node.strokeWeight as number);
      }
      if ("strokeAlign" in node) {
        styles.strokeAlign = node.strokeAlign as string;
      }
    }
  }
  if ("dashPattern" in node) {
    const pattern = node.dashPattern as readonly number[];
    if (pattern.length > 0) {
      styles.dashPattern = [...pattern];
    }
  }

  if ("effects" in node) {
    const effects = node.effects as readonly Effect[];
    if (effects.length > 0) {
      styles.effects = serializeEffects(effects);
    }
  }

  if ("cornerRadius" in node) {
    if (isMixed(node.cornerRadius)) {
      styles.cornerRadius = "mixed";
    } else if ((node.cornerRadius as number) !== 0) {
      styles.cornerRadius = node.cornerRadius as number;
    }
  }
  if ("topLeftRadius" in node) {
    const tl = node.topLeftRadius as number;
    const tr = node.topRightRadius as number;
    const br = node.bottomRightRadius as number;
    const bl = node.bottomLeftRadius as number;
    if (tl !== tr || tr !== br || br !== bl) {
      styles.cornerRadii = {
        topLeft: tl,
        topRight: tr,
        bottomRight: br,
        bottomLeft: bl,
      };
    }
  }
  if ("cornerSmoothing" in node) {
    const smoothing = node.cornerSmoothing as number;
    if (smoothing > 0) {
      styles.cornerSmoothing = smoothing;
    }
  }

  if ("layoutMode" in node) {
    const mode = node.layoutMode as string;
    if (mode !== "NONE") {
      styles.autoLayout = {
        direction: mode as "HORIZONTAL" | "VERTICAL",
        gap: (node as FrameNode).itemSpacing,
        primaryAxisAlign: (node as FrameNode).primaryAxisAlignItems as string,
        counterAxisAlign: (node as FrameNode).counterAxisAlignItems as string,
        primaryAxisSizing: (node as FrameNode).primaryAxisSizingMode as string,
        counterAxisSizing: (node as FrameNode).counterAxisSizingMode as string,
        wrap: "layoutWrap" in node ? (node.layoutWrap as string) : undefined,
        counterAxisSpacing:
          "counterAxisSpacing" in node
            ? (node.counterAxisSpacing as number)
            : undefined,
      };
    }
  }

  if ("paddingLeft" in node) {
    const top = node.paddingTop as number;
    const right = node.paddingRight as number;
    const bottom = node.paddingBottom as number;
    const left = node.paddingLeft as number;
    if (top > 0 || right > 0 || bottom > 0 || left > 0) {
      styles.padding = { top, right, bottom, left };
    }
  }

  if ("clipsContent" in node) {
    styles.clipsContent = node.clipsContent as boolean;
  }
  if ("rotation" in node) {
    const rotation = node.rotation as number;
    if (rotation !== 0) {
      styles.rotation = rotation;
    }
  }
  if ("constraints" in node) {
    const c = node.constraints as Constraints;
    if (c.horizontal !== "MIN" || c.vertical !== "MIN") {
      styles.constraints = { horizontal: c.horizontal, vertical: c.vertical };
    }
  }

  return styles;
};

const stubChild = (child: SceneNode): NodeStub => ({
  id: child.id,
  name: child.name,
  type: child.type,
});

const serializeNodeInner = (
  node: SceneNode,
  options: SerializeOptions,
  currentDepth: number
): SerializedNode => {
  const styles = serializeStyles(node);
  const base: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: getBounds(node),
  };
  if (Object.keys(styles).length > 0) {
    base.styles = styles;
  }

  if (node.type === "TEXT") {
    return serializeText(node, base);
  }

  if ("children" in node) {
    const visibleChildren = node.children.filter(
      (child) => child.visible !== false
    );
    if (visibleChildren.length === 0) {
      return base;
    }

    const { depth } = options;
    if (depth !== undefined && currentDepth >= depth) {
      return {
        ...base,
        children: visibleChildren.map(stubChild),
        childCount: visibleChildren.length,
      };
    }

    return {
      ...base,
      children: visibleChildren.map((child) =>
        serializeNodeInner(child, options, currentDepth + 1)
      ),
    };
  }

  return base;
};

export const serializeNode = (
  node: SceneNode,
  options: SerializeOptions = {}
): SerializedNode => serializeNodeInner(node, options, 0);
