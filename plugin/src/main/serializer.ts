// --- Serialized paint types (discriminated union) ---
type SerializedSolidPaint = {
  type: "SOLID";
  color: string;
  opacity?: number;
};

type SerializedGradientPaint = {
  type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
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

type SerializedPaint = SerializedSolidPaint | SerializedGradientPaint | SerializedImagePaint;

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
  blurType?: "PROGRESSIVE";
  startRadius?: number;
  startOffset?: { x: number; y: number };
  endOffset?: { x: number; y: number };
};

/** NOISE / TEXTURE / GLASS: their own fields, colors as hex. */
type SerializedOtherEffect = { type: "NOISE" | "TEXTURE" | "GLASS"; [key: string]: unknown };

type SerializedEffect = SerializedShadowEffect | SerializedBlurEffect | SerializedOtherEffect;

// --- Serialized auto-layout ---
type SerializedAutoLayout = {
  direction: "HORIZONTAL" | "VERTICAL" | "GRID";
  gap: number;
  primaryAxisAlign: string;
  counterAxisAlign: string;
  primaryAxisSizing: string;
  counterAxisSizing: string;
  wrap?: string;
  counterAxisSpacing?: number;
  counterAxisAlignContent?: string;
  itemReverseZIndex?: boolean;
  strokesIncludedInLayout?: boolean;
  grid?: {
    rows: number;
    columns: number;
    rowGap: number;
    columnGap: number;
    rowSizes: Array<{ type: string; value?: number }>;
    columnSizes: Array<{ type: string; value?: number }>;
  };
};

// --- Serialized styles ---
type SerializedStyles = {
  opacity?: number;
  blendMode?: string;
  visible?: boolean;
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
  /** How this node sizes inside / as an auto-layout frame (omitted when both FIXED). */
  layoutSizing?: { horizontal: string; vertical: string };
  layoutPositioning?: "ABSOLUTE";
  sizeLimits?: { minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number };
  gridChild?: { row: number; column: number; rowSpan: number; columnSpan: number };
  locked?: boolean;
  isMask?: boolean;
  maskType?: string;
  /** Text-only extras, present when not at their defaults. */
  text?: Record<string, unknown>;
  /** Linked styles (by slot) and variable bindings (field → variable id). */
  tokens?: {
    styles?: Record<string, string>;
    variables?: Record<string, string | string[]>;
    explicitModes?: Record<string, string>;
  };
};

type SerializedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SerializedNode = {
  id: string;
  name: string;
  type: string;
  bounds?: SerializedBounds;
  characters?: string;
  styles?: SerializedStyles;
  children?: SerializedNode[];
  childCount?: number;
  truncated?: boolean;
};

const isMixed = (value: unknown): value is symbol => typeof value === "symbol";

const toHex = (color: RGB): string => {
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value * 255)));
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
          if ("blurType" in effect && effect.blurType === "PROGRESSIVE") {
            return [
              {
                type: effect.type,
                radius: effect.radius,
                blurType: "PROGRESSIVE",
                startRadius: effect.startRadius,
                startOffset: effect.startOffset,
                endOffset: effect.endOffset,
              },
            ];
          }
          return [{ type: effect.type, radius: effect.radius }];
        case "NOISE":
          return [
            {
              type: "NOISE",
              noiseType: effect.noiseType,
              color: toHex(effect.color),
              colorOpacity: effect.color.a,
              ...(effect.noiseType === "DUOTONE"
                ? {
                    secondaryColor: toHex(effect.secondaryColor),
                    secondaryColorOpacity: effect.secondaryColor.a,
                  }
                : {}),
              ...(effect.noiseType === "MULTITONE" ? { opacity: effect.opacity } : {}),
              noiseSize: effect.noiseSize,
              density: effect.density,
              blendMode: effect.blendMode,
            },
          ];
        case "TEXTURE":
          return [
            {
              type: "TEXTURE",
              noiseSize: effect.noiseSize,
              radius: effect.radius,
              clipToShape: effect.clipToShape,
            },
          ];
        case "GLASS":
          return [
            {
              type: "GLASS",
              lightIntensity: effect.lightIntensity,
              lightAngle: effect.lightAngle,
              refraction: effect.refraction,
              depth: effect.depth,
              dispersion: effect.dispersion,
              radius: effect.radius,
            },
          ];
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

const getBounds = (node: SerializableNode): SerializedBounds | undefined => {
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

const serializeText = (node: TextNode, base: SerializedNode) => {
  let fontFamily: string | undefined;
  let fontStyle: string | undefined;
  if (typeof node.fontName === "symbol") {
    fontFamily = "mixed";
    fontStyle = "mixed";
  } else if (node.fontName) {
    fontFamily = node.fontName.family;
    fontStyle = node.fontName.style;
  }
  return {
    ...base,
    characters: node.characters,
    styles: {
      ...base.styles,
      fontSize: isMixed(node.fontSize) ? "mixed" : node.fontSize,
      fontFamily,
      fontStyle,
      fontWeight: isMixed(node.fontWeight) ? "mixed" : node.fontWeight,
      textDecoration: isMixed(node.textDecoration) ? "mixed" : node.textDecoration,
      lineHeight: serializeLineHeight(node.lineHeight),
      letterSpacing: serializeLetterSpacing(node.letterSpacing),
      textAlignHorizontal: isMixed(node.textAlignHorizontal) ? "mixed" : node.textAlignHorizontal,
      textAlignVertical: isMixed(node.textAlignVertical) ? "mixed" : node.textAlignVertical,
      textAutoResize: node.textAutoResize,
      ...textExtras(node),
    },
  };
};

/** Non-default text settings that the base text fields don't cover. */
const textExtras = (node: TextNode): { text?: Record<string, unknown> } => {
  const out: Record<string, unknown> = {};
  const pick = (key: string, value: unknown, isDefault: (v: unknown) => boolean) => {
    if (isMixed(value)) out[key] = "mixed";
    else if (value !== undefined && value !== null && !isDefault(value)) out[key] = value;
  };
  pick("textCase", node.textCase, (v) => v === "ORIGINAL");
  pick("textDecorationStyle", node.textDecorationStyle, (v) => v === "SOLID");
  pick("paragraphSpacing", node.paragraphSpacing, (v) => v === 0);
  pick("paragraphIndent", node.paragraphIndent, (v) => v === 0);
  pick("listSpacing", node.listSpacing, (v) => v === 0);
  pick("leadingTrim", node.leadingTrim, (v) => v === "NONE");
  pick("textTruncation", node.textTruncation, (v) => v === "DISABLED");
  pick("maxLines", node.maxLines, () => false);
  pick("textWrapStyle", node.textWrapStyle, (v) => v === "AUTO");
  pick("hyperlink", node.hyperlink, () => false);
  if (node.characters.length > 0) {
    const lists = node.getStyledTextSegments(["listOptions"]);
    const types = new Set(lists.map((seg) => seg.listOptions.type));
    types.delete("NONE");
    if (types.size) out.listTypes = [...types];
  }
  return Object.keys(out).length ? { text: out } : {};
};

/** Auto-layout child sizing, absolute positioning, size limits, grid cell, lock and mask flags. */
const serializeLayoutChild = (node: SerializableNode, styles: SerializedStyles): void => {
  const n = node as SceneNode & Partial<FrameNode>;
  if ("layoutSizingHorizontal" in n && "layoutSizingVertical" in n) {
    try {
      const h = n.layoutSizingHorizontal as string;
      const v = n.layoutSizingVertical as string;
      if (h !== "FIXED" || v !== "FIXED") styles.layoutSizing = { horizontal: h, vertical: v };
    } catch {
      // Throws on nodes outside an auto-layout context in some editor builds.
    }
  }
  if (n.layoutPositioning === "ABSOLUTE") styles.layoutPositioning = "ABSOLUTE";
  const limits: NonNullable<SerializedStyles["sizeLimits"]> = {};
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
    const value = n[key];
    if (typeof value === "number") limits[key] = value;
  }
  if (Object.keys(limits).length) styles.sizeLimits = limits;
  if (
    n.parent &&
    "layoutMode" in n.parent &&
    n.parent.layoutMode === "GRID" &&
    "gridRowSpan" in n
  ) {
    styles.gridChild = {
      row: n.gridRowAnchorIndex as number,
      column: n.gridColumnAnchorIndex as number,
      rowSpan: n.gridRowSpan as number,
      columnSpan: n.gridColumnSpan as number,
    };
  }
  if (n.locked) styles.locked = true;
  if ("isMask" in n && n.isMask) {
    styles.isMask = true;
    styles.maskType = n.maskType;
  }
};

const serializeStyles = (node: SerializableNode): SerializedStyles => {
  const styles: SerializedStyles = {};

  if ("opacity" in node) {
    styles.opacity = node.opacity as number;
  }
  if ("blendMode" in node) {
    styles.blendMode = node.blendMode as string;
  }
  if ("visible" in node) {
    styles.visible = node.visible;
  }

  if ("fills" in node) {
    styles.fills = serializePaints(node.fills);
  }
  if ("strokes" in node) {
    styles.strokes = serializePaints(node.strokes);
  }
  if ("strokeWeight" in node) {
    styles.strokeWeight = isMixed(node.strokeWeight) ? "mixed" : (node.strokeWeight as number);
  }
  if ("strokeAlign" in node) {
    styles.strokeAlign = node.strokeAlign as string;
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
    styles.cornerRadius = isMixed(node.cornerRadius) ? "mixed" : (node.cornerRadius as number);
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
          "counterAxisSpacing" in node ? (node.counterAxisSpacing as number) : undefined,
      };
      const frame = node as FrameNode;
      const al = styles.autoLayout;
      if (frame.counterAxisAlignContent === "SPACE_BETWEEN")
        al.counterAxisAlignContent = "SPACE_BETWEEN";
      if (frame.itemReverseZIndex) al.itemReverseZIndex = true;
      if (frame.strokesIncludedInLayout) al.strokesIncludedInLayout = true;
      if (mode === "GRID") {
        al.grid = {
          rows: frame.gridRowCount,
          columns: frame.gridColumnCount,
          rowGap: frame.gridRowGap,
          columnGap: frame.gridColumnGap,
          rowSizes: frame.gridRowSizes.map((t) => ({ type: t.type, value: t.value })),
          columnSizes: frame.gridColumnSizes.map((t) => ({ type: t.type, value: t.value })),
        };
      }
    }
  }

  serializeLayoutChild(node, styles);

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
    styles.constraints = { horizontal: c.horizontal, vertical: c.vertical };
  }

  const tokens = serializeTokens(node);
  if (tokens) styles.tokens = tokens;

  return styles;
};

/** Style links and variable bindings — ids only; resolve via get_styles / get_variable_defs. */
const serializeTokens = (node: SerializableNode): SerializedStyles["tokens"] | undefined => {
  const n = node as SceneNode & Record<string, unknown>;
  const out: NonNullable<SerializedStyles["tokens"]> = {};

  const styles: Record<string, string> = {};
  for (const [slot, key] of [
    ["fill", "fillStyleId"],
    ["stroke", "strokeStyleId"],
    ["text", "textStyleId"],
    ["effect", "effectStyleId"],
    ["grid", "gridStyleId"],
  ] as const) {
    const id = n[key];
    if (typeof id === "string" && id) styles[slot] = id;
    else if (isMixed(id)) styles[slot] = "mixed";
  }
  if (Object.keys(styles).length) out.styles = styles;

  const bound = n.boundVariables as
    Record<string, VariableAlias | VariableAlias[] | Record<string, VariableAlias>> | undefined;
  if (bound) {
    const vars: Record<string, string | string[]> = {};
    for (const [field, alias] of Object.entries(bound)) {
      if (Array.isArray(alias)) {
        const ids = alias.map((a) => a?.id).filter(Boolean) as string[];
        if (ids.length) vars[field] = ids;
      } else if (alias && "id" in alias && typeof alias.id === "string") {
        vars[field] = alias.id;
      } else if (alias && typeof alias === "object") {
        // componentProperties-style nested maps
        const ids = Object.values(alias as Record<string, VariableAlias>)
          .map((a) => a?.id)
          .filter(Boolean) as string[];
        if (ids.length) vars[field] = ids;
      }
    }
    if (Object.keys(vars).length) out.variables = vars;
  }

  const modes = n.explicitVariableModes as Record<string, string> | undefined;
  if (modes && Object.keys(modes).length) out.explicitModes = modes;

  return Object.keys(out).length ? out : undefined;
};

/**
 * `serializeNode` is also called with the current page (get_document,
 * get_design_context), which shares the id/name/type/children surface it reads.
 * Every property beyond that is read behind an `in` check.
 */
export type SerializableNode = SceneNode | PageNode;

/**
 * Serializes a node, descending at most `depth` levels into its children.
 *
 * `depth` counts levels of *fully serialized* descendants: depth 0 returns the
 * node itself with each visible child reduced to an `{id, name, type}` stub,
 * depth 1 fully serializes the direct children and stubs the grandchildren, and
 * so on. Stubbed levels also carry `childCount` so a caller can tell an empty
 * container from a truncated one. Pass `Infinity` for the whole subtree.
 *
 * Truncating here rather than in the caller is what keeps a `get_node` on a big
 * frame from serializing tens of thousands of descendants only to throw them
 * away — the payload never gets built in the first place.
 *
 * @param node - Node to serialize.
 * @param depth - Levels of children to serialize fully. Default Infinity.
 * @returns The serialized node.
 */
export const serializeNode = (node: SerializableNode, depth: number = Infinity): SerializedNode => {
  const base: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: getBounds(node),
    styles: serializeStyles(node),
  };

  // Handle Figma TEXT nodes and FigJam STICKY / SHAPE_WITH_TEXT nodes (which
  // expose their label through a `.text` sublayer).
  if (node.type === "TEXT") {
    return serializeText(node, base);
  }
  if ((node.type === "STICKY" || node.type === "SHAPE_WITH_TEXT") && "text" in node) {
    try {
      const textNode = node.text;
      return {
        ...base,
        characters: textNode.characters,
      };
    } catch {
      // text sub-node may not be accessible
    }
  }

  if ("children" in node) {
    const visibleChildren = node.children.filter((child) => child.visible !== false);

    if (depth <= 0) {
      return {
        ...base,
        children: visibleChildren.map((child) => ({
          id: child.id,
          name: child.name,
          type: child.type,
        })),
        childCount: visibleChildren.length,
        truncated: visibleChildren.length > 0 ? true : undefined,
      };
    }

    return {
      ...base,
      children: visibleChildren.map((child) => serializeNode(child, depth - 1)),
    };
  }

  return base;
};
