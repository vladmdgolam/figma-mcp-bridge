/**
 * Plugin-API properties beyond the original hand-written set_* handlers.
 *
 * The server validates every value against its zod schema, so these helpers
 * only check that the target node supports the property and then assign it,
 * letting Figma's own error surface when a combination is invalid (e.g. FILL
 * sizing outside an auto-layout parent).
 */

type Params = Record<string, unknown>;
type Applied = Record<string, unknown>;

const hexToRgb = (hex: string): RGB => {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Invalid hex color: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
};

const hexToRgba = (hex: unknown, alpha: unknown, fallbackHex: string, fallbackAlpha: number) => ({
  ...hexToRgb(typeof hex === "string" ? hex : fallbackHex),
  a: typeof alpha === "number" ? alpha : fallbackAlpha,
});

const describe = (node: BaseNode | object): string =>
  "id" in node ? `${(node as BaseNode).id} (${(node as BaseNode).type})` : "text sublayer";

/** Assigns `params[key]` onto `target[key]` when the param is present. */
const assign = (target: object, params: Params, key: string, applied: Applied): void => {
  if (params[key] === undefined) return;
  if (!(key in target)) {
    throw new Error(`${describe(target)} does not support ${key}`);
  }
  (target as Record<string, unknown>)[key] = params[key];
  applied[key] = (target as Record<string, unknown>)[key];
};

const NODE_KEYS = [
  "topLeftRadius",
  "topRightRadius",
  "bottomRightRadius",
  "bottomLeftRadius",
  "cornerSmoothing",
  "layoutPositioning",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "constraints",
  "clipsContent",
  "blendMode",
  "locked",
  "isMask",
  "maskType",
  "gridRowSpan",
  "gridColumnSpan",
  "gridChildHorizontalAlign",
  "gridChildVerticalAlign",
] as const;

/** Extra set_node_properties keys. Positioning goes first: it changes which sizing modes are legal. */
export const applyNodeExtras = (node: SceneNode, params: Params, applied: Applied): void => {
  for (const key of NODE_KEYS) assign(node, params, key, applied);

  const pos = params.gridPosition as { row: number; column: number } | undefined;
  if (pos) {
    if (!("setGridChildPosition" in node)) {
      throw new Error(`${describe(node)} is not a grid child`);
    }
    node.setGridChildPosition(pos.row, pos.column);
    applied.gridPosition = { row: node.gridRowAnchorIndex, column: node.gridColumnAnchorIndex };
  }
};

const AUTO_LAYOUT_KEYS = [
  "counterAxisAlignContent",
  "itemReverseZIndex",
  "strokesIncludedInLayout",
  "gridRowCount",
  "gridColumnCount",
  "gridRowGap",
  "gridColumnGap",
] as const;

type TrackInput = { type: "FLEX" | "FIXED" | "HUG"; value?: number };

/** Extra set_auto_layout keys (wrap content alignment, z-order, CSS-grid tracks). */
export const applyAutoLayoutExtras = (frame: FrameNode, params: Params, applied: Applied): void => {
  for (const key of AUTO_LAYOUT_KEYS) assign(frame, params, key, applied);

  for (const [sizesKey, countKey] of [
    ["gridRowSizes", "gridRowCount"],
    ["gridColumnSizes", "gridColumnCount"],
  ] as const) {
    const tracks = params[sizesKey] as TrackInput[] | undefined;
    if (!tracks) continue;
    if (frame.layoutMode !== "GRID") {
      throw new Error(`${sizesKey} needs layoutMode GRID on ${describe(frame)}`);
    }
    // Track count follows the list; then configure each live track object.
    frame[countKey] = tracks.length;
    const live = frame[sizesKey];
    tracks.forEach((t, i) => {
      live[i].type = t.type;
      if (t.value !== undefined && t.type !== "HUG") live[i].value = t.value;
    });
    frame[sizesKey] = live;
    applied[sizesKey] = frame[sizesKey].map((s) => ({ type: s.type, value: s.value }));
  }
};

const TEXT_KEYS = [
  "textCase",
  "textDecoration",
  "textDecorationStyle",
  "paragraphSpacing",
  "paragraphIndent",
  "listSpacing",
  "leadingTrim",
  "textTruncation",
  "maxLines",
] as const;

/** Extra set_text_properties keys. Fonts must already be loaded. */
export const applyTextExtras = (
  text: TextNode | TextSublayerNode,
  params: Params,
  applied: Applied
): void => {
  for (const key of TEXT_KEYS) assign(text, params, key, applied);

  if (params.lineHeightAuto === true) {
    text.lineHeight = { unit: "AUTO" };
    applied.lineHeight = text.lineHeight;
  } else if (typeof params.lineHeightPercent === "number") {
    text.lineHeight = { unit: "PERCENT", value: params.lineHeightPercent };
    applied.lineHeight = text.lineHeight;
  }

  if (typeof params.letterSpacingPercent === "number") {
    text.letterSpacing = { unit: "PERCENT", value: params.letterSpacingPercent };
    applied.letterSpacing = text.letterSpacing;
  }

  if (params.hyperlink !== undefined) {
    if (!("hyperlink" in text)) throw new Error(`${describe(text)} does not support hyperlink`);
    text.hyperlink =
      params.hyperlink === null ? null : { type: "URL", value: params.hyperlink as string };
    applied.hyperlink = text.hyperlink;
  }

  if (params.listType !== undefined) {
    const type = params.listType as TextListOptions["type"];
    text.setRangeListOptions(0, text.characters.length, { type });
    applied.listType = type;
  }
};

const STROKE_KEYS = [
  "strokeTopWeight",
  "strokeRightWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "strokeMiterLimit",
] as const;

export const applyStrokeExtras = (node: SceneNode, params: Params, applied: Applied): void => {
  for (const key of STROKE_KEYS) assign(node, params, key, applied);
};

const visible = (raw: Params) => (raw.visible === undefined ? true : Boolean(raw.visible));
const vec = (v: unknown, fallback: Vector): Vector =>
  v && typeof v === "object" ? (v as Vector) : fallback;

/**
 * Builds effects the original set_effects handler didn't know: progressive
 * blur, NOISE, TEXTURE and GLASS. Returns null for types it doesn't handle so
 * the caller can fall through to its own builders.
 */
export const buildExtraEffect = (raw: Params): Effect | null => {
  if (
    (raw.type === "LAYER_BLUR" || raw.type === "BACKGROUND_BLUR") &&
    raw.blurType === "PROGRESSIVE"
  ) {
    return {
      type: raw.type,
      blurType: "PROGRESSIVE",
      radius: raw.radius as number,
      startRadius: typeof raw.startRadius === "number" ? raw.startRadius : 0,
      startOffset: vec(raw.startOffset, { x: 0.5, y: 0 }),
      endOffset: vec(raw.endOffset, { x: 0.5, y: 1 }),
      visible: visible(raw),
    } as Effect;
  }

  if (raw.type === "NOISE") {
    const noiseType = (raw.noiseType as "MONOTONE" | "DUOTONE" | "MULTITONE") ?? "MONOTONE";
    const base = {
      type: "NOISE" as const,
      color: hexToRgba(raw.color, raw.colorOpacity, "#000000", 0.25),
      visible: visible(raw),
      blendMode: (raw.blendMode as BlendMode) ?? "NORMAL",
      noiseSize: typeof raw.noiseSize === "number" ? raw.noiseSize : 1,
      density: typeof raw.density === "number" ? raw.density : 0.5,
    };
    if (noiseType === "DUOTONE") {
      return {
        ...base,
        noiseType,
        secondaryColor: hexToRgba(raw.secondaryColor, raw.secondaryColorOpacity, "#FFFFFF", 0.25),
      } as Effect;
    }
    if (noiseType === "MULTITONE") {
      return {
        ...base,
        noiseType,
        opacity: typeof raw.opacity === "number" ? raw.opacity : 1,
      } as Effect;
    }
    return { ...base, noiseType } as Effect;
  }

  if (raw.type === "TEXTURE") {
    return {
      type: "TEXTURE",
      visible: visible(raw),
      noiseSize: typeof raw.noiseSize === "number" ? raw.noiseSize : 4,
      radius: typeof raw.radius === "number" ? raw.radius : 4,
      clipToShape: raw.clipToShape === undefined ? true : Boolean(raw.clipToShape),
    } as Effect;
  }

  if (raw.type === "GLASS") {
    return {
      type: "GLASS",
      visible: visible(raw),
      lightIntensity: typeof raw.lightIntensity === "number" ? raw.lightIntensity : 0.5,
      lightAngle: typeof raw.lightAngle === "number" ? raw.lightAngle : -45,
      refraction: typeof raw.refraction === "number" ? raw.refraction : 0.5,
      depth: typeof raw.depth === "number" ? raw.depth : 20,
      dispersion: typeof raw.dispersion === "number" ? raw.dispersion : 0,
      radius: typeof raw.radius === "number" ? raw.radius : 4,
    } as Effect;
  }

  return null;
};

/** Builds a Figma Effect from the set_effects / create_style input shape. */
export const buildEffect = (raw: Params, i: number): Effect => {
  const extra = buildExtraEffect(raw);
  if (extra) return extra;
  const type = raw.type;
  if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
    if (typeof raw.color !== "string") {
      throw new Error(`effects[${i}].color must be a hex string`);
    }
    const offset = raw.offset as { x?: unknown; y?: unknown } | undefined;
    if (!offset || typeof offset.x !== "number" || typeof offset.y !== "number") {
      throw new Error(`effects[${i}].offset must be {x,y} numbers`);
    }
    if (typeof raw.radius !== "number") {
      throw new Error(`effects[${i}].radius must be a number`);
    }
    const rgb = hexToRgb(raw.color);
    const alpha = typeof raw.opacity === "number" ? raw.opacity : 1;
    return {
      type,
      color: { r: rgb.r, g: rgb.g, b: rgb.b, a: alpha },
      offset: { x: offset.x, y: offset.y },
      radius: raw.radius,
      spread: typeof raw.spread === "number" ? raw.spread : 0,
      visible: raw.visible === undefined ? true : Boolean(raw.visible),
      blendMode: typeof raw.blendMode === "string" ? (raw.blendMode as BlendMode) : "NORMAL",
    };
  }
  if (type === "LAYER_BLUR" || type === "BACKGROUND_BLUR") {
    if (typeof raw.radius !== "number") {
      throw new Error(`effects[${i}].radius must be a number`);
    }
    return {
      type,
      radius: raw.radius,
      visible: raw.visible === undefined ? true : Boolean(raw.visible),
    } as Effect;
  }
  throw new Error(`Unsupported effect type at effects[${i}]: ${String(type)}`);
};
