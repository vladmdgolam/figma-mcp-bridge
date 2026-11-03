/**
 * Component tooling: listing, inspecting, creating and editing components,
 * component sets (variants), component properties, and instances.
 *
 * Every handler returns the `data` payload for the response; errors are thrown
 * and turned into `{ error }` by the dispatcher in code.ts.
 *
 * Property names: Figma suffixes BOOLEAN / TEXT / INSTANCE_SWAP / SLOT property
 * names with a unique id (`Label#12:3`); VARIANT names are bare. Everywhere a
 * property name is accepted here, the bare name works too as long as it is
 * unambiguous — `resolvePropertyName` maps it to the full one.
 */

export const COMPONENT_REQUEST_TYPES = [
  "get_components",
  "get_component_info",
  "create_component",
  "combine_as_variants",
  "edit_component",
  "bind_component_property",
  "create_instance",
  "set_instance_properties",
  "swap_instance",
  "detach_instances",
  "reset_instance_overrides",
] as const;

export type ComponentRequestType = (typeof COMPONENT_REQUEST_TYPES)[number];

/** Request types that mutate the document (rejected in Dev Mode). */
export const COMPONENT_EDIT_REQUEST_TYPES: ReadonlyArray<ComponentRequestType> = [
  "create_component",
  "combine_as_variants",
  "edit_component",
  "bind_component_property",
  "create_instance",
  "set_instance_properties",
  "swap_instance",
  "detach_instances",
  "reset_instance_overrides",
];

export const isComponentRequestType = (type: string): type is ComponentRequestType =>
  (COMPONENT_REQUEST_TYPES as ReadonlyArray<string>).includes(type);

type Params = Record<string, unknown>;
type PropertyOwner = ComponentNode | ComponentSetNode;
type PropertyType = ComponentPropertyType;
type ReferenceField = "visible" | "characters" | "mainComponent";

const FIELD_FOR_TYPE: Partial<Record<PropertyType, ReferenceField>> = {
  BOOLEAN: "visible",
  TEXT: "characters",
  INSTANCE_SWAP: "mainComponent",
};

const TYPE_FOR_FIELD: Record<ReferenceField, PropertyType> = {
  visible: "BOOLEAN",
  characters: "TEXT",
  mainComponent: "INSTANCE_SWAP",
};

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

const getScene = async (nodeId: string): Promise<SceneNode> => {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node as SceneNode;
};

const getParent = async (parentId: string): Promise<BaseNode & ChildrenMixin> => {
  const parent = await figma.getNodeByIdAsync(parentId);
  if (!parent || parent.type === "DOCUMENT" || !("appendChild" in parent)) {
    throw new Error(`Parent does not support children: ${parentId}`);
  }
  if (parent.type === "PAGE") await parent.loadAsync();
  return parent as BaseNode & ChildrenMixin;
};

const placeNode = async (node: SceneNode, params: Params): Promise<void> => {
  if (typeof params.parentId === "string") {
    (await getParent(params.parentId)).appendChild(node);
  }
  if (typeof params.x === "number") node.x = params.x;
  if (typeof params.y === "number") node.y = params.y;
};

const pageOf = (node: BaseNode): PageNode | null => {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE") current = current.parent;
  return current as PageNode | null;
};

const isInsideInstance = (node: BaseNode): boolean => {
  let current = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (current.type === "INSTANCE") return true;
    current = current.parent;
  }
  return false;
};

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

const brief = (node: BaseNode) => ({ id: node.id, name: node.name, type: node.type });

const asComponent = async (nodeId: string): Promise<ComponentNode | ComponentSetNode> => {
  const node = await getScene(nodeId);
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(`Expected a COMPONENT or COMPONENT_SET, got ${node.type}: ${nodeId}`);
  }
  return node;
};

const asInstance = async (nodeId: string): Promise<InstanceNode> => {
  const node = await getScene(nodeId);
  if (node.type !== "INSTANCE") {
    throw new Error(`Expected an INSTANCE, got ${node.type}: ${nodeId}`);
  }
  return node;
};

/** The node that holds property definitions: the set for a variant, else the component. */
const propertyOwner = (node: ComponentNode | ComponentSetNode): PropertyOwner =>
  node.type === "COMPONENT" && node.parent?.type === "COMPONENT_SET" ? node.parent : node;

/** Nearest COMPONENT ancestor (or self) whose sublayers can be bound to properties. */
const containingComponent = (node: SceneNode): ComponentNode => {
  let current: BaseNode | null = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if (current.type === "COMPONENT") return current;
    if (current.type === "INSTANCE") {
      throw new Error(
        `${node.id} sits inside nested instance ${current.id}; bind properties on that instance (mainComponent) or expose it with isExposedInstance instead`
      );
    }
    current = current.parent;
  }
  throw new Error(`${node.id} is not inside a component`);
};

// ---------------------------------------------------------------------------
// Property helpers
// ---------------------------------------------------------------------------

const baseName = (fullName: string): string => fullName.replace(/#[^#]*$/, "");

const resolvePropertyName = (names: string[], requested: string, where: string): string => {
  if (names.includes(requested)) return requested;
  const matches = names.filter((n) => baseName(n) === requested);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Property "${requested}" is ambiguous on ${where}; use the full name: ${matches.join(", ")}`
    );
  }
  throw new Error(
    `No property "${requested}" on ${where}. Available: ${names.length ? names.join(", ") : "(none)"}`
  );
};

const serializeDefinitions = (owner: PropertyOwner) =>
  Object.entries(owner.componentPropertyDefinitions).map(([name, def]) => ({
    name,
    baseName: baseName(name),
    type: def.type,
    defaultValue: def.defaultValue,
    ...(def.variantOptions ? { variantOptions: def.variantOptions } : {}),
    ...(def.preferredValues?.length ? { preferredValues: def.preferredValues } : {}),
    ...(def.description ? { description: def.description } : {}),
  }));

const isNodeId = (value: string): boolean => /^I?\d+:\d+(;\d+:\d+)*$/.test(value);

/**
 * Resolves a component reference (node id or published key) to a ComponentNode.
 * A component set resolves to its default variant unless `variant` picks one.
 */
const resolveComponent = async (
  ref: { componentId?: unknown; componentKey?: unknown },
  variant?: unknown
): Promise<ComponentNode> => {
  let node: ComponentNode | ComponentSetNode;
  if (typeof ref.componentId === "string") {
    node = await asComponent(ref.componentId);
  } else if (typeof ref.componentKey === "string") {
    const key = ref.componentKey;
    try {
      node = await figma.importComponentByKeyAsync(key);
    } catch {
      try {
        node = await figma.importComponentSetByKeyAsync(key);
      } catch (err) {
        throw new Error(
          `Could not import component or component set with key ${key} (it must be published to a library this file can use): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } else {
    throw new Error("componentId or componentKey is required");
  }
  return pickVariant(node, variant);
};

const pickVariant = (node: ComponentNode | ComponentSetNode, variant?: unknown): ComponentNode => {
  const wanted =
    variant && typeof variant === "object" ? (variant as Record<string, string>) : undefined;
  if (node.type === "COMPONENT") {
    if (wanted && node.parent?.type === "COMPONENT_SET") return pickVariant(node.parent, wanted);
    return node;
  }
  if (!wanted || Object.keys(wanted).length === 0) return node.defaultVariant;
  const variants = node.children.filter((c): c is ComponentNode => c.type === "COMPONENT");
  const match = variants.find((v) => {
    const props = v.variantProperties ?? {};
    return Object.entries(wanted).every(([k, val]) => props[k] === String(val));
  });
  if (!match) {
    throw new Error(
      `No variant of ${node.name} matches ${JSON.stringify(wanted)}. Variants: ${variants
        .map((v) => v.name)
        .join(" | ")}`
    );
  }
  return match;
};

/** INSTANCE_SWAP values are component node ids; accept a published key too. */
const resolveSwapValue = async (value: unknown): Promise<string> => {
  if (typeof value !== "string" || !value) {
    throw new Error("INSTANCE_SWAP values must be a component id or key");
  }
  if (isNodeId(value)) {
    const node = await asComponent(value);
    return pickVariant(node).id;
  }
  return (await resolveComponent({ componentKey: value })).id;
};

const resolvePreferredValues = async (values: unknown): Promise<InstanceSwapPreferredValue[]> => {
  if (!Array.isArray(values)) return [];
  const out: InstanceSwapPreferredValue[] = [];
  for (const v of values) {
    if (typeof v === "string") {
      if (isNodeId(v)) {
        const node = await asComponent(v);
        out.push({ type: node.type, key: node.key });
      } else {
        out.push({ type: "COMPONENT", key: v });
      }
    } else if (v && typeof v === "object") {
      const item = v as {
        key?: string;
        type?: "COMPONENT" | "COMPONENT_SET";
        componentId?: string;
      };
      if (item.componentId) {
        const node = await asComponent(item.componentId);
        out.push({ type: node.type, key: node.key });
      } else if (item.key) {
        out.push({ type: item.type ?? "COMPONENT", key: item.key });
      }
    }
  }
  return out;
};

const coerceValue = async (
  type: PropertyType,
  value: unknown,
  name: string
): Promise<string | boolean> => {
  switch (type) {
    case "BOOLEAN":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      throw new Error(`Property "${name}" is BOOLEAN; pass true or false`);
    case "INSTANCE_SWAP":
      return resolveSwapValue(value);
    case "SLOT":
      throw new Error(`Property "${name}" is a SLOT; slot contents can't be set via properties`);
    default:
      if (typeof value !== "string")
        throw new Error(`Property "${name}" is ${type}; pass a string`);
      return value;
  }
};

const variantName = (props: Record<string, string>): string =>
  Object.entries(props)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

/** Layers inside a component that are bound to component properties. */
const boundLayers = (root: ComponentNode | ComponentSetNode, limit = 200) => {
  const out: Array<{ id: string; name: string; type: string; references: object }> = [];
  const visit = (node: SceneNode) => {
    if (out.length >= limit) return;
    if (node !== root && "componentPropertyReferences" in node) {
      const refs = node.componentPropertyReferences;
      if (refs && Object.keys(refs).length > 0) {
        out.push({ id: node.id, name: node.name, type: node.type, references: refs });
      }
    }
    // Don't descend into nested instances: their sublayers belong to another component.
    if (node.type !== "INSTANCE" && "children" in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(root);
  return out;
};

const describeComponentNode = (node: ComponentNode | ComponentSetNode) => ({
  id: node.id,
  name: node.name,
  type: node.type,
  key: node.key,
  remote: node.remote,
  description: node.description || undefined,
  documentationLinks: node.documentationLinks.length
    ? node.documentationLinks.map((l) => l.uri)
    : undefined,
  page: pageOf(node)?.name,
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function getComponents(params: Params) {
  const scope = params.scope === "document" ? "document" : "page";
  const includeVariants = params.includeVariants === true;
  const limit = typeof params.limit === "number" ? params.limit : 200;
  const needle = typeof params.nameContains === "string" ? params.nameContains.toLowerCase() : null;

  let found: Array<ComponentNode | ComponentSetNode>;
  const criteria = {
    types: ["COMPONENT", "COMPONENT_SET"] as Array<"COMPONENT" | "COMPONENT_SET">,
  };
  if (scope === "document") {
    await figma.loadAllPagesAsync();
    found = figma.root.findAllWithCriteria(criteria);
  } else {
    found = figma.currentPage.findAllWithCriteria(criteria);
  }

  const filtered = found.filter((n) => {
    if (!includeVariants && n.type === "COMPONENT" && n.parent?.type === "COMPONENT_SET") {
      return false;
    }
    if (needle && !n.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  const components = filtered.slice(0, limit).map((n) => {
    const entry: Record<string, unknown> = {
      id: n.id,
      name: n.name,
      type: n.type,
      key: n.key,
      page: pageOf(n)?.name,
    };
    if (n.description) entry.description = n.description;
    if (n.type === "COMPONENT" && n.parent?.type === "COMPONENT_SET") {
      entry.componentSetId = n.parent.id;
      entry.variantProperties = n.variantProperties;
    } else {
      const defs = n.componentPropertyDefinitions;
      const props = Object.entries(defs).map(([name, def]) =>
        def.type === "VARIANT"
          ? `${name}: ${def.variantOptions?.join("|")}`
          : `${name} (${def.type})`
      );
      if (props.length) entry.properties = props;
    }
    if (n.type === "COMPONENT_SET") entry.variantCount = n.children.length;
    return entry;
  });

  return {
    scope,
    total: filtered.length,
    returned: components.length,
    truncated: filtered.length > components.length || undefined,
    components,
  };
}

async function getComponentInfo(nodeId: string, params: Params) {
  const node = await getScene(nodeId);
  const includeInstances = params.includeInstances === true;
  const maxInstances = typeof params.maxInstances === "number" ? params.maxInstances : 50;

  if (node.type === "COMPONENT_SET") {
    return {
      ...describeComponentNode(node),
      defaultVariantId: node.defaultVariant?.id,
      properties: serializeDefinitions(node),
      variants: node.children
        .filter((c): c is ComponentNode => c.type === "COMPONENT")
        .map((v) => ({ id: v.id, name: v.name, variantProperties: v.variantProperties })),
      boundLayers: boundLayers(node),
    };
  }

  if (node.type === "COMPONENT") {
    const owner = propertyOwner(node);
    const info: Record<string, unknown> = {
      ...describeComponentNode(node),
      properties: serializeDefinitions(owner),
      boundLayers: boundLayers(node),
    };
    if (owner !== node) {
      info.componentSet = { id: owner.id, name: owner.name, key: owner.key };
      info.variantProperties = node.variantProperties;
      info.propertiesDefinedOn = owner.id;
    }
    if (includeInstances) {
      const instances = await node.getInstancesAsync();
      info.instanceCount = instances.length;
      info.instances = instances.slice(0, maxInstances).map((i) => ({
        id: i.id,
        name: i.name,
        page: pageOf(i)?.name,
      }));
    }
    return info;
  }

  if (node.type === "INSTANCE") {
    const main = await node.getMainComponentAsync();
    const set = main?.parent?.type === "COMPONENT_SET" ? main.parent : null;
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      mainComponent: main
        ? {
            id: main.id,
            name: main.name,
            key: main.key,
            remote: main.remote,
            ...(set ? { componentSet: { id: set.id, name: set.name, key: set.key } } : {}),
          }
        : null,
      componentProperties: Object.fromEntries(
        Object.entries(node.componentProperties).map(([name, p]) => [
          name,
          { type: p.type, value: p.value },
        ])
      ),
      overrides: node.overrides,
      exposedInstances: node.exposedInstances.map(brief),
      isExposedInstance: node.isExposedInstance || undefined,
      scaleFactor: node.scaleFactor !== 1 ? node.scaleFactor : undefined,
      componentPropertyReferences: node.componentPropertyReferences ?? undefined,
    };
  }

  // Any other layer: report its bindings and the component it lives in.
  let container: ComponentNode | null = null;
  try {
    container = containingComponent(node);
  } catch {
    container = null;
  }
  return {
    ...brief(node),
    componentPropertyReferences:
      "componentPropertyReferences" in node ? node.componentPropertyReferences : null,
    insideInstance: isInsideInstance(node) || undefined,
    containingComponent: container
      ? { id: container.id, name: container.name, propertiesDefinedOn: propertyOwner(container).id }
      : null,
  };
}

async function createComponent(params: Params) {
  const sourceIds = Array.isArray(params.fromNodeIds) ? (params.fromNodeIds as string[]) : [];

  const finish = (c: ComponentNode) => {
    if (typeof params.description === "string") c.description = params.description;
    return {
      nodeId: c.id,
      nodeName: c.name,
      key: c.key,
      parentId: c.parent?.id,
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
    };
  };

  if (sourceIds.length > 0) {
    const sources = await Promise.all(sourceIds.map(getScene));
    for (const s of sources) {
      if (s.type === "COMPONENT" || s.type === "COMPONENT_SET") {
        throw new Error(`${s.id} is already a ${s.type}`);
      }
      if (isInsideInstance(s)) throw new Error(`${s.id} is inside an instance; detach it first`);
    }
    const created = sources.map((s) => {
      const c = figma.createComponentFromNode(s);
      if (typeof params.name === "string" && sources.length === 1) c.name = params.name;
      return finish(c);
    });
    return created.length === 1
      ? created[0]
      : { createdCount: created.length, components: created };
  }

  const component = figma.createComponent();
  if (typeof params.name === "string") component.name = params.name;
  component.resize(
    typeof params.width === "number" ? params.width : 100,
    typeof params.height === "number" ? params.height : 100
  );
  if (typeof params.fillHex === "string") {
    component.fills = [
      {
        type: "SOLID",
        color: hexToRgb(params.fillHex),
        opacity: typeof params.fillOpacity === "number" ? params.fillOpacity : 1,
      },
    ];
  }
  try {
    await placeNode(component, params);
  } catch (err) {
    component.remove();
    throw err;
  }
  return finish(component);
}

async function combineAsVariants(nodeIds: string[], params: Params) {
  const nodes = await Promise.all(nodeIds.map(getScene));
  const components: ComponentNode[] = nodes.map((n) => {
    if (n.type === "COMPONENT") return n;
    if (params.convert === true && n.type !== "COMPONENT_SET" && n.type !== "INSTANCE") {
      return figma.createComponentFromNode(n);
    }
    throw new Error(
      `${n.id} is a ${n.type}, not a COMPONENT. Pass convert: true to turn non-component layers into components first.`
    );
  });

  let parent: BaseNode & ChildrenMixin;
  if (typeof params.parentId === "string") {
    parent = await getParent(params.parentId);
  } else {
    const p = components[0].parent;
    if (!p || !("appendChild" in p)) throw new Error("Could not determine a parent; pass parentId");
    if (p.type === "COMPONENT_SET") {
      throw new Error(`${components[0].id} is already a variant of ${p.id}; pass parentId`);
    }
    parent = p as BaseNode & ChildrenMixin;
  }

  const set = figma.combineAsVariants(components, parent);
  if (typeof params.name === "string") set.name = params.name;
  if (typeof params.description === "string") set.description = params.description;

  return {
    nodeId: set.id,
    nodeName: set.name,
    key: set.key,
    parentId: set.parent?.id,
    properties: serializeDefinitions(set),
    variants: set.children.map((v) => ({
      id: v.id,
      name: v.name,
      variantProperties: (v as ComponentNode).variantProperties,
    })),
  };
}

type AddPropertyInput = {
  name: string;
  type: PropertyType;
  defaultValue?: string | boolean;
  preferredValues?: unknown[];
  bindTo?: string[];
};

type EditPropertyInput = {
  name: string;
  newName?: string;
  defaultValue?: string | boolean;
  preferredValues?: unknown[];
};

async function editComponent(nodeId: string, params: Params) {
  const node = await asComponent(nodeId);
  if (node.remote) throw new Error(`${node.id} is a remote library component and is read-only`);
  const owner = propertyOwner(node);
  const where = `${owner.type} ${owner.name} (${owner.id})`;
  const changes: Record<string, unknown> = {};

  if (typeof params.name === "string") {
    node.name = params.name;
    changes.name = node.name;
  }

  if (params.variantProperties && typeof params.variantProperties === "object") {
    if (node.type !== "COMPONENT" || node.parent?.type !== "COMPONENT_SET") {
      throw new Error(
        "variantProperties only applies to a variant (a COMPONENT inside a COMPONENT_SET)"
      );
    }
    const merged = { ...(node.variantProperties ?? {}) };
    for (const [k, v] of Object.entries(params.variantProperties as Record<string, unknown>)) {
      merged[k] = String(v);
    }
    node.name = variantName(merged);
    changes.variantProperties = node.variantProperties;
  }

  if (typeof params.description === "string") {
    node.description = params.description;
    changes.description = node.description;
  }

  if (Array.isArray(params.documentationLinks)) {
    node.documentationLinks = (params.documentationLinks as string[]).map((uri) => ({ uri }));
    changes.documentationLinks = node.documentationLinks.map((l) => l.uri);
  }

  const deleted: string[] = [];
  for (const requested of (params.deleteProperties as string[] | undefined) ?? []) {
    const name = resolvePropertyName(
      Object.keys(owner.componentPropertyDefinitions),
      requested,
      where
    );
    if (owner.componentPropertyDefinitions[name].type === "VARIANT") {
      throw new Error(
        `"${name}" is a VARIANT property; Figma can't delete those via the API — rename the variants instead`
      );
    }
    owner.deleteComponentProperty(name);
    deleted.push(name);
  }

  const edited: Array<{ from: string; to: string }> = [];
  for (const edit of (params.editProperties as EditPropertyInput[] | undefined) ?? []) {
    const defs = owner.componentPropertyDefinitions;
    const name = resolvePropertyName(Object.keys(defs), edit.name, where);
    const type = defs[name].type;
    const update: Parameters<PropertyOwner["editComponentProperty"]>[1] = {};
    if (edit.newName !== undefined) update.name = edit.newName;
    if (edit.defaultValue !== undefined) {
      if (type === "VARIANT") {
        throw new Error(
          `Can't set defaultValue on VARIANT "${name}"; the default variant is the top-left one`
        );
      }
      update.defaultValue = await coerceValue(type, edit.defaultValue, name);
    }
    if (edit.preferredValues !== undefined) {
      update.preferredValues = await resolvePreferredValues(edit.preferredValues);
    }
    edited.push({ from: name, to: owner.editComponentProperty(name, update) });
  }

  const added: Array<{ name: string; type: PropertyType; boundTo?: string[] }> = [];
  for (const add of (params.addProperties as AddPropertyInput[] | undefined) ?? []) {
    const targets = await Promise.all((add.bindTo ?? []).map(getScene));
    const field = FIELD_FOR_TYPE[add.type];
    if (targets.length && !field) {
      throw new Error(`bindTo isn't supported for ${add.type} properties`);
    }

    let defaultValue = add.defaultValue;
    if (defaultValue === undefined) {
      const first = targets[0];
      if (add.type === "BOOLEAN") defaultValue = first ? first.visible : true;
      else if (add.type === "TEXT") defaultValue = first?.type === "TEXT" ? first.characters : "";
      else if (add.type === "INSTANCE_SWAP" && first?.type === "INSTANCE") {
        defaultValue = (await first.getMainComponentAsync())?.id;
      }
    }
    if (defaultValue === undefined) {
      throw new Error(`defaultValue is required for ${add.type} property "${add.name}"`);
    }

    const options: ComponentPropertyOptions = {};
    if (add.preferredValues)
      options.preferredValues = await resolvePreferredValues(add.preferredValues);
    const value = await coerceValue(add.type, defaultValue, add.name);
    const fullName = owner.addComponentProperty(
      add.name,
      add.type,
      value,
      Object.keys(options).length ? options : undefined
    );

    for (const target of targets) {
      bindReference(target, field as ReferenceField, fullName);
    }
    added.push({
      name: fullName,
      type: add.type,
      boundTo: targets.length ? targets.map((t) => t.id) : undefined,
    });
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    propertiesDefinedOn: owner.id,
    changes: Object.keys(changes).length ? changes : undefined,
    deleted: deleted.length ? deleted : undefined,
    edited: edited.length ? edited : undefined,
    added: added.length ? added : undefined,
    properties: serializeDefinitions(owner),
  };
}

const bindReference = (target: SceneNode, field: ReferenceField, fullName: string | null) => {
  // Capture before the `in` narrowing: every SceneNode has the property, so the
  // negative branch narrows `target` to `never`.
  const { id, type } = target;
  if (!("componentPropertyReferences" in target)) {
    throw new Error(`${id} (${type}) can't reference component properties`);
  }
  if (field === "characters" && target.type !== "TEXT") {
    throw new Error(`TEXT properties bind to TEXT layers; ${target.id} is ${target.type}`);
  }
  if (field === "mainComponent" && target.type !== "INSTANCE") {
    throw new Error(
      `INSTANCE_SWAP properties bind to INSTANCE layers; ${target.id} is ${target.type}`
    );
  }
  const next = { ...(target.componentPropertyReferences ?? {}) };
  if (fullName === null) delete next[field];
  else next[field] = fullName;
  target.componentPropertyReferences = next;
};

async function bindComponentProperty(nodeIds: string[], params: Params) {
  const refs = (params.references ?? {}) as Partial<Record<ReferenceField, string | null>>;
  const results = [];
  for (const nodeId of nodeIds) {
    const node = await getScene(nodeId);
    const owner = propertyOwner(containingComponent(node));
    const where = `${owner.type} ${owner.name} (${owner.id})`;
    const defs = owner.componentPropertyDefinitions;

    for (const [field, requested] of Object.entries(refs) as Array<
      [ReferenceField, string | null]
    >) {
      if (requested === null) {
        bindReference(node, field, null);
        continue;
      }
      const name = resolvePropertyName(Object.keys(defs), requested, where);
      if (defs[name].type !== TYPE_FOR_FIELD[field]) {
        throw new Error(
          `"${name}" is ${defs[name].type}; the ${field} field needs a ${TYPE_FOR_FIELD[field]} property`
        );
      }
      bindReference(node, field, name);
    }

    if (typeof params.isExposedInstance === "boolean") {
      if (node.type !== "INSTANCE")
        throw new Error(`isExposedInstance only applies to instances (${node.id})`);
      node.isExposedInstance = params.isExposedInstance;
    }

    results.push({
      nodeId: node.id,
      nodeName: node.name,
      componentPropertyReferences:
        "componentPropertyReferences" in node ? node.componentPropertyReferences : null,
      isExposedInstance: node.type === "INSTANCE" ? node.isExposedInstance : undefined,
    });
  }
  return results.length === 1 ? results[0] : { updatedCount: results.length, results };
}

const applyInstanceProperties = async (instance: InstanceNode, props: Record<string, unknown>) => {
  const current = instance.componentProperties;
  const names = Object.keys(current);
  const where = `instance ${instance.name} (${instance.id})`;
  const update: Record<string, string | boolean> = {};
  for (const [requested, value] of Object.entries(props)) {
    const name = resolvePropertyName(names, requested, where);
    update[name] = await coerceValue(current[name].type, value, name);
  }
  if (Object.keys(update).length) instance.setProperties(update);
};

const describeInstance = async (instance: InstanceNode) => {
  const main = await instance.getMainComponentAsync();
  return {
    nodeId: instance.id,
    nodeName: instance.name,
    parentId: instance.parent?.id,
    mainComponentId: main?.id,
    mainComponentName: main?.name,
    componentProperties: Object.fromEntries(
      Object.entries(instance.componentProperties).map(([n, p]) => [n, p.value])
    ),
  };
};

async function createInstance(params: Params) {
  const component = await resolveComponent(params, params.variant);
  const instance = component.createInstance();
  try {
    if (typeof params.name === "string") instance.name = params.name;
    await placeNode(instance, params);
    if (params.properties && typeof params.properties === "object") {
      await applyInstanceProperties(instance, params.properties as Record<string, unknown>);
    }
  } catch (err) {
    instance.remove();
    throw err;
  }
  return {
    ...(await describeInstance(instance)),
    x: instance.x,
    y: instance.y,
    width: instance.width,
    height: instance.height,
  };
}

async function setInstanceProperties(nodeIds: string[], params: Params) {
  const props = (params.properties ?? {}) as Record<string, unknown>;
  if (Object.keys(props).length === 0) throw new Error("properties must not be empty");
  const instances = await Promise.all(nodeIds.map(asInstance));
  const results = [];
  for (const instance of instances) {
    await applyInstanceProperties(instance, props);
    results.push(await describeInstance(instance));
  }
  return results.length === 1 ? results[0] : { updatedCount: results.length, results };
}

async function swapInstance(nodeIds: string[], params: Params) {
  const component = await resolveComponent(params, params.variant);
  const preserve = params.preserveOverrides !== false;
  const results = [];
  for (const id of nodeIds) {
    const instance = await asInstance(id);
    if (preserve) instance.swapComponent(component);
    else instance.mainComponent = component;
    results.push(await describeInstance(instance));
  }
  return results.length === 1 ? results[0] : { updatedCount: results.length, results };
}

async function detachInstances(nodeIds: string[]) {
  const results = [];
  for (const id of nodeIds) {
    const instance = await asInstance(id);
    const frame = instance.detachInstance();
    results.push({ fromInstanceId: id, nodeId: frame.id, nodeName: frame.name, type: frame.type });
  }
  return { detachedCount: results.length, results };
}

async function resetInstanceOverrides(nodeIds: string[]) {
  const results = [];
  for (const id of nodeIds) {
    const instance = await asInstance(id);
    const before = instance.overrides.length;
    if (typeof instance.removeOverrides === "function") instance.removeOverrides();
    else instance.resetOverrides();
    results.push({ nodeId: id, nodeName: instance.name, clearedOverrideEntries: before });
  }
  return { resetCount: results.length, results };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const requireIds = (type: string, nodeIds?: string[]): string[] => {
  if (!nodeIds || nodeIds.length === 0) throw new Error(`nodeIds is required for ${type}`);
  return nodeIds;
};

export async function handleComponentRequest(
  type: ComponentRequestType,
  nodeIds: string[] | undefined,
  params: Params = {}
): Promise<unknown> {
  if (figma.editorType === "figjam") {
    throw new Error(`${type} is not available in FigJam (FigJam has no components)`);
  }
  switch (type) {
    case "get_components":
      return getComponents(params);
    case "get_component_info":
      return getComponentInfo(requireIds(type, nodeIds)[0], params);
    case "create_component":
      return createComponent(params);
    case "combine_as_variants":
      return combineAsVariants(requireIds(type, nodeIds), params);
    case "edit_component":
      return editComponent(requireIds(type, nodeIds)[0], params);
    case "bind_component_property":
      return bindComponentProperty(requireIds(type, nodeIds), params);
    case "create_instance":
      return createInstance(params);
    case "set_instance_properties":
      return setInstanceProperties(requireIds(type, nodeIds), params);
    case "swap_instance":
      return swapInstance(requireIds(type, nodeIds), params);
    case "detach_instances":
      return detachInstances(requireIds(type, nodeIds));
    case "reset_instance_overrides":
      return resetInstanceOverrides(requireIds(type, nodeIds));
  }
}
