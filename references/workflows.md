# Portable workflows

Each workflow keeps the useful sequencing of the Figma workflow while replacing
provider names with Design Runner capabilities.

## `canvas`

Aliases: `figma-use`, `figma-use-figjam` when used for generic canvas work.

Inspect document, inventory tokens/components, execute a small batch, capture,
validate, repeat. Never send one unbounded script for a large page.

## `unified-product-flow`

Aliases: `single-page-product-flow`, `one-page-product-flow`,
`screen-flow-canvas`, `prototype-flow-map`.

Use when existing mocks are split across pages but the desired artifact is one
infinite canvas with every screen tiled and navigation shown by arrows.

1. Inventory top-level screen roots and classify them as core navigation,
   contextual detail, builder/dialog, or settings branch states.
2. Reuse one existing page as the destination. Do not create another page when a
   safe destination already exists.
3. Tile original screen roots at unchanged size. Use a consistent grid and leave
   gutters wide enough for labels and connectors.
4. Move roots rather than copying them. Verify all roots reached the destination
   before deleting any source page.
5. Draw arrows for actual implemented routes: core navigation, open/detail plus
   return, and hub branches. Label ambiguous edges. Closed SVG shafts and arrowheads
   are more portable than zero-width stroked paths.
6. Replace abstract interaction-map screens with connectors on the same canvas.
   Arrows document jumps; do not claim native clickability when the provider lacks
   prototype interactions.
7. Delete empty source pages only after structural verification. The final page list
   must contain exactly one page when the user asked for one.
8. Export the full page at a small scale for overview QA, then inspect representative
   screens and every connector at readable scale. Leave the overview as a local
   verification artifact.

Ardot note: `capture_layout` cannot use a page as its root. Read current-page
children with `batch_read`, verify `pageList` with `fetch_editor_state`, and export
the page node with `export_nodes` at scale `0.1`–`0.25`.

## `create-file`

Alias: `figma-create-new-file`.

Create only after content and destination type are known. Verify the returned target
exists before further work.

## `design-to-code`

Aliases: `figma-design-to-code`, `implement-design`, `figma-implement-design`.

Inspect exact node/selection, capture visual reference, read tokens/components,
export real assets, then translate into the project's existing stack. Treat generated
markup as design context, not final project style. Validate in the local runtime.

## `component-map`

Aliases: `figma-code-connect`, `code-connect-components`,
`figma-code-connect-components`.

Discover design components and code components first. Match by semantics and props,
not name alone. Write mappings only after ambiguous matches are resolved. In
`local-files`, Storybook stories and component imports are the mapping source.

## `generate-design`

Alias: `figma-generate-design`.

Discover the target design system first. Build by section using existing tokens and
components. Capture every section before continuing. For `local-files`, the rendered
HTML/application is the design artifact.

## `design-system`

Aliases: `figma-generate-library`, `create-design-system-rules`,
`figma-create-design-system-rules`.

Create foundations before components: tokens, modes/themes, typography, primitives,
components, variants, documentation, validation. Prefer project tokens and existing
components over new hardcoded values.

## `diagram`

Alias: `figma-generate-diagram`.

Choose diagram type before syntax. Keep node IDs stable and labels readable. Validate
that the graph renders and that important edges are not ambiguous. `local-files`
uses Mermaid or a small self-contained SVG/HTML artifact.

## `whiteboard`

Alias: `figma-use-figjam`.

Use sections, concise text blocks, consistent spacing, and explicit connectors.
Preserve reading order. `local-files` uses `.excalidraw`, SVG, or self-contained HTML.

## `slides`

Alias: `figma-use-slides`.

Set narrative and slide grid first. Build in small batches. Validate text clipping,
overlap, bounds, contrast, and consistent type scale. `local-files` uses Marp
Markdown or self-contained HTML.

## `motion-author`

Alias: `figma-use-motion`.

Define states, trigger, duration, easing, and reduced-motion behavior. Prefer
transform/opacity. Capture deterministic start, midpoint, and end states.

## `motion-to-code`

Alias: `figma-implement-motion`.

Read source motion, map easing and timing to real target APIs, then validate in the
runtime. Never invent framework APIs or copy a CSS easing token into an incompatible
platform API.

## `swiftui`

Alias: `figma-swiftui`.

For design-to-code, inspect and capture before generating idiomatic SwiftUI. For
code-to-design, inspect SwiftUI structure and use the selected runner's write
capability only when policy allows it. Prefer native controls over hand-drawn copies.

## `project-plan`

Alias: `generate-project-plan`.

Ground the plan in the PRD and codebase. Build sections, dependencies, milestones,
risks, and decisions. Use a whiteboard when supported; otherwise use Markdown plus
Mermaid or local HTML.

## `video-storyboard`

Alias: `video-interaction-mapper`.

Analyze video locally first. Extract key moments, infer transitions, create an asset
manifest, then build an annotated storyboard. Do not modify a provider document until
local frame selection is stable.
