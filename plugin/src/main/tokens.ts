/**
 * Design-token tooling: variable collections, modes, variables, variable
 * bindings on nodes, and paint / text / effect / grid styles.
 *
 * References are forgiving on purpose — agents rarely hold ids:
 *   - collections: id or name
 *   - modes: modeId or mode name (within the collection)
 *   - variables: id (`VariableID:…`), name, or `Collection/name` when a name
 *     exists in several collections
 *   - styles: id (`S:…`) or published style key
 */

import { buildEffect } from "./extraProps";

export const TOKEN_REQUEST_TYPES = [
  "create_variable_collection",
  "edit_variable_collection",
  "upsert_variables",
  "delete_variables",
  "bind_variables",
  "set_variable_mode",
  "create_style",
  "edit_style",
  "apply_style",
  "delete_styles",
] as const;

export type TokenRequestType = (typeof TOKEN_REQUEST_TYPES)[number];

/** Every token tool mutates the document. */
export const TOKEN_EDIT_REQUEST_TYPES: ReadonlyArray<TokenRequestType> = TOKEN_REQUEST_TYPES;

export const isTokenRequestType = (type: string): type is TokenRequestType =>
  (TOKEN_REQUEST_TYPES as ReadonlyArray<string>).includes(type);

type Params = Record<string, unknown>;
type ValueType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const getScene = async (nodeId: string): Promise<SceneNode> => {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node as SceneNode;
};

const resolveCollection = async (ref: unknown): Promise<VariableCollection> => {
  if (typeof ref !== "string" || !ref) throw new Error("collection id or name is required");
  const byId = await figma.variables.getVariableCollectionByIdAsync(ref).catch(() => null);
  if (byId) return byId;
  const all = await figma.variables.getLocalVariableCollectionsAsync();
  const matches = all.filter((c) => c.name === ref);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Collection name "${ref}" is ambiguous: ${matches.map((c) => c.id).join(", ")}`
    );
  }
  throw new Error(
    `No variable collection "${ref}". Local collections: ${all.map((c) => c.name).join(", ") || "(none)"}`
  );
};

const resolveMode = (collection: VariableCollection, ref: unknown): string => {
  if (typeof ref !== "string") throw new Error("mode id or name is required");
  const mode = collection.modes.find((m) => m.modeId === ref || m.name === ref);
  if (!mode) {
    throw new Error(
      `No mode "${ref}" in ${collection.name}. Modes: ${collection.modes.map((m) => m.name).join(", ")}`
    );
  }
  return mode.modeId;
};

const resolveVariable = async (ref: unknown, scope?: VariableCollection): Promise<Variable> => {
  if (typeof ref !== "string" || !ref) throw new Error("variable id or name is required");
  if (ref.startsWith("VariableID:")) {
    const v = await figma.variables.getVariableByIdAsync(ref);
    if (!v) throw new Error(`Variable not found: ${ref}`);
    return v;
  }
  const locals = await figma.variables.getLocalVariablesAsync();
  const collections = new Map(
    (await figma.variables.getLocalVariableCollectionsAsync()).map((c) => [c.id, c.name])
  );
  const candidates = locals.filter((v) => {
    if (scope && v.variableCollectionId !== scope.id) return false;
    return v.name === ref || `${collections.get(v.variableCollectionId)}/${v.name}` === ref;
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(
      `Variable "${ref}" exists in several collections; prefix the collection name: ${candidates
        .map((v) => `${collections.get(v.variableCollectionId)}/${v.name}`)
        .join(", ")}`
    );
  }
  // Library variable by key.
  if (/^[0-9a-f]{40}$/i.test(ref)) return figma.variables.importVariableByKeyAsync(ref);
  throw new Error(`No local variable named "${ref}"`);
};

const resolveStyle = async (ref: string): Promise<BaseStyle> => {
  if (ref.startsWith("S:")) {
    const style = await figma.getStyleByIdAsync(ref);
    if (!style) throw new Error(`Style not found: ${ref}`);
    return style;
  }
  try {
    return await figma.importStyleByKeyAsync(ref);
  } catch (err) {
    throw new Error(
      `"${ref}" is neither a local style id (S:…) nor an importable published style key: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
};

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const parseColor = (value: unknown): RGBA => {
  if (typeof value === "string") {
    let h = value.trim().replace(/^#/, "");
    if (h.length === 3 || h.length === 4) h = h.replace(/./g, (c) => c + c);
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) throw new Error(`Invalid color: ${value}`);
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  if (value && typeof value === "object" && "r" in value) {
    const c = value as { r: number; g: number; b: number; a?: number };
    return { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 };
  }
  throw new Error(`Invalid color: ${JSON.stringify(value)}`);
};

const toVariableValue = async (type: ValueType, value: unknown): Promise<VariableValue> => {
  if (value && typeof value === "object" && "alias" in value) {
    const target = await resolveVariable((value as { alias: unknown }).alias);
    return figma.variables.createVariableAlias(target);
  }
  switch (type) {
    case "COLOR":
      return parseColor(value);
    case "FLOAT":
      if (typeof value !== "number")
        throw new Error(`FLOAT value must be a number, got ${JSON.stringify(value)}`);
      return value;
    case "BOOLEAN":
      if (typeof value !== "boolean") throw new Error(`BOOLEAN value must be true/false`);
      return value;
    default:
      if (typeof value !== "string") throw new Error(`STRING value must be a string`);
      return value;
  }
};

const hex2 = (n: number) =>
  Math.round(n * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();

const showValue = (value: VariableValue): unknown => {
  if (value && typeof value === "object") {
    if ("type" in value && value.type === "VARIABLE_ALIAS") return { alias: value.id };
    if ("r" in value) {
      const c = value as RGBA;
      const a = "a" in c && c.a !== 1 ? hex2(c.a) : "";
      return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${a}`;
    }
  }
  return value;
};

const describeVariable = (v: Variable, collection: VariableCollection) => ({
  id: v.id,
  name: v.name,
  type: v.resolvedType,
  values: Object.fromEntries(
    collection.modes.map((m) => [
      m.name,
      v.valuesByMode[m.modeId] === undefined ? null : showValue(v.valuesByMode[m.modeId]),
    ])
  ),
  ...(v.description ? { description: v.description } : {}),
  ...(v.scopes.length && !(v.scopes.length === 1 && v.scopes[0] === "ALL_SCOPES")
    ? { scopes: v.scopes }
    : {}),
  ...(Object.keys(v.codeSyntax).length ? { codeSyntax: v.codeSyntax } : {}),
  ...(v.hiddenFromPublishing ? { hiddenFromPublishing: true } : {}),
});

const describeCollection = (c: VariableCollection) => ({
  id: c.id,
  name: c.name,
  modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
  defaultModeId: c.defaultModeId,
  variableCount: c.variableIds.length,
});

// ---------------------------------------------------------------------------
// Variable handlers
// ---------------------------------------------------------------------------

async function createVariableCollection(params: Params) {
  const collection = figma.variables.createVariableCollection(String(params.name));
  const modes = (params.modes as string[] | undefined) ?? [];
  if (modes.length) {
    collection.renameMode(collection.modes[0].modeId, modes[0]);
    for (const name of modes.slice(1)) collection.addMode(name);
  }
  if (typeof params.hiddenFromPublishing === "boolean") {
    collection.hiddenFromPublishing = params.hiddenFromPublishing;
  }
  return describeCollection(collection);
}

async function editVariableCollection(params: Params) {
  const collection = await resolveCollection(params.collection);
  if (collection.remote)
    throw new Error(`${collection.name} is a library collection and is read-only`);
  if (typeof params.name === "string") collection.name = params.name;
  if (typeof params.hiddenFromPublishing === "boolean") {
    collection.hiddenFromPublishing = params.hiddenFromPublishing;
  }
  for (const [ref, newName] of Object.entries(
    (params.renameModes as Record<string, string>) ?? {}
  )) {
    collection.renameMode(resolveMode(collection, ref), newName);
  }
  for (const name of (params.addModes as string[] | undefined) ?? []) collection.addMode(name);
  for (const ref of (params.removeModes as string[] | undefined) ?? []) {
    collection.removeMode(resolveMode(collection, ref));
  }
  return describeCollection(collection);
}

type VariableInput = {
  name: string;
  type?: ValueType;
  values?: Record<string, unknown>;
  description?: string;
  scopes?: VariableScope[];
  codeSyntax?: Partial<Record<CodeSyntaxPlatform, string | null>>;
  hiddenFromPublishing?: boolean;
  rename?: string;
};

async function upsertVariables(params: Params) {
  const collection = await resolveCollection(params.collection);
  if (collection.remote)
    throw new Error(`${collection.name} is a library collection and is read-only`);
  const existing = new Map<string, Variable>();
  for (const id of collection.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) existing.set(v.name, v);
  }

  const created: string[] = [];
  const updated: string[] = [];
  const results = [];
  // Two passes so aliases can point at variables created earlier in the same call.
  const pending: Array<{ input: VariableInput; variable: Variable }> = [];
  for (const input of (params.variables as VariableInput[]) ?? []) {
    let variable = existing.get(input.name);
    if (!variable) {
      if (!input.type) throw new Error(`type is required to create variable "${input.name}"`);
      variable = figma.variables.createVariable(input.name, collection, input.type);
      existing.set(input.name, variable);
      created.push(input.name);
    } else {
      if (input.type && input.type !== variable.resolvedType) {
        throw new Error(
          `"${input.name}" already exists as ${variable.resolvedType}; Figma can't change a variable's type`
        );
      }
      updated.push(input.name);
    }
    pending.push({ input, variable });
  }

  for (const { input, variable } of pending) {
    for (const [modeRef, value] of Object.entries(input.values ?? {})) {
      variable.setValueForMode(
        resolveMode(collection, modeRef),
        await toVariableValue(variable.resolvedType as ValueType, value)
      );
    }
    if (input.description !== undefined) variable.description = input.description;
    if (input.scopes) variable.scopes = input.scopes;
    if (input.hiddenFromPublishing !== undefined) {
      variable.hiddenFromPublishing = input.hiddenFromPublishing;
    }
    for (const [platform, syntax] of Object.entries(input.codeSyntax ?? {}) as Array<
      [CodeSyntaxPlatform, string | null]
    >) {
      if (syntax === null) variable.removeVariableCodeSyntax(platform);
      else variable.setVariableCodeSyntax(platform, syntax);
    }
    if (input.rename) variable.name = input.rename;
    results.push(describeVariable(variable, collection));
  }

  return {
    collection: describeCollection(collection),
    created: created.length ? created : undefined,
    updated: updated.length ? updated : undefined,
    variables: results,
  };
}

async function deleteVariables(params: Params) {
  if (params.confirm !== true) throw new Error("delete_variables requires confirm: true");
  const deleted: Array<{ kind: string; id: string; name: string }> = [];
  for (const ref of (params.variables as string[] | undefined) ?? []) {
    const v = await resolveVariable(ref);
    deleted.push({ kind: "variable", id: v.id, name: v.name });
    v.remove();
  }
  for (const ref of (params.collections as string[] | undefined) ?? []) {
    const c = await resolveCollection(ref);
    deleted.push({ kind: "collection", id: c.id, name: c.name });
    c.remove();
  }
  return { deletedCount: deleted.length, deleted };
}

const NODE_FIELDS = new Set<string>([
  "height",
  "width",
  "characters",
  "itemSpacing",
  "counterAxisSpacing",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "visible",
  "opacity",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "strokeWeight",
  "strokeTopWeight",
  "strokeRightWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "gridRowGap",
  "gridColumnGap",
]);
const TEXT_FIELDS = new Set<string>([
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paragraphSpacing",
  "paragraphIndent",
]);
const EFFECT_FIELDS = new Set<string>(["color", "radius", "spread", "offsetX", "offsetY"]);

/** `fills`, `fills[1]`, `strokes`, `effects[0].radius` → parts. */
const parsePaintField = (field: string) => {
  const m = /^(fills|strokes|effects)(?:\[(\d+)\])?(?:\.(\w+))?$/.exec(field);
  if (!m) return null;
  return {
    list: m[1] as "fills" | "strokes" | "effects",
    index: m[2] ? Number(m[2]) : null,
    sub: m[3],
  };
};

const loadTextFonts = async (node: TextNode) => {
  const fonts =
    node.characters.length > 0
      ? node.getRangeAllFontNames(0, node.characters.length)
      : typeof node.fontName === "symbol"
        ? []
        : [node.fontName];
  await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
};

async function bindVariables(nodeIds: string[], params: Params) {
  const bindings = (params.bindings as Record<string, string | null>) ?? {};
  const results = [];
  for (const nodeId of nodeIds) {
    const node = await getScene(nodeId);
    const applied: Record<string, string | null> = {};
    for (const [field, ref] of Object.entries(bindings)) {
      const variable = ref === null ? null : await resolveVariable(ref);
      const paint = parsePaintField(field);

      if (paint && paint.list !== "effects") {
        if (!(paint.list in node))
          throw new Error(`${node.id} (${node.type}) has no ${paint.list}`);
        const host = node as SceneNode & {
          fills: ReadonlyArray<Paint>;
          strokes: ReadonlyArray<Paint>;
        };
        let list = [...(host[paint.list] as ReadonlyArray<Paint>)];
        if (list.length === 0 && variable) {
          list = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
        }
        const targets = paint.index === null ? list.map((_, i) => i) : [paint.index];
        for (const i of targets) {
          const p = list[i];
          if (!p) throw new Error(`${node.id} has no ${paint.list}[${i}]`);
          if (p.type !== "SOLID") {
            if (paint.index === null) continue;
            throw new Error(
              `${paint.list}[${i}] is ${p.type}; only SOLID paints bind to color variables`
            );
          }
          list[i] = figma.variables.setBoundVariableForPaint(p, "color", variable);
        }
        host[paint.list] = list;
        applied[field] = variable?.id ?? null;
        continue;
      }

      if (paint && paint.list === "effects") {
        if (!("effects" in node)) throw new Error(`${node.id} (${node.type}) has no effects`);
        if (paint.index === null || !paint.sub || !EFFECT_FIELDS.has(paint.sub)) {
          throw new Error(`Use effects[i].color|radius|spread|offsetX|offsetY (got ${field})`);
        }
        const effects = [...node.effects];
        if (!effects[paint.index]) throw new Error(`${node.id} has no effects[${paint.index}]`);
        effects[paint.index] = figma.variables.setBoundVariableForEffect(
          effects[paint.index],
          paint.sub as VariableBindableEffectField,
          variable
        );
        node.effects = effects;
        applied[field] = variable?.id ?? null;
        continue;
      }

      if (TEXT_FIELDS.has(field) || field === "characters") {
        if (node.type !== "TEXT")
          throw new Error(`${field} binds only on TEXT nodes (${node.id} is ${node.type})`);
        await loadTextFonts(node);
      } else if (!NODE_FIELDS.has(field)) {
        throw new Error(
          `Unknown bindable field "${field}". Node: ${[...NODE_FIELDS].join(", ")}; text: ${[...TEXT_FIELDS].join(", ")}; paints: fills, fills[i], strokes, strokes[i]; effects[i].color|radius|spread|offsetX|offsetY`
        );
      }
      node.setBoundVariable(
        field as VariableBindableNodeField | VariableBindableTextField,
        variable
      );
      applied[field] = variable?.id ?? null;
    }
    results.push({ nodeId: node.id, nodeName: node.name, applied });
  }
  return results.length === 1 ? results[0] : { updatedCount: results.length, results };
}

async function setVariableMode(nodeIds: string[], params: Params) {
  const collection = await resolveCollection(params.collection);
  const modeId = params.mode === null ? null : resolveMode(collection, params.mode);
  const results = [];
  for (const id of nodeIds) {
    const node = await getScene(id);
    const label = `${node.id} (${node.type})`;
    if (!("setExplicitVariableModeForCollection" in node)) {
      throw new Error(`${label} can't carry variable modes`);
    }
    if (modeId === null) node.clearExplicitVariableModeForCollection(collection);
    else node.setExplicitVariableModeForCollection(collection, modeId);
    results.push({
      nodeId: node.id,
      nodeName: node.name,
      explicitVariableModes: node.explicitVariableModes,
    });
  }
  return results.length === 1 ? results[0] : { updatedCount: results.length, results };
}

// ---------------------------------------------------------------------------
// Style handlers
// ---------------------------------------------------------------------------

type StyleKind = "PAINT" | "TEXT" | "EFFECT" | "GRID";

const describeStyle = (style: BaseStyle) => {
  const base = {
    id: style.id,
    key: style.key,
    name: style.name,
    type: style.type,
    ...(style.description ? { description: style.description } : {}),
  };
  if (style.type === "PAINT") return { ...base, paints: (style as PaintStyle).paints };
  if (style.type === "EFFECT") return { ...base, effects: (style as EffectStyle).effects };
  if (style.type === "GRID") return { ...base, layoutGrids: (style as GridStyle).layoutGrids };
  const t = style as TextStyle;
  return {
    ...base,
    fontName: t.fontName,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    textCase: t.textCase,
    textDecoration: t.textDecoration,
    paragraphSpacing: t.paragraphSpacing,
    paragraphIndent: t.paragraphIndent,
  };
};

const copyFromNode = async (style: BaseStyle, sourceId: string, params: Params) => {
  const node = await getScene(sourceId);
  switch (style.type) {
    case "PAINT": {
      const field = params.fromField === "strokes" ? "strokes" : "fills";
      if (!(field in node)) throw new Error(`${node.id} (${node.type}) has no ${field}`);
      const paints = (node as SceneNode & { fills: Paint[] | symbol; strokes: Paint[] })[field];
      if (typeof paints === "symbol") throw new Error(`${node.id} has mixed ${field}`);
      (style as PaintStyle).paints = paints;
      return;
    }
    case "EFFECT":
      if (!("effects" in node)) throw new Error(`${node.id} (${node.type}) has no effects`);
      (style as EffectStyle).effects = node.effects;
      return;
    case "GRID":
      if (!("layoutGrids" in node))
        throw new Error(`${node.id} (${node.type}) has no layout grids`);
      (style as GridStyle).layoutGrids = node.layoutGrids;
      return;
    case "TEXT": {
      if (node.type !== "TEXT")
        throw new Error(`Text styles copy from a TEXT node (${node.id} is ${node.type})`);
      const t = style as TextStyle;
      const mixed = (v: unknown) => typeof v === "symbol";
      if (mixed(node.fontName) || mixed(node.fontSize)) {
        throw new Error(
          `${node.id} has mixed fonts or sizes; copy from a uniformly styled text layer`
        );
      }
      await figma.loadFontAsync(node.fontName as FontName);
      t.fontName = node.fontName as FontName;
      t.fontSize = node.fontSize as number;
      if (!mixed(node.lineHeight)) t.lineHeight = node.lineHeight as LineHeight;
      if (!mixed(node.letterSpacing)) t.letterSpacing = node.letterSpacing as LetterSpacing;
      if (!mixed(node.textCase)) t.textCase = node.textCase as TextCase;
      if (!mixed(node.textDecoration)) t.textDecoration = node.textDecoration as TextDecoration;
      if (!mixed(node.paragraphSpacing)) t.paragraphSpacing = node.paragraphSpacing as number;
      if (!mixed(node.paragraphIndent)) t.paragraphIndent = node.paragraphIndent as number;
      return;
    }
  }
};

const applyStyleProps = async (style: BaseStyle, params: Params) => {
  if (typeof params.name === "string") style.name = params.name;
  if (typeof params.description === "string") style.description = params.description;

  if (typeof params.fromNodeId === "string") await copyFromNode(style, params.fromNodeId, params);

  if (style.type === "PAINT") {
    const ps = style as PaintStyle;
    if (params.color !== undefined) {
      const c = parseColor(params.color);
      ps.paints = [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
    }
    if (params.colorVariable !== undefined) {
      const variable =
        params.colorVariable === null ? null : await resolveVariable(params.colorVariable);
      const base =
        ps.paints[0]?.type === "SOLID"
          ? (ps.paints[0] as SolidPaint)
          : ({ type: "SOLID", color: { r: 0, g: 0, b: 0 } } as SolidPaint);
      ps.paints = [
        figma.variables.setBoundVariableForPaint(base, "color", variable),
        ...ps.paints.slice(1),
      ];
    }
  }

  if (style.type === "EFFECT" && Array.isArray(params.effects)) {
    (style as EffectStyle).effects = (params.effects as Params[]).map(buildEffect);
  }

  if (style.type === "TEXT") {
    const t = style as TextStyle;
    const family = params.fontFamily as string | undefined;
    const fontStyle = params.fontStyle as string | undefined;
    await figma.loadFontAsync(t.fontName);
    if (family || fontStyle) {
      const next = { family: family ?? t.fontName.family, style: fontStyle ?? t.fontName.style };
      await figma.loadFontAsync(next);
      t.fontName = next;
    }
    if (typeof params.fontSize === "number") t.fontSize = params.fontSize;
    if (params.lineHeightAuto === true) t.lineHeight = { unit: "AUTO" };
    else if (typeof params.lineHeightPx === "number")
      t.lineHeight = { unit: "PIXELS", value: params.lineHeightPx };
    else if (typeof params.lineHeightPercent === "number")
      t.lineHeight = { unit: "PERCENT", value: params.lineHeightPercent };
    if (typeof params.letterSpacingPx === "number")
      t.letterSpacing = { unit: "PIXELS", value: params.letterSpacingPx };
    else if (typeof params.letterSpacingPercent === "number")
      t.letterSpacing = { unit: "PERCENT", value: params.letterSpacingPercent };
    for (const key of [
      "textCase",
      "textDecoration",
      "paragraphSpacing",
      "paragraphIndent",
      "leadingTrim",
      "listSpacing",
      "textWrapStyle",
    ] as const) {
      if (params[key] !== undefined) (t as unknown as Record<string, unknown>)[key] = params[key];
    }
    for (const [field, ref] of Object.entries(
      (params.variables as Record<string, string | null>) ?? {}
    )) {
      if (!TEXT_FIELDS.has(field))
        throw new Error(`Text styles bind ${[...TEXT_FIELDS].join(", ")} (got ${field})`);
      t.setBoundVariable(
        field as VariableBindableTextField,
        ref === null ? null : await resolveVariable(ref)
      );
    }
  }
};

async function createStyle(params: Params) {
  const kind = params.type as StyleKind;
  const style: BaseStyle =
    kind === "PAINT"
      ? figma.createPaintStyle()
      : kind === "TEXT"
        ? figma.createTextStyle()
        : kind === "EFFECT"
          ? figma.createEffectStyle()
          : figma.createGridStyle();
  try {
    await applyStyleProps(style, params);
  } catch (err) {
    style.remove();
    throw err;
  }
  if (params.applyToSource === true && typeof params.fromNodeId === "string") {
    await applyStyleToNode(
      await getScene(params.fromNodeId),
      style,
      params.fromField === "strokes" ? "stroke" : undefined
    );
  }
  return describeStyle(style);
}

async function editStyle(params: Params) {
  const style = await resolveStyle(String(params.style));
  if (style.remote) throw new Error(`${style.name} is a library style and is read-only`);
  await applyStyleProps(style, params);
  return describeStyle(style);
}

const applyStyleToNode = async (node: SceneNode, style: BaseStyle, slot?: "stroke") => {
  const n = node as SceneNode & Record<string, unknown>;
  const call = async (method: string) => {
    if (typeof n[method] !== "function")
      throw new Error(`${node.id} (${node.type}) can't take a ${style.type} style`);
    await (n[method] as (id: string) => Promise<void>).call(node, style.id);
  };
  if (style.type === "PAINT")
    await call(slot === "stroke" ? "setStrokeStyleIdAsync" : "setFillStyleIdAsync");
  else if (style.type === "TEXT") await call("setTextStyleIdAsync");
  else if (style.type === "EFFECT") await call("setEffectStyleIdAsync");
  else await call("setGridStyleIdAsync");
};

const SLOT_METHODS = {
  fill: "setFillStyleIdAsync",
  stroke: "setStrokeStyleIdAsync",
  text: "setTextStyleIdAsync",
  effect: "setEffectStyleIdAsync",
  grid: "setGridStyleIdAsync",
} as const;

async function applyStyle(nodeIds: string[], params: Params) {
  const slots = (params.styles as Partial<Record<keyof typeof SLOT_METHODS, string | null>>) ?? {};
  const resolved: Array<[keyof typeof SLOT_METHODS, string]> = [];
  for (const [slot, ref] of Object.entries(slots) as Array<
    [keyof typeof SLOT_METHODS, string | null]
  >) {
    // "" detaches the style but keeps the node's current values.
    resolved.push([slot, ref === null ? "" : (await resolveStyle(ref)).id]);
  }
  const results = [];
  for (const id of nodeIds) {
    const node = (await getScene(id)) as SceneNode & Record<string, unknown>;
    for (const [slot, styleId] of resolved) {
      const method = SLOT_METHODS[slot];
      if (typeof node[method] !== "function")
        throw new Error(`${node.id} (${node.type}) has no ${slot} style`);
      await (node[method] as (id: string) => Promise<void>).call(node, styleId);
    }
    results.push({
      nodeId: node.id,
      nodeName: node.name,
      fillStyleId: node.fillStyleId,
      strokeStyleId: node.strokeStyleId,
      textStyleId: node.textStyleId,
      effectStyleId: node.effectStyleId,
      gridStyleId: node.gridStyleId,
    });
  }
  return results.length === 1 ? results[0] : { updatedCount: results.length, results };
}

async function deleteStyles(params: Params) {
  if (params.confirm !== true) throw new Error("delete_styles requires confirm: true");
  const deleted = [];
  for (const ref of (params.styles as string[]) ?? []) {
    const style = await resolveStyle(ref);
    if (style.remote) throw new Error(`${style.name} is a library style and can't be deleted here`);
    deleted.push({ id: style.id, name: style.name, type: style.type });
    style.remove();
  }
  return { deletedCount: deleted.length, deleted };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const requireIds = (type: string, nodeIds?: string[]): string[] => {
  if (!nodeIds || nodeIds.length === 0) throw new Error(`nodeIds is required for ${type}`);
  return nodeIds;
};

export async function handleTokenRequest(
  type: TokenRequestType,
  nodeIds: string[] | undefined,
  params: Params = {}
): Promise<unknown> {
  switch (type) {
    case "create_variable_collection":
      return createVariableCollection(params);
    case "edit_variable_collection":
      return editVariableCollection(params);
    case "upsert_variables":
      return upsertVariables(params);
    case "delete_variables":
      return deleteVariables(params);
    case "bind_variables":
      return bindVariables(requireIds(type, nodeIds), params);
    case "set_variable_mode":
      return setVariableMode(requireIds(type, nodeIds), params);
    case "create_style":
      return createStyle(params);
    case "edit_style":
      return editStyle(params);
    case "apply_style":
      return applyStyle(requireIds(type, nodeIds), params);
    case "delete_styles":
      return deleteStyles(params);
  }
}
