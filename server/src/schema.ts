import { z } from "zod";
import type { ShapeWithTextNode } from "@figma/plugin-typings/plugin-api-standalone.js";

export const MAX_SVG_BYTES = 2 * 1024 * 1024;

/**
 * Figma node IDs:
 *   - top-level node:        "4029:12345"
 *   - child inside INSTANCE: "I12740:17806;12740:17793" (and deeper, semicolon-separated)
 *
 * Both forms are valid for figma.getNodeById and are returned as-is by the plugin
 * from get_selection / get_design_context.
 */

const FIGMA_NODE_ID = /^(\d+:\d+|I\d+:\d+(;\d+:\d+)+)$/;

/**
 * Normalises the node-id spellings agents copy from URLs and filenames:
 * hyphens (`node-id=4029-12345`), URL encoding (`I498-7837%3B498-7780`,
 * `4029%3A12345`), and stray whitespace.
 */
export const normalizeFigmaNodeId = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  let id = value.trim().replace(/\s+/g, "");
  if (/%[0-9a-fA-F]{2}/.test(id)) {
    try {
      id = decodeURIComponent(id);
    } catch {
      // leave as-is; validation reports it
    }
  }
  return /^I?\d+-\d+(;\d+-\d+)*$/.test(id) ? id.replace(/-/g, ":") : id;
};

/**
 * Creates a Zod schema that validates a Figma node ID string.
 * @returns A Zod string schema for node IDs.
 */
const createFigmaNodeIdSchema = () =>
  z.preprocess(
    normalizeFigmaNodeId,
    // Validated with refine rather than .regex() on purpose: .regex() is
    // exported as a JSON Schema `pattern`, and strict MCP clients enforce it
    // before the call ever reaches this preprocess — so hyphen / %3B forms
    // were rejected client-side despite being normalisable here.
    z
      .string()
      .refine(
        (id) => FIGMA_NODE_ID.test(id),
        (id) => ({
          message: `Invalid node ID ${JSON.stringify(id)}: use colon format, e.g. '4029:12345', or instance-child format 'I12740:17806;12740:17793'`,
        })
      )
      .describe(
        "Figma node ID: '4029:12345', or an instance sublayer 'I12740:17806;12740:17793' (hyphen and URL-encoded forms are accepted)"
      )
  );

/**
 * Creates a Zod schema that validates a screenshot export format.
 * @returns A Zod enum schema for export formats.
 */
const createExportFormatSchema = () => z.enum(["PNG", "SVG", "JPG", "PDF", "WEBP"]);

/**
 * Creates a Zod schema that validates a CSS-style hex color string.
 * @returns A Zod string schema for hex colors.
 */
const createHexColorSchema = () =>
  z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Color must be a hex value like '#FFAA00'");
const textAlignHorizontal = z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]);
const textAlignVertical = z.enum(["TOP", "CENTER", "BOTTOM"]);
const textAutoResize = z.enum(["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"]);
const shapeType = z.enum(["RECTANGLE", "ELLIPSE", "LINE"]);

type FigJamShapeType = ShapeWithTextNode["shapeType"];

const FIGJAM_SHAPE_TYPES = [
  "SQUARE",
  "ELLIPSE",
  "ROUNDED_RECTANGLE",
  "DIAMOND",
  "TRIANGLE_UP",
  "TRIANGLE_DOWN",
  "PARALLELOGRAM_RIGHT",
  "PARALLELOGRAM_LEFT",
  "ENG_DATABASE",
  "ENG_QUEUE",
  "ENG_FILE",
  "ENG_FOLDER",
  "TRAPEZOID",
  "PREDEFINED_PROCESS",
  "SHIELD",
  "DOCUMENT_SINGLE",
  "DOCUMENT_MULTIPLE",
  "MANUAL_INPUT",
  "HEXAGON",
  "CHEVRON",
  "PENTAGON",
  "OCTAGON",
  "STAR",
  "PLUS",
  "ARROW_LEFT",
  "ARROW_RIGHT",
  "SUMMING_JUNCTION",
  "OR",
  "SPEECH_BUBBLE",
  "INTERNAL_STORAGE",
] as const satisfies readonly FigJamShapeType[];

/* Type gymnastics to ensure all shape types are listed on transpile time */
type UnlistedShapeType = Exclude<FigJamShapeType, (typeof FIGJAM_SHAPE_TYPES)[number]>;
const allShapeTypesListed: [UnlistedShapeType] extends [never] ? true : UnlistedShapeType = true;

const figJamShapeType = z.enum(FIGJAM_SHAPE_TYPES);
const imageScaleMode = z.enum(["FILL", "FIT"]);

const fileKeyField = z
  .string()
  .optional()
  .describe(
    "The fileKey of the Figma file to query. Required when multiple files are connected. Use list_files to see connected files."
  );

const gradientStop = z.object({
  position: z
    .number()
    .min(0)
    .max(1)
    .describe("Stop position from 0 (start of gradient) to 1 (end)"),
  hex: createHexColorSchema().describe("Stop color as hex"),
  opacity: z.number().min(0).max(1).optional().describe("Optional per-stop alpha (default 1)"),
});

const gradientTransform = z
  .array(z.array(z.number()).length(3))
  .length(2)
  .describe(
    "2x3 affine matrix [[a,b,tx],[c,d,ty]] mapping the unit gradient onto the shape (Figma's gradientTransform). Defaults to identity (horizontal left→right)."
  );

export const setGradientFillInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  gradientType: z
    .enum(["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"])
    .optional()
    .describe("Gradient family (default LINEAR)"),
  gradientStops: z
    .array(gradientStop)
    .min(2)
    .describe("Ordered list of gradient color stops (at least 2)"),
  gradientTransform: gradientTransform.optional(),
  opacity: z.number().min(0).max(1).optional().describe("Overall paint opacity (default 1)"),
  target: z
    .enum(["fill", "stroke"])
    .optional()
    .describe("Apply to fills or strokes (default fill)"),
  fileKey: fileKeyField,
});

const blendMode = z.enum([
  "PASS_THROUGH",
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "LINEAR_BURN",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "LINEAR_DODGE",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
]);

/** True when any key other than the listed transport keys is set. */
const hasAnyProperty =
  (...transportKeys: string[]) =>
  (value: Record<string, unknown>): boolean =>
    Object.entries(value).some(([k, v]) => v !== undefined && !transportKeys.includes(k));

const nullableSize = z.number().min(0).nullable().optional();

export const setNodePropertiesShape = z.object({
  nodeId: createFigmaNodeIdSchema()
    .optional()
    .describe("The node ID to update. Required unless nodeIds is given."),
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .min(1)
    .optional()
    .describe(
      "Batch: apply the same property changes to multiple nodes. Required unless nodeId is given."
    ),
  name: z.string().optional().describe("Optional new node name"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  rotation: z.number().optional().describe("Optional rotation in degrees"),
  opacity: z.number().min(0).max(1).optional().describe("Optional opacity from 0 to 1"),
  visible: z.boolean().optional().describe("Optional visibility"),
  cornerRadius: z.number().min(0).optional().describe("Optional corner radius"),
  topLeftRadius: z.number().min(0).optional().describe("Per-corner radius"),
  topRightRadius: z.number().min(0).optional(),
  bottomRightRadius: z.number().min(0).optional(),
  bottomLeftRadius: z.number().min(0).optional(),
  cornerSmoothing: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("iOS-style smooth corners, 0–1 (0.6 ≈ Apple squircle)"),
  layoutSizingHorizontal: z
    .enum(["FIXED", "HUG", "FILL"])
    .optional()
    .describe(
      "Auto-layout sizing: HUG needs an auto-layout frame or text; FILL needs an auto-layout parent"
    ),
  layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional(),
  layoutPositioning: z
    .enum(["AUTO", "ABSOLUTE"])
    .optional()
    .describe("ABSOLUTE takes a child of an auto-layout frame out of the flow"),
  minWidth: nullableSize.describe("Auto-layout min width; null clears"),
  maxWidth: nullableSize.describe("Auto-layout max width; null clears"),
  minHeight: nullableSize.describe("Auto-layout min height; null clears"),
  maxHeight: nullableSize.describe("Auto-layout max height; null clears"),
  constraints: z
    .object({
      horizontal: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]),
      vertical: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]),
    })
    .optional()
    .describe("Resizing constraints relative to a non-auto-layout parent frame"),
  clipsContent: z.boolean().optional().describe("Frames: clip content to bounds"),
  blendMode: blendMode.optional().describe("Layer blend mode"),
  locked: z.boolean().optional(),
  isMask: z.boolean().optional().describe("Use this layer as a mask for the siblings above it"),
  maskType: z.enum(["ALPHA", "VECTOR", "LUMINANCE"]).optional(),
  gridRowSpan: z.number().int().min(1).optional().describe("Child of a GRID frame: rows spanned"),
  gridColumnSpan: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Child of a GRID frame: columns spanned"),
  gridChildHorizontalAlign: z.enum(["MIN", "CENTER", "MAX", "AUTO"]).optional(),
  gridChildVerticalAlign: z.enum(["MIN", "CENTER", "MAX", "AUTO"]).optional(),
  gridPosition: z
    .object({ row: z.number().int().min(0), column: z.number().int().min(0) })
    .optional()
    .describe("Child of a MANUAL-positioned GRID frame: zero-based cell to place it in"),
  fileKey: fileKeyField,
});

export const setNodePropertiesInput = setNodePropertiesShape
  .refine(
    (value) => value.nodeId !== undefined || value.nodeIds !== undefined,
    "Either nodeId or nodeIds is required"
  )
  .refine(hasAnyProperty("nodeId", "nodeIds", "fileKey"), "At least one property must be provided");

const solidFillTarget = z
  .enum(["fill", "stroke"])
  .optional()
  .describe("Apply to fills or strokes (default fill)");

/**
 * Advertised shape. `fillHex`/`fillOpacity` are declared so the MCP SDK keeps
 * them instead of stripping them as unknown keys; `setSolidFillInput`
 * normalises them onto `hex`/`opacity` before the request reaches the plugin.
 */
export const setSolidFillShape = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  hex: createHexColorSchema()
    .optional()
    .describe("Solid color as hex (e.g. '#FFAA00'). Required unless fillHex is given."),
  fillHex: createHexColorSchema()
    .optional()
    .describe("Alias for hex, matching the create_* tools. Supply one of the two."),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional paint opacity from 0 to 1 (default 1)"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Alias for opacity, matching the create_* tools"),
  target: solidFillTarget,
  fileKey: fileKeyField,
});

/**
 * Normalises the create_* spellings onto the canonical fields. Derived from the
 * advertised shape so the two cannot drift; the canonical name wins when both
 * spellings are supplied.
 */
export const setSolidFillInput = setSolidFillShape.transform(
  ({ fillHex, fillOpacity, ...rest }, ctx) => {
    const hex = rest.hex ?? fillHex;
    if (hex === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hex"],
        message: "hex is required (fillHex is accepted as an alias)",
      });
      return z.NEVER;
    }
    return { ...rest, hex, opacity: rest.opacity ?? fillOpacity };
  }
);

const shadowEffect = z.object({
  type: z.enum(["DROP_SHADOW", "INNER_SHADOW"]),
  color: createHexColorSchema().describe("Shadow color as hex"),
  opacity: z.number().min(0).max(1).optional().describe("Shadow alpha 0..1 (default 1)"),
  offset: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .describe("Shadow offset in pixels"),
  radius: z.number().min(0).describe("Blur radius (>= 0)"),
  spread: z
    .number()
    .optional()
    .describe(
      "Expand/contract distance (default 0). Only honored on rects/ellipses, or on frames/components/instances with visible fills and clipsContent."
    ),
  blendMode: blendMode.optional().describe("Default NORMAL"),
  visible: z.boolean().optional().describe("Default true"),
});

const vector2 = z.object({ x: z.number(), y: z.number() });

const blurEffect = z.object({
  type: z.enum(["LAYER_BLUR", "BACKGROUND_BLUR"]),
  radius: z.number().min(0).describe("Blur radius (>= 0); the end radius for progressive blur"),
  blurType: z.enum(["NORMAL", "PROGRESSIVE"]).optional().describe("Default NORMAL"),
  startRadius: z
    .number()
    .min(0)
    .optional()
    .describe("PROGRESSIVE: radius at the start (default 0)"),
  startOffset: vector2
    .optional()
    .describe("PROGRESSIVE: start point in 0–1 node-relative coords (default {x:0.5,y:0})"),
  endOffset: vector2
    .optional()
    .describe("PROGRESSIVE: end point in 0–1 node-relative coords (default {x:0.5,y:1})"),
  visible: z.boolean().optional().describe("Default true"),
});

const noiseEffect = z.object({
  type: z.literal("NOISE"),
  noiseType: z.enum(["MONOTONE", "DUOTONE", "MULTITONE"]).optional().describe("Default MONOTONE"),
  color: createHexColorSchema().optional().describe("Noise color (default #000000)"),
  colorOpacity: z.number().min(0).max(1).optional().describe("Noise color alpha (default 0.25)"),
  secondaryColor: createHexColorSchema().optional().describe("DUOTONE second color"),
  secondaryColorOpacity: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional().describe("MULTITONE opacity (default 1)"),
  noiseSize: z.number().positive().optional().describe("Grain size (default 1)"),
  density: z.number().min(0).max(1).optional().describe("Grain density 0–1 (default 0.5)"),
  blendMode: blendMode.optional().describe("Default NORMAL"),
  visible: z.boolean().optional(),
});

const textureEffect = z.object({
  type: z.literal("TEXTURE"),
  noiseSize: z.number().positive().optional().describe("Texture grain size (default 4)"),
  radius: z.number().min(0).optional().describe("Texture distortion radius (default 4)"),
  clipToShape: z.boolean().optional().describe("Default true"),
  visible: z.boolean().optional(),
});

const glassEffect = z.object({
  type: z.literal("GLASS"),
  lightIntensity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Highlight strength 0–1 (default 0.5)"),
  lightAngle: z.number().optional().describe("Highlight angle in degrees (default -45)"),
  refraction: z.number().min(0).max(1).optional().describe("Edge refraction 0–1 (default 0.5)"),
  depth: z.number().min(0).optional().describe("Bevel depth (default 20)"),
  dispersion: z.number().min(0).max(1).optional().describe("Chromatic dispersion 0–1 (default 0)"),
  radius: z.number().min(0).optional().describe("Frost blur radius (default 4)"),
  visible: z.boolean().optional(),
});

export const imageFillExportInput = z.object({
  imageHash: z
    .string()
    .min(1)
    .describe(
      "The imageHash returned in a serialized IMAGE paint (e.g. from get_node's styles.fills[].imageHash). Resolves to the PNG bytes of the image fill."
    ),
  outputPath: z
    .string()
    .optional()
    .describe(
      "If set, write the image bytes to this path and return only metadata. Relative paths resolve from the MCP server cwd. Omit to write to a temp file."
    ),
  inline: z
    .boolean()
    .optional()
    .describe(
      "If true, return base64 image bytes inline. Default false — bytes are written to a temp file (or outputPath) and only the path is returned."
    ),
  fileKey: fileKeyField,
});

export const saveChildrenJsonInput = z.object({
  parentId: createFigmaNodeIdSchema().describe(
    "Parent node whose direct visible children will each be serialized to a separate JSON file."
  ),
  outputDir: z
    .string()
    .min(1)
    .describe(
      "Output directory. Relative paths resolve from the MCP server cwd. Created if missing."
    ),
  includeHidden: z
    .boolean()
    .optional()
    .describe("Include children with visible=false (default false)."),
  filenamePattern: z
    .string()
    .optional()
    .describe(
      "Filename pattern with `{name}` (sanitized child name) or `{id}` (Figma node id with ':' replaced by '-'). Default '{name}.json'."
    ),
  fileKey: fileKeyField,
});

export const findNodesInput = z.object({
  root: createFigmaNodeIdSchema()
    .optional()
    .describe("Root node ID to search under. Omit to search the entire current page."),
  name: z
    .string()
    .optional()
    .describe(
      "Match nodes whose name contains this substring (case-insensitive). Use `regex` for richer matches."
    ),
  regex: z
    .string()
    .optional()
    .describe(
      "Match nodes whose name matches this JavaScript regular expression. Takes precedence over `name`."
    ),
  type: z
    .string()
    .optional()
    .describe("Filter by node type, e.g. 'ELLIPSE', 'FRAME', 'GROUP', 'TEXT'. Case-insensitive."),
  limit: z.number().int().min(1).max(500).optional().describe("Max results (default 50)."),
  includeHidden: z
    .boolean()
    .optional()
    .describe(
      "Include nodes with visible=false. Default false — hidden subtrees are skipped entirely."
    ),
  fileKey: fileKeyField,
});

export const getNodeByPathInput = z.object({
  root: createFigmaNodeIdSchema()
    .optional()
    .describe("Root node ID to resolve the path from. Omit to start at the current page."),
  path: z
    .string()
    .min(1)
    .describe(
      "Slash-separated chain of child names, e.g. 'Hero/Card/Title'. Each segment matches a direct child by exact name."
    ),
  fileKey: fileKeyField,
});

const effectInput = z.object({
  type: z
    .enum([
      "DROP_SHADOW",
      "INNER_SHADOW",
      "LAYER_BLUR",
      "BACKGROUND_BLUR",
      "NOISE",
      "TEXTURE",
      "GLASS",
    ])
    .describe("Effect type"),
  color: createHexColorSchema().optional().describe("Required for shadow effects"),
  opacity: z.number().min(0).max(1).optional().describe("Shadow alpha 0..1 (default 1)"),
  offset: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional()
    .describe("Required for shadow effects"),
  radius: z.number().min(0).optional().describe("Required blur radius"),
  spread: z
    .number()
    .optional()
    .describe(
      "Expand/contract distance (default 0). Only honored on rects/ellipses, or on frames/components/instances with visible fills and clipsContent."
    ),
  blendMode: blendMode.optional().describe("Default NORMAL"),
  visible: z.boolean().optional().describe("Default true"),
  blurType: blurEffect.shape.blurType,
  startRadius: blurEffect.shape.startRadius,
  startOffset: blurEffect.shape.startOffset,
  endOffset: blurEffect.shape.endOffset,
  noiseType: noiseEffect.shape.noiseType,
  colorOpacity: noiseEffect.shape.colorOpacity,
  secondaryColor: noiseEffect.shape.secondaryColor,
  secondaryColorOpacity: noiseEffect.shape.secondaryColorOpacity,
  noiseSize: noiseEffect.shape.noiseSize,
  density: noiseEffect.shape.density,
  clipToShape: textureEffect.shape.clipToShape,
  lightIntensity: glassEffect.shape.lightIntensity,
  lightAngle: glassEffect.shape.lightAngle,
  refraction: glassEffect.shape.refraction,
  depth: glassEffect.shape.depth,
  dispersion: glassEffect.shape.dispersion,
});

const effectRuntimeSchema = z.discriminatedUnion("type", [
  shadowEffect,
  blurEffect,
  noiseEffect,
  textureEffect,
  glassEffect,
]);

export const setSelectionInput = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .describe("Node IDs to select. Pass [] to clear the selection."),
  fileKey: fileKeyField,
});

export const scrollAndZoomIntoViewInput = z.object({
  nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("Node IDs to frame in the viewport"),
  fileKey: fileKeyField,
});

export const groupNodesInput = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .min(1)
    .describe("Node IDs to group. Must share a common parent."),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe(
      "Optional explicit parent for the new group. Defaults to the shared parent of the input nodes."
    ),
  name: z.string().optional().describe("Optional name for the new group"),
  fileKey: fileKeyField,
});

export const ungroupNodeInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe(
    "Group or frame to ungroup. Children move up to its parent and the wrapper is removed."
  ),
  fileKey: fileKeyField,
});

export const setEffectsShape = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  effects: z
    .array(effectInput)
    .describe(
      "Full replacement list of effects. Pass [] to clear all effects. Each entry is a drop/inner shadow, a layer/background blur (normal or progressive), or a NOISE / TEXTURE / GLASS effect."
    ),
  fileKey: fileKeyField,
});

export const setEffectsInput = setEffectsShape.superRefine((value, ctx) => {
  value.effects.forEach((effect, index) => {
    const result = effectRuntimeSchema.safeParse(effect);
    if (result.success) return;

    for (const issue of result.error.issues) {
      ctx.addIssue({
        ...issue,
        path: ["effects", index, ...issue.path],
      });
    }
  });
});

export const setStrokePropertiesInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  strokeWeight: z.number().min(0).optional().describe("Stroke thickness in pixels"),
  strokeAlign: z
    .enum(["INSIDE", "OUTSIDE", "CENTER"])
    .optional()
    .describe("How the stroke is positioned relative to the geometry edge"),
  dashPattern: z
    .array(z.number().min(0))
    .optional()
    .describe("Dash pattern as [dash, gap, dash, gap, ...] in pixels. Pass [] for a solid stroke."),
  strokeCap: z
    .enum(["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"])
    .optional()
    .describe("End-cap style (only meaningful on open paths/lines)"),
  strokeJoin: z.enum(["MITER", "BEVEL", "ROUND"]).optional().describe("Corner join style"),
  strokeTopWeight: z.number().min(0).optional().describe("Per-side stroke weight (frames/rects)"),
  strokeRightWeight: z.number().min(0).optional(),
  strokeBottomWeight: z.number().min(0).optional(),
  strokeLeftWeight: z.number().min(0).optional(),
  strokeMiterLimit: z.number().min(0).optional().describe("Miter limit for MITER joins"),
  fileKey: fileKeyField,
});

export const setAutoLayoutInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update (must be a frame)"),
  layoutMode: z
    .enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"])
    .optional()
    .describe(
      "Auto-layout direction, or GRID for a CSS-grid-like layout. 'NONE' disables auto-layout."
    ),
  itemSpacing: z
    .number()
    .optional()
    .describe("Gap between children along the primary axis (pixels)"),
  counterAxisSpacing: z
    .number()
    .optional()
    .describe("Gap between wrapped rows/columns (only when layoutWrap=WRAP)"),
  paddingTop: z.number().min(0).optional(),
  paddingRight: z.number().min(0).optional(),
  paddingBottom: z.number().min(0).optional(),
  paddingLeft: z.number().min(0).optional(),
  primaryAxisAlignItems: z
    .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN", "SPACE_EVENLY", "SPACE_AROUND"])
    .optional()
    .describe("Alignment along the primary axis"),
  counterAxisAlignItems: z
    .enum(["MIN", "MAX", "CENTER", "BASELINE"])
    .optional()
    .describe("Alignment along the counter axis"),
  primaryAxisSizingMode: z
    .enum(["FIXED", "AUTO"])
    .optional()
    .describe("AUTO = hug contents along primary axis"),
  counterAxisSizingMode: z
    .enum(["FIXED", "AUTO"])
    .optional()
    .describe("AUTO = hug contents along counter axis"),
  counterAxisAlignContent: z
    .enum(["AUTO", "SPACE_BETWEEN"])
    .optional()
    .describe("Wrapped layouts: how rows/columns are distributed along the counter axis"),
  itemReverseZIndex: z.boolean().optional().describe("Canvas stacking: first item on top"),
  strokesIncludedInLayout: z
    .boolean()
    .optional()
    .describe("Include strokes in layout sizing (CSS border-box)"),
  gridRowCount: z.number().int().min(1).optional().describe("GRID: number of rows"),
  gridColumnCount: z.number().int().min(1).optional().describe("GRID: number of columns"),
  gridRowGap: z.number().min(0).optional().describe("GRID: gap between rows"),
  gridColumnGap: z.number().min(0).optional().describe("GRID: gap between columns"),
  gridRowSizes: z
    .array(
      z.object({ type: z.enum(["FLEX", "FIXED", "HUG"]), value: z.number().min(0).optional() })
    )
    .optional()
    .describe(
      "GRID: per-row track sizes, e.g. [{type:'FIXED',value:48},{type:'FLEX',value:1}]. Length sets the row count."
    ),
  gridColumnSizes: z
    .array(
      z.object({ type: z.enum(["FLEX", "FIXED", "HUG"]), value: z.number().min(0).optional() })
    )
    .optional()
    .describe(
      "GRID: per-column track sizes (like CSS grid-template-columns). Length sets the column count."
    ),
  layoutWrap: z
    .enum(["NO_WRAP", "WRAP"])
    .optional()
    .describe("Allow children to wrap onto multiple rows (HORIZONTAL) or columns (VERTICAL)"),
  fileKey: fileKeyField,
});

export const createPageInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional page name (defaults to Figma's 'Page N')"),
  setAsCurrent: z
    .boolean()
    .optional()
    .describe("When true, switch the editor to the new page after creating it (default false)"),
  fileKey: fileKeyField,
});

export const createFrameInput = z.object({
  name: z.string().optional().describe("Optional frame name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the frame into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Frame width"),
  height: z.number().positive().optional().describe("Frame height"),
  fillHex: createHexColorSchema().optional().describe("Optional solid fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional solid fill opacity from 0 to 1"),
  fileKey: fileKeyField,
});

export const createSectionShape = z.object({
  name: z.string().optional().describe("Optional section name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the section into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Section width (default 100)"),
  height: z.number().positive().optional().describe("Section height (default 100)"),
  fillHex: createHexColorSchema().optional().describe("Optional solid fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional solid fill opacity from 0 to 1"),
  sectionContentsHidden: z
    .boolean()
    .optional()
    .describe("Whether the section's contents are marked as hidden"),
  fileKey: fileKeyField,
});

export const createSectionInput = createSectionShape.refine(
  (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
  "fillHex is required when fillOpacity is provided"
);

const connectorAnchor = z
  .enum(["top", "bottom", "left", "right", "auto"])
  .describe("Attachment side of a connector endpoint on its node");

export const createConnectorBase = z.object({
  name: z.string().optional().describe("Optional connector name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the connector into"),
  startNodeId: createFigmaNodeIdSchema()
    .optional()
    .describe("Node ID to connect from (start point)"),
  endNodeId: createFigmaNodeIdSchema().optional().describe("Node ID to connect to (end point)"),
  startX: z.number().optional().describe("Start X position (used if startNodeId not provided)"),
  startY: z.number().optional().describe("Start Y position (used if startNodeId not provided)"),
  endX: z.number().optional().describe("End X position (used if endNodeId not provided)"),
  endY: z.number().optional().describe("End Y position (used if endNodeId not provided)"),
  startAnchor: connectorAnchor
    .optional()
    .describe("Attachment side on the start node (requires startNodeId; default auto)"),
  endAnchor: connectorAnchor
    .optional()
    .describe("Attachment side on the end node (requires endNodeId; default auto)"),
  strokeWeight: z.number().positive().optional().describe("Optional connector stroke weight"),
  strokeHex: createHexColorSchema().optional().describe("Optional connector stroke color as hex"),
  fileKey: fileKeyField,
});

export const createConnectorInput = createConnectorBase
  .refine(
    (v) =>
      typeof v.startNodeId === "string" ||
      (typeof v.startX === "number" && typeof v.startY === "number"),
    "Either startNodeId or both startX and startY are required"
  )
  .refine(
    (v) =>
      typeof v.endNodeId === "string" || (typeof v.endX === "number" && typeof v.endY === "number"),
    "Either endNodeId or both endX and endY are required"
  )
  .refine(
    (v) => v.startAnchor === undefined || typeof v.startNodeId === "string",
    "startAnchor requires startNodeId"
  )
  .refine(
    (v) => v.endAnchor === undefined || typeof v.endNodeId === "string",
    "endAnchor requires endNodeId"
  );

/**
 * Advertised shape. `characters` is declared so the MCP SDK keeps it instead of
 * stripping it as an unknown key; `setTextContentInput` normalises it onto
 * `text` before the request reaches the plugin.
 */
export const setTextContentShape = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The text node ID to update"),
  text: z
    .string()
    .optional()
    .describe("The new text content. Required unless characters is given."),
  characters: z
    .string()
    .optional()
    .describe("Alias for text, matching create_text. Supply one of the two."),
  fileKey: fileKeyField,
});

/**
 * Normalises `characters` onto `text`. Derived from the advertised shape so the
 * two cannot drift; `text` wins when both spellings are supplied.
 */
export const setTextContentInput = setTextContentShape.transform(({ characters, ...rest }, ctx) => {
  const text = rest.text ?? characters;
  if (text === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["text"],
      message: "text is required (characters is accepted as an alias)",
    });
    return z.NEVER;
  }
  return { ...rest, text };
});

export const setTextPropertiesShape = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The text node ID to update"),
  fontFamily: z.string().optional().describe("Optional font family"),
  fontStyle: z.string().optional().describe("Optional font style"),
  fontSize: z.number().positive().optional().describe("Optional font size"),
  textAlignHorizontal: textAlignHorizontal.optional().describe("Optional horizontal alignment"),
  textAlignVertical: textAlignVertical.optional().describe("Optional vertical alignment"),
  textAutoResize: textAutoResize.optional().describe("Optional text auto-resize mode"),
  textWrapStyle: z
    .enum(["AUTO", "BALANCE", "PRETTY"])
    .optional()
    .describe("Line breaking: BALANCE evens line lengths, PRETTY avoids orphans (CSS text-wrap)"),
  textCase: z
    .enum(["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"])
    .optional(),
  textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional(),
  textDecorationStyle: z
    .enum(["SOLID", "WAVY", "DOTTED"])
    .optional()
    .describe("Requires textDecoration UNDERLINE"),
  paragraphSpacing: z.number().min(0).optional().describe("Space between paragraphs (px)"),
  paragraphIndent: z.number().min(0).optional().describe("First-line indent (px)"),
  listType: z
    .enum(["ORDERED", "UNORDERED", "NONE"])
    .optional()
    .describe("Turn the whole text into a numbered / bulleted list, or back to plain text"),
  listSpacing: z.number().min(0).optional().describe("Space between list items (px)"),
  leadingTrim: z
    .enum(["NONE", "CAP_HEIGHT"])
    .optional()
    .describe("CAP_HEIGHT trims space above caps / below baseline (CSS text-box-trim)"),
  textTruncation: z
    .enum(["DISABLED", "ENDING"])
    .optional()
    .describe("ENDING truncates overflowing text with an ellipsis"),
  maxLines: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .describe("With textTruncation ENDING: max lines before the ellipsis; null clears"),
  lineHeightPercent: z.number().positive().optional().describe("Line height in % of font size"),
  lineHeightAuto: z.literal(true).optional().describe("Reset line height to Auto"),
  letterSpacingPercent: z.number().optional().describe("Letter spacing in % of font size"),
  hyperlink: z
    .string()
    .url()
    .nullable()
    .optional()
    .describe("Link the whole text to a URL; null removes the link"),
  lineHeightPx: z.number().positive().optional().describe("Optional line height in pixels"),
  letterSpacingPx: z.number().optional().describe("Optional letter spacing in pixels"),
  fillHex: createHexColorSchema().optional().describe("Optional text fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional text fill opacity from 0 to 1"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  fileKey: fileKeyField,
});

export const setTextPropertiesInput = setTextPropertiesShape
  .refine(hasAnyProperty("nodeId", "fileKey"), "At least one text property must be provided")
  .refine(
    (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
    "fillHex is required when fillOpacity is provided"
  );

export const createTextShape = z.object({
  name: z.string().optional().describe("Optional text node name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the text into"),
  characters: z.string().optional().describe("Initial text content"),
  fontFamily: z.string().optional().describe("Font family, defaults to Inter"),
  fontStyle: z.string().optional().describe("Font style, defaults to Regular"),
  fontSize: z.number().positive().optional().describe("Optional font size"),
  textAlignHorizontal: textAlignHorizontal.optional().describe("Optional horizontal alignment"),
  textAutoResize: textAutoResize.optional().describe("Optional text auto-resize mode"),
  fillHex: createHexColorSchema().optional().describe("Optional text fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional text fill opacity from 0 to 1"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  fileKey: fileKeyField,
});

export const createTextInput = createTextShape.refine(
  (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
  "fillHex is required when fillOpacity is provided"
);

export const createShapeShape = z.object({
  shapeType: shapeType.describe("Shape type to create"),
  name: z.string().optional().describe("Optional shape name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the shape into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  rotation: z.number().optional().describe("Optional rotation in degrees"),
  cornerRadius: z
    .number()
    .min(0)
    .optional()
    .describe("Optional corner radius for supported shapes"),
  fillHex: createHexColorSchema().optional().describe("Optional fill color as hex"),
  fillOpacity: z.number().min(0).max(1).optional().describe("Optional fill opacity from 0 to 1"),
  strokeHex: createHexColorSchema().optional().describe("Optional stroke color as hex"),
  strokeOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional stroke opacity from 0 to 1"),
  strokeWeight: z.number().positive().optional().describe("Optional stroke weight"),
  fileKey: fileKeyField,
});

export const createShapeInput = createShapeShape
  .refine(
    (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
    "fillHex is required when fillOpacity is provided"
  )
  .refine(
    (value) => value.strokeOpacity === undefined || value.strokeHex !== undefined,
    "strokeHex is required when strokeOpacity is provided"
  )
  .refine(
    (value) => value.shapeType !== "LINE" || value.fillHex === undefined,
    "LINE shapes do not support fillHex — use strokeHex instead"
  )
  .refine(
    (value) => value.shapeType !== "LINE" || value.strokeHex !== undefined,
    "LINE shapes require strokeHex (lines have no fill and would be invisible otherwise)"
  );

export const createShapeWithTextShape = z.object({
  shapeType: figJamShapeType.optional().describe("FigJam shape type (default ROUNDED_RECTANGLE)"),
  name: z.string().optional().describe("Optional shape name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the shape into"),
  characters: z.string().optional().describe("Text content rendered inside the shape"),
  fontFamily: z.string().optional().describe("Font family, defaults to Inter"),
  fontStyle: z.string().optional().describe("Font style, defaults to Regular"),
  fontSize: z.number().positive().optional().describe("Optional font size"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  rotation: z.number().optional().describe("Optional rotation in degrees"),
  fillHex: createHexColorSchema().optional().describe("Optional fill color as hex"),
  fillOpacity: z.number().min(0).max(1).optional().describe("Optional fill opacity from 0 to 1"),
  strokeHex: createHexColorSchema().optional().describe("Optional stroke color as hex"),
  strokeOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional stroke opacity from 0 to 1"),
  strokeWeight: z.number().positive().optional().describe("Optional stroke weight"),
  textFillHex: createHexColorSchema().optional().describe("Optional text label fill color as hex"),
  textFillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional text label fill opacity from 0 to 1"),
  fileKey: fileKeyField,
});

export const createShapeWithTextInput = createShapeWithTextShape
  .refine(
    (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
    "fillHex is required when fillOpacity is provided"
  )
  .refine(
    (value) => value.strokeOpacity === undefined || value.strokeHex !== undefined,
    "strokeHex is required when strokeOpacity is provided"
  )
  .refine(
    (value) => value.textFillOpacity === undefined || value.textFillHex !== undefined,
    "textFillHex is required when textFillOpacity is provided"
  );

export const createImageInput = z.object({
  source: z
    .string()
    .min(1)
    .describe(
      "Image source. Accepts a local file path (absolute or relative to the MCP server cwd), an http/https URL, or a data URI."
    ),
  name: z.string().optional().describe("Optional image node name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the image into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  cornerRadius: z.number().min(0).optional().describe("Optional corner radius"),
  scaleMode: imageScaleMode
    .optional()
    .describe("How the image should fit its bounds: FILL (default) or FIT"),
  fileKey: fileKeyField,
});

export const createSvgInput = z.object({
  source: z
    .string()
    .min(1)
    .describe(
      "SVG source. Accepts raw <svg> markup or a local SVG file path inside the MCP server working directory."
    ),
  name: z.string().optional().describe("Optional SVG node name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the editable SVG into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  fileKey: fileKeyField,
});

/**
 * A serialized layer tree produced by html-figma's browser `htmlToFigma()`.
 * The tree is validated loosely here (root must at least carry a node type);
 * the plugin-side renderer is the authority on the full shape.
 */
const htmlLayerTree = z
  .object({ type: z.string().min(1) })
  .passthrough()
  .describe("Root LayerNode of an html-figma serialization");

export const importHtmlLayersInput = z.object({
  source: z
    .string()
    .min(1)
    .describe(
      "Path to a JSON file containing an html-figma htmlToFigma() layer tree, relative to the MCP server cwd (absolute paths must stay inside it)."
    ),
  name: z
    .string()
    .optional()
    .describe("Optional name for the wrapper frame (default: 'imported layers')"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe(
      "Optional parent node ID (frame/section) to append the wrapper frame into. x/y become relative to that parent."
    ),
  x: z.number().optional().describe("Optional x position of the wrapper frame"),
  y: z.number().optional().describe("Optional y position of the wrapper frame"),
  fileKey: fileKeyField,
});

export const fitToContentInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe(
    "Section node ID to resize around its children (SECTION nodes only)"
  ),
  padding: z
    .number()
    .min(0)
    .optional()
    .describe("Whitespace to leave around the content bounding box (default 0)"),
  fileKey: fileKeyField,
});

export const distributeInput = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .min(3)
    .describe("List of node IDs to distribute (at least 3)"),
  fileKey: fileKeyField,
});

export const alignToGridInput = z.object({
  nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("List of node IDs to align"),
  gridSize: z.number().positive().describe("Grid spacing to snap positions to"),
  fileKey: fileKeyField,
});

const placeRelativeInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("Node to move"),
  relativeToId: createFigmaNodeIdSchema().describe("Reference node to place against"),
  gap: z.number().min(0).optional().describe("Gap between the two nodes' edges (default 0)"),
  align: z
    .enum(["start", "center"])
    .optional()
    .describe("Alignment of the moved node against the reference edge (default start)"),
  fileKey: fileKeyField,
});

export const placeBelowInput = placeRelativeInput;

export const placeRightOfInput = placeRelativeInput;

export const duplicateWithOffsetInput = z.object({
  nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("List of node IDs to duplicate"),
  offsetX: z.number().describe("Horizontal offset applied to each duplicate"),
  offsetY: z.number().describe("Vertical offset applied to each duplicate"),
  fileKey: fileKeyField,
});

// ---------------------------------------------------------------------------
// Components, component sets (variants), component properties and instances
// ---------------------------------------------------------------------------

const componentPropertyType = z
  .enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"])
  .describe(
    "BOOLEAN toggles layer visibility, TEXT drives a text layer's characters, INSTANCE_SWAP drives a nested instance's main component, VARIANT adds a variant axis (component sets only)"
  );

const propertyNameField = z
  .string()
  .min(1)
  .describe(
    "Property name. Bare names ('Label') resolve to Figma's suffixed form ('Label#12:3') when unambiguous; the full name always works."
  );

const preferredValuesField = z
  .array(
    z.union([
      z.string().describe("Component/component-set node id, or a published component key"),
      z.object({
        key: z.string().describe("Published component or component-set key"),
        type: z.enum(["COMPONENT", "COMPONENT_SET"]).optional(),
      }),
    ])
  )
  .optional()
  .describe("INSTANCE_SWAP only: components offered as quick swaps in the instance panel");

const propertyValueField = z.union([z.string(), z.boolean()]);

const componentRefFields = {
  componentId: createFigmaNodeIdSchema()
    .optional()
    .describe(
      "Local COMPONENT or COMPONENT_SET node id. A set resolves to its default variant unless `variant` picks one."
    ),
  componentKey: z
    .string()
    .optional()
    .describe(
      "Published library component or component-set key (from get_components / get_component_info). Imported on demand."
    ),
  variant: z
    .record(z.string())
    .optional()
    .describe('Pick a variant by its properties, e.g. {"Size": "Large", "State": "Hover"}'),
};

const hasComponentRef = (value: { componentId?: string; componentKey?: string }) =>
  value.componentId !== undefined || value.componentKey !== undefined;

export const getComponentsInput = z.object({
  scope: z
    .enum(["page", "document"])
    .optional()
    .describe(
      "Search the current page (default) or every page (loads all pages; slower on big files)"
    ),
  nameContains: z.string().optional().describe("Case-insensitive name filter"),
  includeVariants: z
    .boolean()
    .optional()
    .describe("Also list each variant inside component sets (default false: sets only)"),
  limit: z.number().int().min(1).max(2000).optional().describe("Max results (default 200)"),
  fileKey: fileKeyField,
});

export const getComponentInfoInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe(
    "COMPONENT, COMPONENT_SET, INSTANCE, or any layer inside a component"
  ),
  includeInstances: z
    .boolean()
    .optional()
    .describe("COMPONENT only: list instances across the document (can be slow)"),
  maxInstances: z.number().int().min(1).max(1000).optional().describe("Default 50"),
  fileKey: fileKeyField,
});

export const createComponentShape = z.object({
  fromNodeIds: z
    .array(createFigmaNodeIdSchema())
    .optional()
    .describe(
      "Convert existing layers (frames, groups, shapes…) into components in place, one component per node. When omitted, a new empty component is created."
    ),
  name: z.string().optional().describe("Component name (ignored when converting several nodes)"),
  description: z.string().optional().describe("Component description shown in the assets panel"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("New component only: parent to append into (a COMPONENT_SET adds it as a variant)"),
  x: z.number().optional().describe("New component only: x position"),
  y: z.number().optional().describe("New component only: y position"),
  width: z.number().positive().optional().describe("New component only: width (default 100)"),
  height: z.number().positive().optional().describe("New component only: height (default 100)"),
  fillHex: createHexColorSchema().optional().describe("New component only: solid fill"),
  fillOpacity: z.number().min(0).max(1).optional().describe("Fill opacity 0–1"),
  fileKey: fileKeyField,
});

export const createComponentInput = createComponentShape.refine(
  (v) => v.fillOpacity === undefined || v.fillHex !== undefined,
  "fillHex is required when fillOpacity is provided"
);

export const combineAsVariantsInput = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .min(1)
    .describe(
      "Components to combine. Name them 'Prop=Value, Prop2=Value' first (or via edit_component variantProperties afterwards) to get named variant axes."
    ),
  name: z.string().optional().describe("Name for the new component set"),
  description: z.string().optional(),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Parent for the set (default: parent of the first component)"),
  convert: z
    .boolean()
    .optional()
    .describe("Convert non-component layers to components first (default false: error instead)"),
  fileKey: fileKeyField,
});

export const editComponentShape = z.object({
  nodeId: createFigmaNodeIdSchema().describe(
    "COMPONENT, COMPONENT_SET, or a variant. Property changes on a variant apply to its set."
  ),
  name: z.string().optional().describe("Rename the node"),
  description: z.string().optional(),
  documentationLinks: z.array(z.string().url()).max(1).optional().describe("Pass [] to clear"),
  variantProperties: z
    .record(z.string())
    .optional()
    .describe(
      'Variant only: set this variant\'s values, e.g. {"State": "Hover"}. A new key adds a variant axis to the set.'
    ),
  addProperties: z
    .array(
      z.object({
        name: z.string().min(1).describe("Property name (Figma adds the #id suffix)"),
        type: componentPropertyType,
        defaultValue: propertyValueField
          .optional()
          .describe(
            "BOOLEAN: true/false. TEXT: string. INSTANCE_SWAP: component id or key. VARIANT: required, the value existing variants get. Omitted → taken from the first bindTo layer."
          ),
        preferredValues: preferredValuesField,
        bindTo: z
          .array(createFigmaNodeIdSchema())
          .optional()
          .describe(
            "Layers inside the component to bind: BOOLEAN→visible, TEXT→characters (TEXT layers), INSTANCE_SWAP→mainComponent (nested instances)"
          ),
      })
    )
    .optional(),
  editProperties: z
    .array(
      z.object({
        name: propertyNameField,
        newName: z.string().min(1).optional(),
        defaultValue: propertyValueField.optional().describe("Not supported for VARIANT"),
        preferredValues: preferredValuesField,
      })
    )
    .optional(),
  deleteProperties: z
    .array(propertyNameField)
    .optional()
    .describe("BOOLEAN / TEXT / INSTANCE_SWAP properties to delete"),
  fileKey: fileKeyField,
});

export const editComponentInput = editComponentShape.refine(
  (v) =>
    v.name !== undefined ||
    v.description !== undefined ||
    v.documentationLinks !== undefined ||
    v.variantProperties !== undefined ||
    (v.addProperties?.length ?? 0) > 0 ||
    (v.editProperties?.length ?? 0) > 0 ||
    (v.deleteProperties?.length ?? 0) > 0,
  "At least one change is required"
);

export const bindComponentPropertyShape = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .min(1)
    .describe("Layers inside a component (not inside a nested instance)"),
  references: z
    .object({
      visible: propertyNameField.nullable().optional().describe("BOOLEAN property; null unbinds"),
      characters: propertyNameField
        .nullable()
        .optional()
        .describe("TEXT property (TEXT layers only); null unbinds"),
      mainComponent: propertyNameField
        .nullable()
        .optional()
        .describe("INSTANCE_SWAP property (nested instances only); null unbinds"),
    })
    .optional(),
  isExposedInstance: z
    .boolean()
    .optional()
    .describe("Nested instances only: expose its properties on the parent component's instances"),
  fileKey: fileKeyField,
});

export const bindComponentPropertyInput = bindComponentPropertyShape.refine(
  (v) =>
    (v.references !== undefined && Object.keys(v.references).length > 0) ||
    v.isExposedInstance !== undefined,
  "Provide references and/or isExposedInstance"
);

export const createInstanceShape = z.object({
  ...componentRefFields,
  properties: z
    .record(propertyValueField)
    .optional()
    .describe("Component property values to set on the new instance (bare names OK)"),
  name: z.string().optional(),
  parentId: createFigmaNodeIdSchema().optional().describe("Parent to append the instance into"),
  x: z.number().optional(),
  y: z.number().optional(),
  fileKey: fileKeyField,
});

export const createInstanceInput = createInstanceShape.refine(
  hasComponentRef,
  "componentId or componentKey is required"
);

export const setInstancePropertiesInput = z.object({
  nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("Instances to update"),
  properties: z
    .record(propertyValueField)
    .refine((p) => Object.keys(p).length > 0, "properties must not be empty")
    .describe(
      'e.g. {"Size": "Large", "Label": "Buy", "Show icon": false, "Icon": "12:34"}. VARIANT values switch variant; INSTANCE_SWAP takes a component id or key.'
    ),
  fileKey: fileKeyField,
});

export const swapInstanceShape = z.object({
  nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("Instances to swap"),
  ...componentRefFields,
  preserveOverrides: z
    .boolean()
    .optional()
    .describe("Keep overrides like the editor's swap (default true); false clears them"),
  fileKey: fileKeyField,
});

export const swapInstanceInput = swapInstanceShape.refine(
  hasComponentRef,
  "componentId or componentKey is required"
);

export const instanceIdsInput = z.object({
  nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("INSTANCE node IDs"),
  fileKey: fileKeyField,
});

export const toolInputSchemas = {
  get_document: z.object({
    depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "How many levels of children to serialize fully (default 2). Deeper levels are returned as {id,name,type} stubs with a childCount. Raise it only for a small page — an unbounded page tree will not fit in context."
      ),
    fileKey: fileKeyField,
  }),

  get_selection: z.object({
    depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "How many levels of children to serialize fully (default 2). Deeper levels are returned as {id,name,type} stubs with a childCount."
      ),
    fileKey: fileKeyField,
  }),

  get_layout_tree: z.object({
    rootId: createFigmaNodeIdSchema(),
    maxNodes: z.number().int().min(1).max(10000).optional(),
    fileKey: fileKeyField,
  }),

  get_node: z.object({
    nodeId: createFigmaNodeIdSchema().describe(
      "The node ID to fetch. Accepts top-level IDs like '4029:12345' and instance-child IDs like 'I12740:17806;12740:17793'."
    ),
    depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "How many levels deep to serialize fully. Default 0 = this node only with children as {id,name,type} stubs. Set higher for more depth, or pass a large number for the full subtree."
      ),
    fields: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Optional dot-paths to keep in the response, e.g. ['bounds','styles.fills','styles.effects']. When provided, only these fields plus id/name/type are returned. Recurses through arrays — 'children.styles.fills' projects each child. Big payload trimmer for large nodes."
      ),
    includePrototype: z
      .boolean()
      .optional()
      .describe(
        "When true, adds a `prototype` field with the reactions on this node and its descendants (the scan get_prototype_connections returns). Not available in FigJam."
      ),
    fileKey: fileKeyField,
  }),

  get_prototype_connections: z.object({
    nodeId: createFigmaNodeIdSchema()
      .optional()
      .describe(
        "Root to scan (a page, screen, button, or instance). The node and all descendants, including instance sublayers, are inspected. Omit to scan the current page."
      ),
    maxNodes: z
      .number()
      .int()
      .min(1)
      .max(50000)
      .optional()
      .describe("Stop after inspecting this many nodes (default 5000); `truncated` reports it."),
    includeEmpty: z
      .boolean()
      .optional()
      .describe("Also list nodes that support reactions but have none (default false)."),
    fileKey: fileKeyField,
  }),

  trace_prototype_flow: z.object({
    nodeId: createFigmaNodeIdSchema().describe(
      "Screen (or any node inside one) to start from. Screen-to-screen navigation is followed breadth-first."
    ),
    maxScreens: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Maximum screens to expand (default 25); the rest are listed in `pending`."),
    maxNodesPerScreen: z
      .number()
      .int()
      .min(1)
      .max(50000)
      .optional()
      .describe("Maximum nodes to inspect on each screen (default 5000)."),
    fileKey: fileKeyField,
  }),

  get_styles: z.object({
    fileKey: fileKeyField,
  }),

  get_metadata: z.object({
    fileKey: fileKeyField,
  }),

  get_design_context: z.object({
    depth: z
      .number()
      .optional()
      .describe("How many levels deep to traverse the node tree (default 2)"),
    fileKey: fileKeyField,
  }),

  get_variable_defs: z.object({
    fileKey: fileKeyField,
  }),

  get_screenshot: z.object({
    nodeIds: z
      .array(createFigmaNodeIdSchema())
      .optional()
      .describe(
        "Optional list of node IDs to export. Accepts top-level IDs like '4029:12345' and instance-child IDs like 'I12740:17806;12740:17793'. Never use hyphens. If empty, exports the current selection."
      ),
    format: createExportFormatSchema()
      .optional()
      .describe(
        "Export format: PNG (default), SVG, JPG, PDF, or WEBP. WEBP is encoded server-side from a PNG export (needs the `cwebp` binary on PATH) since Figma cannot export webp directly."
      ),
    scale: z.number().optional().describe("Export scale for raster formats (default 2)"),
    outputPath: z
      .string()
      .optional()
      .describe(
        "If set, write the exported image to this path and return only metadata. Relative paths resolve from the MCP server cwd. For multiple nodeIds, prefer save_screenshots instead."
      ),
    inline: z
      .boolean()
      .optional()
      .describe(
        "If true, return base64 image bytes inline in the response. Default false — by default the image is written to a temp file (or outputPath) and only the path + size are returned, to avoid filling the agent's context."
      ),
    isolate: z
      .boolean()
      .optional()
      .describe(
        "If true, hide every sibling of each target node (other children of its parent) before exporting and restore them after — even on failure. Useful for capturing a layer cleanly without the rest of the frame. Cheaper than a manual set_node_visibility / export / restore loop and atomic."
      ),
    clip: z
      .boolean()
      .optional()
      .describe(
        "When true, export using Figma's absolute node bounds (REST use_absolute_bounds / plugin useAbsoluteBounds) so PNGs are clipped to the node's logical bounds"
      ),
    fileKey: fileKeyField,
  }),

  find_nodes: findNodesInput,

  get_node_by_path: getNodeByPathInput,

  image_fill_export: imageFillExportInput,

  save_children_json: saveChildrenJsonInput,

  save_node_json: z.object({
    items: z
      .array(
        z.object({
          nodeId: createFigmaNodeIdSchema().describe("The node ID to serialize"),
          outputPath: z
            .string()
            .min(1)
            .describe(
              "Output .json file path (relative paths resolve from the MCP server current working directory)"
            ),
        })
      )
      .min(1)
      .describe("List of nodes to serialize and save as JSON files"),
    fileKey: fileKeyField,
  }),

  set_node_visibility: z.object({
    items: z
      .array(
        z.object({
          nodeId: createFigmaNodeIdSchema().describe("The node ID to modify"),
          visible: z.boolean().describe("true to show, false to hide"),
        })
      )
      .min(1)
      .describe("List of nodes with their target visibility"),
    fileKey: fileKeyField,
  }),

  set_text_content: setTextContentInput,

  set_text_properties: setTextPropertiesInput,

  set_gradient_fill: setGradientFillInput,

  set_solid_fill: setSolidFillInput,

  set_effects: setEffectsInput,

  set_stroke_properties: setStrokePropertiesInput.refine(
    hasAnyProperty("nodeId", "fileKey"),
    "At least one stroke property must be provided"
  ),

  set_auto_layout: setAutoLayoutInput.refine(
    hasAnyProperty("nodeId", "fileKey"),
    "At least one auto-layout property must be provided"
  ),

  set_node_properties: setNodePropertiesInput,

  create_page: createPageInput,

  create_frame: createFrameInput.refine(
    (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
    "fillHex is required when fillOpacity is provided"
  ),

  create_section: createSectionInput,

  create_text: createTextInput,

  create_shape: createShapeInput,

  create_shape_with_text: createShapeWithTextInput,

  create_image: createImageInput,

  create_svg: createSvgInput,

  import_html_layers: importHtmlLayersInput,

  create_sticky: z.object({
    name: z.string().optional().describe("Optional sticky note name"),
    parentId: createFigmaNodeIdSchema()
      .optional()
      .describe("Optional parent node ID to append the sticky into"),
    characters: z.string().optional().describe("Initial text content for the sticky note"),
    x: z.number().optional().describe("Optional x position"),
    y: z.number().optional().describe("Optional y position"),
    isWideWidth: z
      .boolean()
      .optional()
      .describe("Set to true for the wide sticky shape (default false)"),
    fileKey: fileKeyField,
  }),

  create_connector: createConnectorInput,

  duplicate_nodes: z.object({
    nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("List of node IDs to duplicate"),
    fileKey: fileKeyField,
  }),

  fit_to_content: fitToContentInput,

  distribute_horizontally: distributeInput,

  distribute_vertically: distributeInput,

  align_to_grid: alignToGridInput,

  place_below: placeBelowInput,

  place_right_of: placeRightOfInput,

  duplicate_with_offset: duplicateWithOffsetInput,

  reparent_nodes: z.object({
    nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("List of node IDs to move"),
    parentId: createFigmaNodeIdSchema().describe("Destination parent node ID"),
    fileKey: fileKeyField,
  }),

  group_nodes: groupNodesInput,

  ungroup_node: ungroupNodeInput,

  get_css: z.object({
    nodeIds: z.array(createFigmaNodeIdSchema()).min(1).max(50).describe("Nodes to read CSS for"),
    fileKey: fileKeyField,
  }),

  get_components: getComponentsInput,
  get_component_info: getComponentInfoInput,
  create_component: createComponentInput,
  combine_as_variants: combineAsVariantsInput,
  edit_component: editComponentInput,
  bind_component_property: bindComponentPropertyInput,
  create_instance: createInstanceInput,
  set_instance_properties: setInstancePropertiesInput,
  swap_instance: swapInstanceInput,
  detach_instances: instanceIdsInput,
  reset_instance_overrides: instanceIdsInput,

  set_selection: setSelectionInput,

  scroll_and_zoom_into_view: scrollAndZoomIntoViewInput,

  delete_nodes: z.object({
    nodeIds: z.array(createFigmaNodeIdSchema()).min(1).describe("List of node IDs to delete"),
    confirm: z.boolean().describe("Must be true to confirm deletion"),
    fileKey: fileKeyField,
  }),

  save_screenshots: z.object({
    items: z
      .array(
        z.object({
          nodeId: createFigmaNodeIdSchema().describe(
            "The node ID to export. Accepts top-level IDs like '4029:12345' and instance-child IDs like 'I12740:17806;12740:17793'."
          ),
          outputPath: z
            .string()
            .min(1)
            .describe(
              "Output file path (relative paths resolve from the MCP server current working directory)"
            ),
          format: createExportFormatSchema()
            .optional()
            .describe("Per-item export format override: PNG, SVG, JPG, PDF, or WEBP"),
          scale: z
            .number()
            .optional()
            .describe("Per-item export scale override for raster formats"),
          clip: z
            .boolean()
            .optional()
            .describe(
              "Per-item clipping override. When true, PNGs are clipped to the node's logical bounds using Figma's absolute node bounds."
            ),
        })
      )
      .min(1)
      .describe("List of screenshot save operations to execute in batch"),
    format: createExportFormatSchema()
      .optional()
      .describe(
        "Default export format: PNG (default), SVG, JPG, PDF, or WEBP. WEBP is encoded server-side from a PNG export (needs the `cwebp` binary on PATH)."
      ),
    scale: z.number().optional().describe("Default export scale for raster formats (default 2)"),
    clip: z
      .boolean()
      .optional()
      .describe(
        "Default clipping behavior for saved screenshots. When true, PNGs are clipped to the node's logical bounds using Figma's absolute node bounds."
      ),
    fileKey: fileKeyField,
  }),

  get_motion_styles: z.object({
    fileKey: fileKeyField,
  }),

  get_node_motion: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to fetch motion properties for"),
    fileKey: fileKeyField,
  }),

  apply_animation_style: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to apply the style to"),
    styleId: z.string().describe("The ID of the animation style to apply"),
    animationStyleData: z
      .record(z.unknown())
      .optional()
      .describe(
        "Optional values used to configure the applied animation style (e.g. duration, timelineOffset, axis, direction)"
      ),
    fileKey: fileKeyField,
  }),

  remove_animation_style: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to remove the style from"),
    animationStyleId: z
      .string()
      .optional()
      .describe(
        "The ID of the animation style to remove. If omitted, all animation styles are removed."
      ),
    fileKey: fileKeyField,
  }),

  apply_manual_keyframe_track: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to apply the track to"),
    field: z
      .record(z.unknown())
      .describe(
        "The property, paint, or effect field to animate. Example: { type: 'PROPERTY', name: 'TRANSLATION_X' }"
      ),
    track: z
      .record(z.unknown())
      .describe("The manual keyframe track to write. Contains keyframes, baseValue, etc."),
    fileKey: fileKeyField,
  }),

  remove_manual_keyframe_track: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to remove the track from"),
    field: z
      .record(z.unknown())
      .describe(
        "The property, paint, or effect field to remove. Example: { type: 'PROPERTY', name: 'TRANSLATION_X' }"
      ),
    fileKey: fileKeyField,
  }),

  set_timeline_duration: z.object({
    nodeId: createFigmaNodeIdSchema().describe(
      "The node ID whose timeline duration will be changed"
    ),
    timelineId: z.string().describe("A timeline id read from the node's timelines array"),
    duration: z
      .number()
      .positive()
      .describe("The new timeline duration in seconds (must be greater than zero)"),
    fileKey: fileKeyField,
  }),
} as const;

type ToolName = keyof typeof toolInputSchemas;

/**
 * Wire-format schema for create_image on the follower→leader RPC path.
 *
 * The create_image tool handler resolves `source` (file path / URL / data URI)
 * into `imageBase64` before forwarding, so the payload on the wire carries
 * `imageBase64` and never `source`. `fileKey` is omitted too — it travels
 * beside the params as a separate `sendWithParams` argument. Validating this
 * path against the advertised `createImageInput` (which requires `source`)
 * rejected every follower create_image call with a 400 (#35).
 */
const createImageRpcInput = createImageInput.omit({ source: true, fileKey: true }).extend({
  imageBase64: z
    .string()
    .min(1)
    .describe("Base64-encoded image bytes, resolved from `source` by the tool handler"),
});

const createSvgRpcInput = createSvgInput.omit({ source: true, fileKey: true }).extend({
  svgText: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= MAX_SVG_BYTES,
      `SVG source exceeds the ${MAX_SVG_BYTES} byte bridge limit`
    )
    .describe("SVG markup resolved from source by the tool handler"),
});

/**
 * Schemas the RPC path validates against. Tools whose handlers rewrite the
 * payload before forwarding validate their wire shape here; every other tool
 * validates against its advertised MCP input schema.
 */
/**
 * Wire-format schema for import_html_layers on the follower→leader RPC path.
 * Mirrors createImageRpcInput: the tool handler resolves `source` (JSON file
 * path) into the parsed `layers` tree before forwarding.
 */
const importHtmlLayersRpcInput = importHtmlLayersInput
  .omit({ source: true, fileKey: true })
  .extend({
    layers: htmlLayerTree,
  });

const rpcInputSchemas = {
  ...toolInputSchemas,
  create_image: createImageRpcInput,
  create_svg: createSvgRpcInput,
  import_html_layers: importHtmlLayersRpcInput,
} as const;

/**
 * Maps the RPC wire format { tool, nodeIds?, params? } to each tool's
 * expected input shape. Typed as Record<ToolName, ...> so adding a schema
 * without a mapper is a compile error.
 */
const rpcToArgs: Record<
  ToolName,
  (nodeIds?: string[], params?: Record<string, unknown>) => unknown
> = {
  get_css: (nodeIds, params) => ({ nodeIds, ...params }),
  get_components: (_nodeIds, params) => ({ ...params }),
  get_component_info: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  create_component: (_nodeIds, params) => ({ ...params }),
  combine_as_variants: (nodeIds, params) => ({ nodeIds, ...params }),
  edit_component: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  bind_component_property: (nodeIds, params) => ({ nodeIds, ...params }),
  create_instance: (_nodeIds, params) => ({ ...params }),
  set_instance_properties: (nodeIds, params) => ({ nodeIds, ...params }),
  swap_instance: (nodeIds, params) => ({ nodeIds, ...params }),
  detach_instances: (nodeIds, params) => ({ nodeIds, ...params }),
  reset_instance_overrides: (nodeIds, params) => ({ nodeIds, ...params }),
  get_document: (_nodeIds, params) => ({ ...params }),
  get_selection: (_nodeIds, params) => ({ ...params }),
  get_layout_tree: (nodeIds, params) => ({ ...params, rootId: nodeIds?.[0] }),
  get_node: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  get_prototype_connections: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  trace_prototype_flow: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  get_styles: (_nodeIds, params) => ({ ...params }),
  get_metadata: (_nodeIds, params) => ({ ...params }),
  get_design_context: (_nodeIds, params) => ({ ...params }),
  get_variable_defs: (_nodeIds, params) => ({ ...params }),
  get_screenshot: (nodeIds, params) => ({ nodeIds, ...params }),
  find_nodes: (_nodeIds, params) => ({ ...params }),
  get_node_by_path: (_nodeIds, params) => ({ ...params }),
  image_fill_export: (_nodeIds, params) => ({ ...params }),
  save_children_json: (_nodeIds, params) => ({ ...params }),
  save_node_json: (_nodeIds, params) => ({ ...params }),
  set_node_visibility: (_nodeIds, params) => ({ ...params }),
  set_text_content: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_text_properties: (nodeIds, params) => ({
    ...params,
    nodeId: nodeIds?.[0],
  }),
  set_node_properties: (nodeIds, params) => ({ nodeIds, ...params }),
  set_gradient_fill: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_solid_fill: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_effects: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_stroke_properties: (nodeIds, params) => ({
    ...params,
    nodeId: nodeIds?.[0],
  }),
  set_auto_layout: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  create_page: (_nodeIds, params) => ({ ...params }),
  create_frame: (_nodeIds, params) => ({ ...params }),
  create_section: (_nodeIds, params) => ({ ...params }),
  create_text: (_nodeIds, params) => ({ ...params }),
  create_shape: (_nodeIds, params) => ({ ...params }),
  create_shape_with_text: (_nodeIds, params) => ({ ...params }),
  create_image: (_nodeIds, params) => ({ ...params }),
  create_svg: (_nodeIds, params) => ({ ...params }),
  import_html_layers: (_nodeIds, params) => ({ ...params }),
  create_sticky: (_nodeIds, params) => ({ ...params }),
  create_connector: (_nodeIds, params) => ({ ...params }),
  duplicate_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  fit_to_content: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  distribute_horizontally: (nodeIds, params) => ({ nodeIds, ...params }),
  distribute_vertically: (nodeIds, params) => ({ nodeIds, ...params }),
  align_to_grid: (nodeIds, params) => ({ nodeIds, ...params }),
  place_below: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  place_right_of: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  duplicate_with_offset: (nodeIds, params) => ({ nodeIds, ...params }),
  reparent_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  group_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  ungroup_node: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  set_selection: (nodeIds, params) => ({ nodeIds, ...params }),
  scroll_and_zoom_into_view: (nodeIds, params) => ({ nodeIds, ...params }),
  delete_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  save_screenshots: (_nodeIds, params) => ({ ...params }),
  get_motion_styles: (_nodeIds, params) => ({ ...params }),
  get_node_motion: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  apply_animation_style: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  remove_animation_style: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  apply_manual_keyframe_track: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  remove_manual_keyframe_track: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_timeline_duration: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
};

/**
 * Result of validating an RPC request.
 *
 * `params` carries the schema's output so callers forward normalised values
 * rather than the caller's raw object. Without it a schema that rewrites input
 * — such as the create_* field aliases on `set_solid_fill` / `set_text_content`
 * — would pass validation here and then be rejected by the plugin, which only
 * understands the canonical spelling.
 */
export interface RpcValidation {
  /** Human-readable message when validation failed, null when it passed. */
  error: string | null;
  /**
   * Normalised params to forward to the plugin. Undefined when validation
   * failed, or when the tool has no schema and nothing was normalised — in that
   * case forward the caller's original params.
   */
  params?: Record<string, unknown>;
}

/**
 * Validate an RPC request against the corresponding tool's input schema.
 *
 * Tools without a schema are passed through unvalidated, matching the previous
 * behaviour.
 */
export function validateRpc(
  tool: string,
  nodeIds?: string[],
  params?: Record<string, unknown>
): RpcValidation {
  if (!(tool in rpcInputSchemas)) return { error: null };

  const name = tool as ToolName;
  const result = rpcInputSchemas[name].safeParse(rpcToArgs[name](nodeIds, params));
  if (!result.success) {
    return { error: result.error.issues[0].message };
  }

  // `rpcToArgs` folds the transport-level `nodeIds` into the tool schema's own
  // id fields so validation can see them. The plugin reads node ids off
  // `request.nodeIds` instead — which the leader re-attaches from the wire — so
  // drop them again, along with `fileKey`, which travels beside the params
  // rather than inside them. Leaving `nodeIds` in the params would leak into
  // per-tool param handling (e.g. set_node_properties' "has updates" check).
  const {
    nodeId: _nodeId,
    nodeIds: _nodeIds,
    fileKey: _fileKey,
    ...rest
  } = result.data as Record<string, unknown>;
  return { error: null, params: rest };
}
