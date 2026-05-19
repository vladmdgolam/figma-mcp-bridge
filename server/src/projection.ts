// Field projection for serialized Figma nodes.
//
// `fields` is a list of dot-paths the caller wants to keep, e.g.
//   ["bounds", "styles.fills", "styles.effects", "children.styles.fills"]
//
// Anchor fields (id, name, type) are always preserved on every object so
// the result is still a navigable Figma tree. Arrays of plain objects
// (e.g. `children`, `segments`, `fills`) propagate the remaining path
// segments into each element.

const ANCHOR_FIELDS = ["id", "name", "type"] as const;

type Projection = {
  // Plain keys to keep on the current object (always shallow-copied).
  keys: Set<string>;
  // Nested projections to apply when descending into `key`. When a child
  // value is an array, the same projection is applied to each element.
  nested: Map<string, Projection>;
};

function emptyProjection(): Projection {
  return { keys: new Set(), nested: new Map() };
}

function addPath(proj: Projection, segments: readonly string[]): void {
  if (segments.length === 0) return;
  const [head, ...rest] = segments;
  proj.keys.add(head);
  if (rest.length === 0) return;
  let child = proj.nested.get(head);
  if (!child) {
    child = emptyProjection();
    proj.nested.set(head, child);
  }
  addPath(child, rest);
}

function compileProjection(fields: readonly string[]): Projection {
  const proj = emptyProjection();
  for (const field of fields) {
    const segments = field
      .split(".")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (segments.length > 0) addPath(proj, segments);
  }
  return proj;
}

function applyProjection(value: unknown, proj: Projection): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => applyProjection(item, proj));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  const obj = value as Record<string, unknown>;
  for (const anchor of ANCHOR_FIELDS) {
    if (anchor in obj) out[anchor] = obj[anchor];
  }
  for (const key of proj.keys) {
    if (!(key in obj)) continue;
    const childProj = proj.nested.get(key);
    if (childProj && childProj.keys.size > 0) {
      out[key] = applyProjection(obj[key], childProj);
    } else {
      out[key] = obj[key];
    }
  }
  return out;
}

export function projectFields(
  data: unknown,
  fields: readonly string[] | undefined
): unknown {
  if (!fields || fields.length === 0) return data;
  const proj = compileProjection(fields);
  if (proj.keys.size === 0) return data;
  return applyProjection(data, proj);
}
