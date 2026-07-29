# @vladik.xyz/figma-mcp-bridge

MCP server that bridges Figma plugin data to AI tools **without hitting Figma's REST API rate limits**.

> Fork of [gethopp/figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge), tracking upstream and adding agent-context ergonomics (see [What this fork adds](#what-this-fork-adds)). Original work © GETHOPP LTD, MIT.

Figma's REST API allows **6 requests per month** on free accounts. This bridge sidesteps that entirely: a Figma **plugin** reads the document from inside Figma and streams it over a local WebSocket to this MCP server. No REST API, no rate limit, and it sees your live editing state — including unsaved changes.

## Install

```bash
npm i -g @vladik.xyz/figma-mcp-bridge
```

Or point your MCP client straight at it:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "npx",
      "args": ["-y", "@vladik.xyz/figma-mcp-bridge"]
    }
  }
}
```

**The server alone is half the product.** You also need the Figma plugin that talks to it — build it from [the repo](https://github.com/vladmdgolam/figma-mcp-bridge) (`plugin/`) and import the manifest via Figma → Plugins → Development → *Import plugin from manifest*.

## What this fork adds

Beyond upstream's tool set:

- **`get_node({ fields })`** — server-side dot-path projection, e.g. `['bounds', 'styles.fills', 'children.styles.fills']`. Recurses into arrays and always preserves `id`/`name`/`type`. Turns ~300 KB node payloads into ~5 KB, which is the difference between a usable agent context and a blown one.
- **`get_screenshot` writes to disk by default** — returns `{path, width, height, format, scale}` instead of a base64 blob. Pass `inline: true` for the old behavior, or `outputPath` to choose the destination.
- **`get_screenshot({ isolate: true })`** — hides every sibling of each target before exporting and restores them in a `finally` (safe even if the export throws). Captures one layer cleanly without the rest of the frame, atomically, instead of a manual hide/export/restore loop.
- **`find_nodes`** — walk the tree by name substring, regex, and/or node type. Returns lightweight `{id, name, type, bounds}` rows so an agent can locate a node without serializing its subtree.
- **`get_node_by_path`** — resolve a slash-separated chain of child names (`'Hero/Card/Title'`) to a node. Survives file revisions that reshuffle node IDs, unlike cached IDs.
- **`image_fill_export`** — resolve an `imageHash` from a serialized IMAGE paint to real PNG bytes. Closes the gap where `get_node` handed back hashes an agent had no way to fetch.
- **`save_children_json`** — serialize every direct visible child of a parent to its own JSON file in one call.

The plugin UI is also de-branded and shrunk to a single line (connection dot + selection count).

## Tools

Full tool reference, architecture notes and the plugin build steps live in the [repository README](https://github.com/vladmdgolam/figma-mcp-bridge#readme).

## Requirements

Node.js >= 20.

## License

MIT — see [LICENSE.md](./LICENSE.md). Original work © GETHOPP LTD; fork modifications © Vlad Md Golam.
