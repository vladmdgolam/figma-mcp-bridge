# Figma MCP Bridge

- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
- [Export Selection](#export-selection)
- [Style Data](#style-data)
- [Local development](#local-development)
- [Structure](#structure)
- [How it works](#how-it-works)

<br/>

A Figma plugin + MCP server that streams live Figma document data to AI tools without hitting Figma API rate limits. Supports multiple Figma files connected simultaneously, exposes rich style data (fills, strokes, effects, auto-layout, typography, variables) for accurate design-to-code translation, and now includes a practical set of write tools for safe agent-driven edits and basic presentation authoring.

Forked from [gethopp/figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge).

## Quick Start

### 1. Add the MCP server to your AI tool

Add the following to your AI tool's MCP configuration (e.g. Cursor, Windsurf, Claude Desktop, Claude Code):

```json
{
  "figma-bridge": {
    "command": "node",
    "args": ["/path/to/figma-mcp-bridge/server/dist/index.js"]
  }
}
```

### 2. Add the Figma plugin

In Figma go to `Plugins > Development > Import plugin from manifest` and select the `manifest.json` file from the `plugin/` folder.

### 3. Start using it

Open a Figma file, run the plugin, and start prompting your AI tool. The MCP server will automatically connect to the plugin.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_files` | List all connected Figma files (supports multi-file) |
| `get_document` | Get the full page document tree |
| `get_selection` | Get currently selected nodes |
| `get_node` | Get a specific node by ID |
| `get_styles` | Get all local paint, text, effect, and grid styles |
| `get_metadata` | Get file name, pages, and current page info |
| `get_design_context` | Get a depth-limited tree optimized for design context |
| `get_variable_defs` | Get all variable collections, modes, and values (design tokens) |
| `get_screenshot` | Export nodes as PNG/SVG/JPG/PDF (base64) |
| `set_node_visibility` | Show or hide specific nodes |
| `set_text_content` | Replace the contents of a text node |
| `set_text_properties` | Patch font, size, alignment, auto-resize, color, and bounds on a text node |
| `set_node_properties` | Patch common node properties like name, position, size, visibility, opacity, radius, and solid fill |
| `create_frame` | Create a new frame, optionally under a parent |
| `create_text` | Create a new text node |
| `create_shape` | Create a rectangle, ellipse, or line |
| `create_image` | Create an image-backed rectangle from a local path, URL, or data URI |
| `duplicate_nodes` | Duplicate nodes in place |
| `reparent_nodes` | Move nodes into another parent |
| `delete_nodes` | Delete nodes with explicit confirmation |
| `save_screenshots` | Export and save screenshots directly to disk |

All tools accept an optional `fileKey` parameter when multiple Figma files are connected simultaneously.

### Editing Notes

- Edit tools work only while the Figma plugin is open and connected.
- The current user must have permission to edit the target file.
- `delete_nodes` is intentionally gated behind `confirm: true`.
- Text edits automatically load the fonts currently used by the target text node before applying the new content.
- New text nodes default to `Inter Regular` unless a font is provided.
- `create_image` reads local paths relative to the MCP server working directory unless you pass an absolute path.

### What You Can Build

With the current write surface, an agent can build a basic slide deck in a new empty Figma file:

- Create slide frames
- Create and style titles and body text
- Create rectangles, ellipses, and lines for cards, separators, and simple diagrams
- Place images from local files or remote URLs
- Duplicate slide templates
- Reparent content into the right frame or group structure
- Adjust common geometry and visual properties after creation

The current version is still intentionally limited. It does not yet cover components, variables/styles authoring, or advanced auto-layout editing.

## Export Selection

The plugin has an **Export Selection to JSON** button that packages every selected node into a ZIP file containing:

- `{NodeName}.json` — full serialized design tree (bounds, fills, effects, auto-layout, typography, etc.)
- `{NodeName}.png` — 2x raster screenshot

Select frames in Figma, click the button, and get a ZIP download. Useful for extracting reference data without going through the MCP server.

## Style Data

The bridge serializes comprehensive style data for each node:

- **Fills & strokes** — solid colors, linear/radial/angular/diamond gradients, image fills, stroke weight, alignment, dash patterns
- **Effects** — drop shadows, inner shadows, layer/background blur with offset, radius, spread, and color
- **Corner radius** — uniform and per-corner radii, corner smoothing (iOS-style superellipse)
- **Auto-layout** — direction, gap, alignment, sizing mode, wrap, counter-axis spacing
- **Typography** — font family, weight, style, size, line height, letter spacing, decoration, alignment, auto-resize
- **Layout** — opacity, blend mode, visibility, rotation, constraints, clipping, padding
- **Variables** — full variable collections with modes and resolved values (design tokens)

## Available Tools

| Tool | Description |
|------|-------------|
| `list_files` | List all connected Figma files (supports multi-file workflows) |
| `get_document` | Get the current Figma page document tree |
| `get_selection` | Get the currently selected nodes in Figma |
| `get_node` | Get a specific Figma node by ID (colon format, e.g. `4029:12345`) |
| `get_styles` | Get all local paint, text, effect, and grid styles |
| `get_metadata` | Get file name, pages, and current page info |
| `get_design_context` | Get a depth-limited tree optimized for understanding design context |
| `get_variable_defs` | Get all variable collections, modes, and values (design tokens) |
| `get_screenshot` | Export nodes as PNG/SVG/JPG/PDF (base64-encoded) |
| `save_screenshots` | Export and save screenshots directly to the local filesystem |

All tools accept an optional `fileKey` parameter when multiple Figma files are connected. Use `list_files` to discover connected files and their keys.

## Local development

#### 1. Build the server

```bash
cd server && npm install && npm run build
```

#### 2. Build the plugin

```bash
cd plugin && bun install && bun run build
```

#### 3. Add the MCP server to your AI tool

```json
{
  "figma-bridge": {
    "command": "node",
    "args": ["/path/to/figma-mcp-bridge/server/dist/index.js"]
  }
}
```

## Structure

```
figma-mcp-bridge/
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

Two main components:

### 1. The Figma Plugin

Runs inside Figma, connects to the local MCP server via WebSocket, and streams document data on demand. Also provides a direct **Export Selection** button for offline use.

### 2. The MCP Server

Handles WebSocket connections from the plugin and exposes MCP tools to AI clients. Supports leader/follower election so multiple AI tools can connect simultaneously.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FIGMA (Browser)                                │
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
                           │                              │
         ┌─────────────────┴───────────┐    ┌─────────────┴───────────────┐
         │    FOLLOWER MCP SERVER 1    │    │    FOLLOWER MCP SERVER 2    │
         │  • Proxies tool calls       │    │  • Proxies tool calls       │
         │  • Takes over if leader dies│    │  • Takes over if leader dies│
         └─────────────────────────────┘    └─────────────────────────────┘
                    ▲                                      ▲
                    │ MCP Protocol (stdio)                  │ MCP Protocol (stdio)
                    ▼                                      ▼
         ┌─────────────────────────────┐    ┌─────────────────────────────┐
         │      AI Tool / IDE 1        │    │      AI Tool / IDE 2        │
         └─────────────────────────────┘    └─────────────────────────────┘
```
