---
name: design-runner
description: >
  Route Figma-grade design workflows through a replaceable design provider using
  $DESIGN_RUNNER capabilities. Use whenever a task should switch among Figma,
  self-hosted Penpot, Tencent Design Ardot, or local files without rewriting the
  workflow. Covers canvas work, design-to-code, design systems, component mapping,
  diagrams, whiteboards, slides, motion, SwiftUI, project plans, video storyboards,
  and single-page product flows that tile screens and connect navigation with arrows.
---

# Design Runner

Preserve workflow quality. Swap provider.

`$DESIGN_RUNNER` selects a runner profile. Names such as
`$DESIGN_RUNNER_DOCUMENT_INSPECT` are abstract capabilities, not literal MCP tool
names. Resolve them before any provider call.

## Start here

1. Find the nearest `.design-runner.json`; if none exists, use `local-files` with
   cloud, desktop apps, and design writes denied.
2. Resolve the requested workflow:

   ```bash
   python3 ~/.agents/skills/design-runner/scripts/runner.py resolve <workflow>
   ```

3. Read `references/workflows.md` for that workflow and
   `references/runners.md` for the selected provider.
4. If the selected runner is MCP-backed, call `design_mcp_connect`, then
   `design_mcp_load` with the needed capability or exact tool name. Use only the
   dynamically loaded provider tools.
5. Never silently fall back to another provider.
6. Run the quality loop below and leave a local verification artifact.

## Quality loop

1. Inspect source structure before editing.
2. Inventory existing tokens, components, assets, and naming conventions.
3. Reuse existing primitives before creating new ones.
4. Make the smallest coherent change, in sections for large work.
5. Render or capture the result after each meaningful batch.
6. Compare structure and pixels against the source or brief; fix clipping,
   overlap, missing states, inaccessible contrast, and wrong assets.
7. Verify final output in its real target: local browser, design provider,
   exported asset, slide deck, or application runtime.

For existing multi-screen mocks that must become one canvas, resolve
`unified-product-flow` and follow its exact consolidation sequence in
`references/workflows.md`.

## Safety

- Treat `.design-runner.json` policy as a hard boundary.
- A runner requiring cloud or a desktop app is blocked unless explicitly allowed.
- Any operation marked `writesDesign` is blocked unless `allowDesignWrites` is true.
- Missing capability means stop with the missing capability name. Do not switch to
  Figma, cloud, desktop, or a write tool as a fallback.
- For read-only work, never resolve an optional write capability.
- Before destructive provider operations, describe the exact change and use the
  provider's reversible history or duplicate-file workflow.

## Switching runners

Fully local mode:

```bash
python3 ~/.agents/skills/design-runner/scripts/runner.py use local-files --project ~
```

Self-hosted Penpot, allowing design writes:

```bash
python3 ~/.agents/skills/design-runner/scripts/runner.py use penpot-local \
  --project . --design-writes allow
```

Tencent Ardot Desktop, allowing its desktop app and design writes:

```bash
python3 ~/.agents/skills/design-runner/scripts/runner.py use ardot-desktop \
  --project . --desktop allow --design-writes allow
```

Tencent Ardot Remote, agent-only with no Ardot GUI:

```bash
python3 ~/.agents/skills/design-runner/scripts/runner.py use ardot-remote \
  --project . --cloud allow --desktop deny --design-writes allow
```

Then stay inside Pi:

1. Call `design_mcp_connect` with `profile: "ardot-remote"`.
2. On first use only, complete browser OAuth. Never expose the token in chat.
3. Call `design_mcp_load` with the workflow capability, such as `canvas edit`,
   `screenshot`, `variables`, `components`, or an exact Ardot tool name.
4. Call the loaded `ardot_remote_*` tools. Do not open Ardot Desktop.

Figma Remote:

```bash
python3 ~/.agents/skills/design-runner/scripts/runner.py use figma-remote \
  --project . --cloud allow --design-writes allow
```

Temporary runner override without changing config:

```bash
DESIGN_RUNNER=local-files \
  python3 ~/.agents/skills/design-runner/scripts/runner.py resolve diagram
```

## Provider-specific guidance

- When `figma-remote` is selected, load the matching official Figma skill before
  tool use. This keeps upstream quality without copying its unlicensed text.
- When `ardot-remote` is selected, use the Pi `design-mcp` extension. This is the
  only verified Ardot path that avoids Ardot GUI; it uses Ardot Cloud and one-time
  browser OAuth.
- For Penpot and Ardot, resolve current MCP tools from the connected server. Ardot
  tool names may change; use `design_mcp_load` instead of guessing names.
- Never select `ardot-desktop` when the user requires agent-only or no-GUI operation.
- For `local-files`, combine local image/PDF/SVG inputs with `design-critique`,
  `ui-ux-pro-max`, `frontend-design`, `building-components`, `web-animation-design`,
  `baseline-ui`, and `agent-browser` as relevant.

## References

- `references/contract.md`: capability contract and policy semantics.
- `references/workflows.md`: mapping from Figma skill names to portable workflows.
- `references/runners.md`: runner behavior, setup boundaries, and official sources.
- `workflows.json`: machine-readable workflow requirements.
- `runners/*.json`: machine-readable runner adapters.

## Verification

```bash
python3 ~/.agents/skills/design-runner/scripts/runner.py check
python3 -m unittest discover \
  ~/.agents/skills/design-runner/tests -p 'test_*.py'
```
