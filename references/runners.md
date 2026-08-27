# Runner profiles

## `local-files`

No design provider. Inputs and outputs remain local. HTML/React/CSS/SVG are the
editable design source; local screenshots are visual truth. Use Storybook for
components, Mermaid or SVG for diagrams, self-contained HTML or `.excalidraw` for
whiteboards, Marp Markdown or HTML for slides, and CSS/Motion for animation.

Requirements: no cloud, no provider desktop app.

## `figma-remote`

Uses Figma's hosted MCP endpoint and official Figma skills. It requires Figma Cloud.
The adapter maps known Figma tools but agents must use the current connected tool
catalog because Figma changes its beta tools.

The upstream `figma/mcp-server-guide` repository has no declared license. This skill
therefore links to and delegates to official Figma skills rather than copying them.

Official sources:

- <https://github.com/figma/mcp-server-guide>
- <https://developers.figma.com/docs/figma-mcp-server/>

## `penpot-local`

Self-host Penpot and run its MCP locally. Penpot's current local MCP exposes
`execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape`, and
`import_image`; many design operations compose through `execute_code`.

Penpot operates on the currently focused browser page. File creation is not assumed
unless the connected tool catalog explicitly exposes it. Whiteboard, slides, and
motion are emulations, not native feature claims.

Official sources:

- <https://penpot.app/self-host>
- <https://help.penpot.app/mcp/>
- <https://github.com/penpot/penpot/tree/develop/mcp>

## `ardot-remote`

Tencent Design Ardot Remote MCP uses `https://ardot.tencent.com/mcp`, OAuth, Ardot
Cloud, and no Ardot GUI. Official docs state public-beta limits of 600 calls/day and
20/minute; pricing may change after beta.

Live verification on 2026-08-27 used MCP server 1.0.13-77dcb896 through the Pi
`design-mcp` extension. It discovered 25 tools, created a new design file, applied 20
design variables, created a 1440×1024 SaaS dashboard through structured batch edits,
ran layout checks, and captured two visual QA screenshots. Core mappings are:

- create: `create_design`
- inspect: `fetch_file_info`, `fetch_editor_state`, `batch_read`, `capture_layout`
- write: `locate_available_space`, then `batch_edit`
- visual validation: `capture_screenshot`
- tokens: `fetch_variables`, `export_variables`, `apply_variables`
- components: `fetch_component_lib`, then `batch_edit`
- assets: `register_assets`, `upload_images`, `scan_exportable_resources`,
  `export_nodes`, `html_to_ardot`

No native Code Connect, motion, or FigJam tool appeared. Component maps remain local;
diagrams, whiteboards, and slides are explicit canvas emulations. Tool names must
still be discovered at connection time because Tencent updates the remote catalog.

Official sources:

- <https://docs.ardot.tencent.com/en/ardot-mcp/remote-mcp.html>
- <https://docs.ardot.tencent.com/en/ardot-mcp/permissions-billing.html>

## `ardot-desktop`

Tencent Design Ardot Desktop MCP normally listens at
`http://127.0.0.1:50501/api/v1/mcp`; the port may change when occupied. It requires
a proprietary desktop app and first online login, so a no-desktop policy blocks it.
Desktop MCP itself has no separate billing.

Live verification on 2026-08-27 used Ardot 2.13.5 and MCP server
1.0.11-68125c91. The server exposed 21 tools. Core mappings are:

- inspect: `fetch_file_info`, `fetch_editor_state`, `batch_read`, `capture_layout`
- write: `locate_available_space`, then `batch_edit`
- visual validation: `capture_screenshot`
- tokens: `fetch_variables`, `export_variables`, `apply_variables`
- components: `fetch_component_lib`, then `batch_edit`
- assets: `register_assets`, `upload_images`, `scan_exportable_resources`,
  `export_nodes`

The test created seven structured nodes, read them back, reported zero layout
problems, and saved a screenshot. No native file-creation, Code Connect, motion, or
FigJam tool appeared. Whiteboards, diagrams, and slides are therefore explicit
canvas emulations. File creation remains an Ardot UI step.

The verified file was a new cloud-backed personal draft. This proves local MCP
transport, not fully offline document storage. Ardot documentation mentions local
file support, but that mode was not exposed or proven by this MCP catalog.

Official sources:

- <https://docs.ardot.tencent.com/en/ardot-mcp/desktop-mcp.html>
- <https://docs.ardot.tencent.com/en/ardot-client/introduction.html>
- <https://docs.ardot.tencent.com/en/ardot-client/installation.html>
