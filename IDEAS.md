# Bridge ideas backlog

Punch list of improvements not yet shipped. Reference for next sessions.
Captured 2026-05-19 from an audit of agent-context bloat + workflow
friction. Items already shipped are omitted.

## High-leverage new tools

- **`get_node_hash` / `diff_node`** — return a node's `lastModified` (or
  content hash of its serialized tree). Lets refresh scripts skip
  unchanged frames cheaply. Closes the "stale-refs" hazard where a
  downstream consumer caches node IDs that a file revision reshuffles.
- **Batch `set_properties`** — one WebSocket call carrying multiple
  `{nodeId, props}` entries instead of N. Today tuning 8 frames is 24+
  calls. Touches every `set_*` tool — design a unified dispatch.
- **Eyedropper / 1px sampler** — `exportAsync` with a tiny region at
  `(nodeId, x, y)` to recover the rendered color at a pixel. Workaround
  for Figma's lack of a plugin-API color picker.

## Payload-shape improvements

- **Default depth=2 on `get_document` / `get_selection`.** Currently
  unlimited; matches `get_design_context`'s sane default. Unlimited
  becomes opt-in.
- **Filtering on `get_styles` / `get_variable_defs`.** Add `type` /
  name-regex / pagination. Today both return every style or every
  variable in the file.
- **`save_node_json` minified by default.** Currently
  `JSON.stringify(_, null, 2)` ~doubles file size; expose `pretty: true`
  as opt-in.
- **Stop silently dropping `visible:false` children in
  `serializeNode`.** Surprises agents debugging hidden masks. Either
  include stubs `{id,name,type,styles:{visible:false}}` or document
  loudly. `find_nodes` already exposes them via `includeHidden`.

## Discoverability + error-quality

- **Auto-convert hyphenated node IDs** (`44-2057` → `44:2057`)
  server-side. The hyphen form leaks in from URL paths and saved
  filenames; today it fails late with a Zod error.
- **Rewrite `get_design_context` description.** Currently
  "summarized tree structure optimized for understanding the current
  design context" — say what it actually does: selection if present
  else current page, depth=2.
- **Surface `depth: 999` escape hatch in `get_node` description** —
  default `depth: 0` returns only stubs and agents miss this.
- **README dedupe.** Two `Available Tools` tables (~lines 40–74 and
  121–136); the second is stale (missing every `set_*`, `create_*`,
  `save_node_json`, and the recently added `find_nodes`,
  `get_node_by_path`, `image_fill_export`, `save_children_json`).
  Delete the second copy or generate from `toolInputSchemas`.
- **Typed error for `get_screenshot` on DOCUMENT/PAGE.** Silently
  filters then says "No nodes to export"; better to fail with a typed
  error explaining pages aren't exportable.
- **`create_image` cwd caveat** — when a relative `source` doesn't
  resolve, surface the resolved absolute path in the error so the
  agent can tell whether it's a cwd mismatch.

## Workflow gaps

- **`save_screenshots({ variant })`** — accept a named visibility
  preset that toggles a set of nodes hidden before exporting and
  restores after. Generalizes `isolate` to "blurs-off" / "ui-hidden"
  workflows that consumers script today.
- **`list_saved_extracts`** — returns `(path, nodeId, savedAt,
  figmaLastModified)` for everything `save_node_json` /
  `save_screenshots` has written. Closes the loop with `get_node_hash`
  to detect stale extracts.
- **Surface server cwd in `get_metadata`.** Today `save_*` tools
  reject paths outside `process.cwd()` with no hint of what that cwd
  is. Agents launched from a different cwd than the user's project
  get bewildering errors.

## Cleanup / risks

- **`createImageInput` schema rewrites `source` → `imageBase64` on the
  wire** (`schema.ts:656-658`). Clever, but reading `validateRpc`
  without context is misleading. Add a comment or unify.
- **`save_node_json` + `save_screenshots` write under `process.cwd()`
  only.** Pairs with the `get_metadata` cwd surface above; the
  validation message could also include the resolved root.
- **`EDIT_REQUEST_TYPES` covers writes but is not enforced for
  `save_node_json`'s underlying `get_node`** — confirm and document
  the read-path classification near `code.ts:352`.

## Shipped (for context)

- `get_node` fields projection · `get_screenshot` disk-by-default ·
  `find_nodes` · `get_node_by_path`.
- `get_screenshot({ isolate: true })` · `image_fill_export` ·
  `save_children_json`.
