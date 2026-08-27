# Design Runner contract

## Selection

Resolution order:

1. CLI `--runner`
2. `DESIGN_RUNNER` environment variable
3. nearest `.design-runner.json`
4. safe default `local-files`

`RUNNER` is deliberately not used because it commonly collides with CI variables.

## Policy

```json
{
  "runner": "local-files",
  "policy": {
    "allowCloud": false,
    "allowDesktopApp": false,
    "allowDesignWrites": false
  }
}
```

- `allowCloud`: permits a provider hosted outside the machine.
- `allowDesktopApp`: permits a provider-specific desktop application.
- `allowDesignWrites`: permits mutation of a design document or component map.
  It does not block ordinary writes to the local source tree.

Policies fail closed. Selecting a runner never widens policy automatically.

## Capabilities

| Capability | Symbol | Meaning |
| --- | --- | --- |
| `file.create` | `$DESIGN_RUNNER_FILE_CREATE` | Create a design/document target |
| `document.inspect` | `$DESIGN_RUNNER_DOCUMENT_INSPECT` | Read hierarchy, layout, styles, and context |
| `canvas.execute` | `$DESIGN_RUNNER_CANVAS_EXECUTE` | Create or modify structured design content |
| `render.capture` | `$DESIGN_RUNNER_RENDER_CAPTURE` | Render or capture visual output |
| `asset.import` | `$DESIGN_RUNNER_ASSET_IMPORT` | Bring a local asset into the target |
| `asset.export` | `$DESIGN_RUNNER_ASSET_EXPORT` | Export target assets locally |
| `token.read` | `$DESIGN_RUNNER_TOKEN_READ` | Read variables/design tokens |
| `token.write` | `$DESIGN_RUNNER_TOKEN_WRITE` | Create or change variables/design tokens |
| `component.read` | `$DESIGN_RUNNER_COMPONENT_READ` | Discover components and variants |
| `component.write` | `$DESIGN_RUNNER_COMPONENT_WRITE` | Create or change components and variants |
| `component.map` | `$DESIGN_RUNNER_COMPONENT_MAP` | Link design components to code |
| `diagram.create` | `$DESIGN_RUNNER_DIAGRAM_CREATE` | Create diagrams from structured input |
| `whiteboard.edit` | `$DESIGN_RUNNER_WHITEBOARD_EDIT` | Create/edit freeform planning boards |
| `slides.edit` | `$DESIGN_RUNNER_SLIDES_EDIT` | Create/edit presentation slides |
| `motion.read` | `$DESIGN_RUNNER_MOTION_READ` | Inspect motion and timing |
| `motion.write` | `$DESIGN_RUNNER_MOTION_WRITE` | Author motion and timing |

## Operation kinds

- `tool`: use the first available named tool candidate.
- `discover`: inspect the current MCP tool catalog and match descriptions against
  the supplied keywords. Do not invent a tool name.
- `local`: use local file, code, image, and browser tools.
- `emulated`: provider lacks a native concept; use documented primitives and label
  the result as an emulation.
- `unsupported`: fail and name the missing capability.

## Invariants

1. Workflow files contain only abstract capabilities, never provider tool names.
2. Runner files contain provider details, never workflow sequencing.
3. Switching runners changes only `.design-runner.json` or `DESIGN_RUNNER`.
4. A provider may support fewer capabilities; unsupported work never degrades
   silently.
5. Provider output is validated through `render.capture` when available.
