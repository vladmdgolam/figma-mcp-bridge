# Figma MCP Bridge

> **Fork** of [gethopp/figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge), kept in sync with upstream and adding agent-context ergonomics: field projection, disk-by-default screenshots, tree search, and image-fill export. See [What this fork adds](#what-this-fork-adds). Original work © GETHOPP LTD, MIT.
>
> npm: [`@vladik.xyz/figma-mcp-bridge`](https://www.npmjs.com/package/@vladik.xyz/figma-mcp-bridge)

- [Demo](#demo)
- [Quick Start](#quick-start)
- [What this fork adds](#what-this-fork-adds)
- [Available Tools](#available-tools)
- [Local development](#local-development)
- [Structure](#structure)
- [How it works](#how-it-works)

<br/>

<img src="https://raw.githubusercontent.com/vladmdgolam/figma-mcp-bridge/main/logo.png" alt="Figma MCP Bridge" align="center" />

<br/>

> [!NOTE]  
> Requires the Figma desktop app (macOS/Windows). The browser version of Figma does not support importing development plugins.

While other amazing Figma MCP servers like [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP/) exist, one issues is the [API limiting](https://github.com/GLips/Figma-Context-MCP/issues/258) for free users.

The limit for free accounts is 6 requests per month, yes **per month**.

Figma MCP Bridge is a solution to this problem. It is a plugin + MCP server that streams live Figma document data to AI tools without hitting Figma API rate limits, so its Figma MCP for the rest of us ✊

It supports **multiple Figma files connected simultaneously**; open the plugin in each file and your AI agent can query any of them by `fileKey`. Single-file setups work exactly as before with no changes required.

It also includes a small, opt-in set of **write tools** for safe agent-driven edits — see [Editing Notes](#editing-notes) below.

## Demo

[Watch a demo of building a UI in Cursor with Figma MCP Bridge](https://youtu.be/ouygIhFBx0g)

[![Watch the video](https://img.youtube.com/vi/ouygIhFBx0g/maxresdefault.jpg)](https://youtu.be/ouygIhFBx0g)

## Quick Start

### 1. Add the MCP server to your favourite AI tool

Add the following to your AI tool's MCP configuration (e.g. Cursor, Windsurf, Claude Desktop):

```json
{
  "figma-bridge": {
    "command": "npx",
    "args": ["-y", "@vladik.xyz/figma-mcp-bridge"]
  }
}
```

That's it — no binaries to download or install.

### 2. Add the Figma plugin

This fork doesn't publish plugin releases — build it from source (it takes a few seconds):

```bash
git clone git@github.com:vladmdgolam/figma-mcp-bridge.git
cd figma-mcp-bridge/plugin
bun install && bun run build
```

Then in Figma go to `Plugins > Development > Import plugin from manifest` and select `manifest.json` from the `plugin/` folder. The same plugin runs in Figma design files, Dev Mode (read-only), and FigJam boards.

### 3. Start using it 🎉

Open a Figma file, run the plugin, and start prompting your AI tool. The MCP server will automatically connect to the plugin.

To work across multiple files, just open the plugin in each Figma file. The bridge keeps all connections active and your AI agent can target any of them by `fileKey`.

If you want to know more about how it works, read the [How it works](#how-it-works) section.

## What this fork adds

Everything upstream does, plus a set of changes aimed at keeping an agent's context small and its workflows atomic:

- **`get_node({ fields })` — server-side projection.** Pass dot-paths like `['bounds', 'styles.fills', 'children.styles.fills']`; the server prunes everything else, recursing into arrays and always keeping `id`/`name`/`type`. Takes ~300 KB node payloads down to ~5 KB.
- **`depth` is honored everywhere, and truncation happens during serialization.** `get_node`'s `depth` was previously accepted and ignored, so every call returned the whole subtree no matter what the description promised; `get_design_context` serialized the full tree and then threw the excess away. Both now stop at the limit, and `get_document`/`get_selection` default to depth 2 instead of unbounded. Truncated levels carry `childCount` and `truncated: true`.
- **Node IDs accept the hyphen form.** `4029-12345` (what Figma URLs and exported filenames use) is normalised to `4029:12345` instead of failing a regex check.
- **`find_nodes` tolerates inline regex flags.** A leading `(?i)` — Python syntax that JavaScript rejects as an invalid group — is lifted onto the RegExp flags.
- **A stale `fileKey` falls back to the only connected file.** Local files get an `unsaved-*` key that changes on every reopen; with one file connected there is nothing to disambiguate.
- **`FIGMA_BRIDGE_OUTPUT_ROOT` pins the write root.** Written files are otherwise confined to the server's cwd, which belongs to whichever client started the bridge — with two editors open, one project's session ends up enforcing another project's directory.
- **`get_screenshot` writes to disk by default.** Returns `{path, width, height, format, scale}` rather than a base64 blob that swamps the transcript. `inline: true` restores the old behavior; `outputPath` picks the destination.
- **`get_screenshot({ isolate: true })`.** Hides every sibling of each target before exporting and restores them in a `finally` — safe even if the export throws. One call instead of a manual hide/export/restore loop.
- **`find_nodes`.** Locate nodes by name substring, regex, and/or type without serializing subtrees. Hidden subtrees are skipped unless `includeHidden`.
- **`get_node_by_path`.** Address a node by a readable chain of names (`'Hero/Card/Title'`) instead of an ID that a file revision can invalidate.
- **`image_fill_export`.** Turn an `imageHash` from a serialized IMAGE paint into real PNG bytes — previously `get_node` returned hashes an agent couldn't do anything with.
- **`save_children_json`.** Write each direct visible child of a parent to its own JSON file in a single call.

The plugin UI is also de-branded and collapsed to a single line (connection dot + selection count).

## Available Tools

🔱 marks tools and behaviors added by this fork.

| Tool | Description |
|------|-------------|
| `list_files` | List all connected Figma files (supports multi-file workflows) |
| `get_document` | Get the current Figma page tree. 🔱 Depth-limited (default 2); deeper nodes come back as `{id,name,type}` stubs with a `childCount` |
| `get_selection` | Get the currently selected nodes in Figma. 🔱 Depth-limited (default 2), same stub behavior as `get_document` |
| `get_node` | Get a specific Figma node by ID (colon format, e.g. `4029:12345`). Pass `fields` to project only the paths you need — see [fork additions](#what-this-fork-adds) |
| `get_layout_tree` | Read absolute transforms and layout bounds for every node under a capture root |
| `get_prototype_connections` | Read prototype interactions on a node and its descendants |
| `trace_prototype_flow` | Trace prototype navigation between screens |
| `find_nodes` | 🔱 Search the tree by name substring, regex, and/or node type; returns lightweight rows |
| `get_node_by_path` | 🔱 Resolve a slash-separated chain of child names (`'Hero/Card/Title'`) to a node |
| `get_styles` | Get all local paint, text, effect, and grid styles |
| `get_metadata` | Get file name, pages, and current page info |
| `get_design_context` | Selection if there is one, else the current page, depth-limited (default 2). The right first call in a design-to-code task |
| `get_variable_defs` | Get all variable collections, modes, and values (design tokens) |
| `get_screenshot` | Export nodes as PNG/SVG/JPG/PDF/WEBP. 🔱 Writes to a temp file and returns the path by default (pass `inline: true` for base64); 🔱 `isolate: true` hides siblings for a clean capture; 🔱 WEBP is re-encoded server-side from a PNG export (needs `cwebp` on PATH) |
| `save_screenshots` | Export and save screenshots directly to the local filesystem |
| `image_fill_export` | 🔱 Resolve an `imageHash` from an IMAGE paint to the actual PNG bytes |
| `save_children_json` | 🔱 Serialize every direct visible child of a parent to its own JSON file |
| `get_motion_styles` | List all available animation presets (beta) |
| `get_node_motion` | Read a node's current animation styles and properties (beta) |
| `apply_animation_style` | Apply a preset animation style to a node (beta) |
| `remove_animation_style` | Remove an applied animation style from a node (beta) |
| `apply_manual_keyframe_track` | Apply a manual keyframe track to a node property (beta) |
| `remove_manual_keyframe_track` | Remove a manual keyframe track from a node property (beta) |
| `set_timeline_duration` | Set the duration of a timeline in seconds (beta) |
| `set_node_visibility` | Show or hide specific nodes |
| `set_text_content` | Replace the contents of a text node (TEXT, FigJam sticky, or shape label) |
| `set_text_properties` | Patch font, size, alignment, auto-resize, color, and bounds on text nodes/sublayers |
| `set_node_properties` | Patch common node properties: name, position, size, visibility, opacity, corner radius (single or batch) |
| `set_solid_fill` | Replace a node's fill or stroke with a single solid paint |
| `set_gradient_fill` | Replace a node's fill or stroke with a linear/radial/angular/diamond gradient |
| `set_effects` | Replace a node's effects list (drop/inner shadows, layer/background blurs) |
| `set_stroke_properties` | Patch stroke weight, align, dash pattern, cap, and join |
| `set_auto_layout` | Configure auto-layout direction, padding, gap, alignment, sizing, and wrap (not sections) |
| `create_page` | Create a new page in the document, optionally switching to it |
| `create_frame` | Create a new frame, optionally under a parent |
| `create_section` | Create a section — a named, resizable container (Figma and FigJam) |
| `create_text` | Create a new text node |
| `create_shape` | Create a rectangle, ellipse, or line |
| `create_shape_with_text` | Create a FigJam shape with its own text label (SHAPE_WITH_TEXT), incl. text fill |
| `create_image` | Create an image-backed rectangle from a local path, URL, or data URI |
| `create_svg` | Import raw SVG markup or a workspace-local SVG file as editable vector layers |
| `create_sticky` | Create a sticky note in FigJam |
| `create_connector` | Create a connector between two nodes in FigJam, with attachment anchors |
| `import_html_layers` | Bulk-import an html-figma layer tree (JSON) as frames, text, rectangles, and vectors |
| `duplicate_nodes` | Duplicate nodes in place |
| `duplicate_with_offset` | Duplicate nodes and move each duplicate by a fixed offset |
| `fit_to_content` | Resize a SECTION around its children with optional padding |
| `distribute_horizontally` | Space 3+ nodes with equal horizontal gaps (first/last stay fixed) |
| `distribute_vertically` | Space 3+ nodes with equal vertical gaps (first/last stay fixed) |
| `align_to_grid` | Snap node positions to a grid of the given size |
| `place_below` | Move a node below another with gap and start/center alignment |
| `place_right_of` | Move a node to the right of another with gap and start/center alignment |
| `reparent_nodes` | Move nodes into another parent |
| `group_nodes` | Wrap a list of nodes (sharing a parent) in a new group |
| `ungroup_node` | Ungroup a group or frame — children move up to its parent |
| `set_selection` | Set the page selection to a list of node IDs (works in Dev Mode) |
| `scroll_and_zoom_into_view` | Frame the viewport around the given nodes (works in Dev Mode) |
| `delete_nodes` | Delete nodes with explicit confirmation |
| `get_css` | Figma's Dev Mode CSS for nodes as a property→value map |
| `get_components` | List local components / component sets (page or document) with keys and property summaries |
| `get_component_info` | Property definitions, variants, bound layers, instances; for an instance: main component, values, overrides |
| `create_component` | New empty component, or convert existing layers into components in place |
| `combine_as_variants` | Combine components into a component set |
| `edit_component` | Rename/describe, set a variant's values, add/edit/delete component properties (with layer binding) |
| `bind_component_property` | Bind layers to BOOLEAN / TEXT / INSTANCE_SWAP properties; expose nested instances |
| `create_instance` | Insert an instance of a local or library component, picking variant and property values |
| `set_instance_properties` | Set variant / text / boolean / instance-swap values on instances |
| `swap_instance` | Swap instances to another component, keeping or clearing overrides |
| `detach_instances` | Detach instances into frames |
| `reset_instance_overrides` | Clear direct overrides on instances |
| `create_variable_collection` | Create a variable collection with named modes |
| `edit_variable_collection` | Rename a collection; add / rename / remove modes |
| `upsert_variables` | Create or update many variables at once: per-mode values, aliases, scopes, code syntax |
| `delete_variables` | Delete variables or whole collections (with confirmation) |
| `bind_variables` | Bind layer size, spacing, radii, text, fill/stroke colors and effects to variables |
| `set_variable_mode` | Pin a collection mode (e.g. Dark) on layers |
| `create_style` | Create a paint / text / effect / grid style from values or by copying a layer |
| `edit_style` | Change a local style's name, description or values |
| `apply_style` | Link layers to styles by slot (fill, stroke, text, effect, grid) or detach |
| `delete_styles` | Delete local styles (with confirmation) |

All tools accept an optional `fileKey` parameter when multiple Figma files are connected. Use `list_files` to discover connected files and their keys.

### Prototype Notes

- Prototype tools are read-only and unavailable in FigJam. Set `includePrototype: true` on `get_node` to include the same interactions.
- Reactions are Figma's own trigger and action data, with destinations, variables, and modes resolved to names.
- Flow edges list their enclosing branch `conditions` from outermost to innermost (`null` marks an else branch).
- Observed `AFTER_TIMEOUT` values are in seconds (for example, `0.8` for 800 ms).

### Component Notes

- Component tools are unavailable in FigJam. Read tools (`get_components`, `get_component_info`) also work in Dev Mode.
- BOOLEAN / TEXT / INSTANCE_SWAP property names carry a Figma suffix (`Label#12:3`). Every tool accepts the bare name when it's unambiguous.
- Typical flow: `create_component` → build its contents with `create_*` (`parentId` = component id) → `edit_component` `addProperties` with `bindTo` → duplicate it and `combine_as_variants` → `create_instance` / `set_instance_properties`.
- Library components are referenced by `componentKey` and must be published to a library the file can use.

### Variables & Styles Notes

- Collections, modes and variables can be referenced by name (`'Theme'`, `'Dark'`, `'color/bg'`); use `'Collection/name'` when a variable name exists in several collections.
- Variable values: `'#RRGGBB'` / `'#RRGGBBAA'` for colors, numbers, strings, booleans, or `{ alias: 'other/variable' }`.
- `get_node` reports linked style ids and variable bindings under `styles.tokens`; resolve them with `get_styles` / `get_variable_defs`.

### Configuration

| Env var | Effect |
|---|---|
| `FIGMA_BRIDGE_OUTPUT_ROOT` | Directory that `outputPath` / `outputDir` / `create_image` sources must stay inside. Defaults to the MCP server's working directory, which is the cwd of whichever client started the bridge process — set this when several projects share one bridge. |

### Editing Notes

- Edit tools work only when the plugin is opened in Figma's design editor (Dev Mode is read-only — they will return a clear error there).
- In **FigJam**, read tools plus the write tools (`set_text_content`, `set_text_properties`, `set_node_properties`, `set_solid_fill`, `create_text`, `create_shape`, `create_shape_with_text`, `create_sticky`, `create_connector`, `create_section`, `duplicate_nodes`, `duplicate_with_offset`, `fit_to_content`, `distribute_horizontally`, `distribute_vertically`, `align_to_grid`, `place_below`, `place_right_of`, `delete_nodes`, ...) are available. Auto-layout and motion/animation tools return a clear error in FigJam.
- `set_text_content` / `set_text_properties` edit a TEXT node's content directly, or the text sublayer of a FigJam STICKY / SHAPE_WITH_TEXT node. Alignment and auto-resize are TEXT-node-only — they return a clear error on stickies and shapes (x/y/width/height still apply to the containing node).
- `set_node_properties` accepts either `nodeId` or a `nodeIds` array to apply the same property changes to several nodes in one call.
- `set_auto_layout` targets frames; SECTION nodes have no auto-layout in Figma's API and return an explicit error.
- `fit_to_content` works on SECTION nodes only (Figma's API exposes no equivalent for other containers): it shifts children so their bounding box starts at `padding` and resizes the section to bbox + 2×padding.
- The current user must have permission to edit the target file.
- `delete_nodes` is intentionally gated behind `confirm: true`.
- Text edits automatically load the fonts currently used by the target text node before applying the new content.
- New text nodes default to `Inter Regular` unless a font is provided.
- `create_image` reads local paths relative to the MCP server working directory unless you pass an absolute path.
- `create_svg` accepts raw `<svg>` markup or a local SVG path inside the MCP server working directory. SVG payloads are limited to 2 MiB.
- `import_html_layers` takes a JSON file produced by [html-figma](https://github.com/sergcen/html-to-figma)'s browser `htmlToFigma()`. The path resolves relative to the MCP server working directory and must stay inside it, even when absolute. Everything lands inside one wrapper frame, and the response reports `layerCount` against `expectedLayerCount` so partial imports are visible.
- `create_page` returns the new page's ID — pass it as `parentId` to `create_frame` / `create_text` / `create_shape` / `create_image` to author content on that page without switching the editor.

### What You Can Build

With the current write surface, an agent can build a basic slide deck in a new empty Figma file: create slide frames, style titles and body copy, lay out rectangles/ellipses/lines for cards and dividers, duplicate slide templates, reparent content into the right frame, and adjust common geometry/visual properties — including solid/gradient paints, shadows and blurs, stroke geometry, and auto-layout configuration.

The current version is intentionally limited — no components/instances, no variables/styles authoring, no per-segment text styling, and no vector boolean operations yet.

## Local development

This repo uses [Bun](https://bun.sh) as its package manager and script runner throughout. Install it first if you don't have it.

#### 1. Clone this repository locally

```bash
git clone git@github.com:vladmdgolam/figma-mcp-bridge.git
```

#### 2. Install root tooling

Install the root dependencies once. This runs Husky's `prepare` script, which installs the Git pre-commit hook that formats staged files with Prettier.

```bash
cd figma-mcp-bridge && bun install
```

#### 3. Build the server

```bash
cd server && bun install && bun run build
```

#### 4. Build the plugin

```bash
cd plugin && bun install && bun run build
```

#### 5. Add the MCP server to your favourite AI tool

For local development, add the following to your AI tool's MCP config:

```json
{
  "figma-bridge": {
    "command": "node",
    "args": ["/path/to/figma-mcp-bridge/server/dist/index.js"]
  }
}
```

### Code style

The repo is formatted with [Prettier](https://prettier.io) (config in `.prettierrc`). A Husky pre-commit hook runs `lint-staged`, which formats only your staged files, so commits stay formatted automatically. You can also run it manually:

```bash
bun run format        # format the whole repo
bun run format:check  # verify formatting without writing (useful in CI)
```

## Structure

```
Figma-MCP-Bridge/
├── plugin/   # Figma plugin (TypeScript/React)
└── server/   # MCP server (TypeScript/Node.js)
    └── src/
        ├── index.ts      # Entry point
        ├── bridge.ts     # WebSocket bridge to Figma plugin
        ├── leader.ts     # Leader: HTTP server + bridge
        ├── follower.ts   # Follower: proxies to leader via HTTP
        ├── node.ts       # Dynamic leader/follower role switching
        ├── election.ts   # Leader election & health monitoring
        ├── tools.ts      # MCP tool definitions
        └── types.ts      # Shared types
```

## How it works

There are two main components to the Figma MCP Bridge:

### 1. The Figma Plugin

The Figma plugin is the user interface for the Figma MCP Bridge. You run this inside the Figma file you want to use the MCP server for, and its responsible for getting you all the information you need.

### 2. The MCP Server

The MCP server is the core of the Figma MCP Bridge. It maintains a registry of WebSocket connections keyed by `fileKey`, so multiple Figma files can be connected simultaneously. The server is responsible for:

- Handling WebSocket connections from one or more Figma plugin instances
- Routing tool calls to the correct file based on `fileKey`
- Forwarding responses back to the AI client
- Handling leader election (as we can have only one WS connection to an MCP server at a time)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FIGMA (Desktop app)                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Figma Plugin                                  │  │
│  │                    (TypeScript/React)                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket
                                      │ (ws://localhost:1994/ws)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRIMARY MCP SERVER                                 │
│                         (Leader on :1994)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Bridge                                    Endpoints:               │    │
│  │  • Manages WebSocket conn                  • /ws    (plugin)        │    │
│  │  • Forwards requests to plugin             • /ping  (health)        │    │
│  │  • Routes responses back                   • /rpc   (followers)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                           ▲                              ▲
                           │ HTTP /rpc                    │ HTTP /rpc
                           │ POST requests                │ POST requests
                           │                              │
         ┌─────────────────┴───────────┐    ┌─────────────┴───────────────┐
         │    FOLLOWER MCP SERVER 1    │    │    FOLLOWER MCP SERVER 2    │
         │                             │    │                             │
         │  • Pings leader /ping       │    │  • Pings leader /ping       │
         │  • Forwards tool calls      │    │  • Forwards tool calls      │
         │    via HTTP /rpc            │    │    via HTTP /rpc            │
         │  • If leader dies →         │    │  • If leader dies →         │
         │    attempts takeover        │    │    attempts takeover        │
         └─────────────────────────────┘    └─────────────────────────────┘
                    ▲                                      ▲
                    │                                      │
                    │ MCP Protocol                         │ MCP Protocol
                    │ (stdio)                              │ (stdio)
                    ▼                                      ▼
         ┌─────────────────────────────┐    ┌─────────────────────────────┐
         │      AI Tool / IDE 1        │    │      AI Tool / IDE 2        │
         │      (e.g., Cursor)         │    │      (e.g., Cursor)         │
         └─────────────────────────────┘    └─────────────────────────────┘
```
