# Pi Design MCP

Pi extension that connects design MCP servers directly to the agent and dynamically
registers provider tools. No design GUI is needed for remote profiles.

## Ardot without Ardot GUI

Select the remote runner:

```bash
python3 ~/.agents/skills/design-runner/scripts/runner.py use ardot-remote \
  --project . --cloud allow --desktop deny --design-writes allow
```

Reload Pi once after installing the extension:

```text
/reload
```

Then use either the command:

```text
/design-mcp connect ardot-remote
```

or let the agent call `design_mcp_connect`. First connection opens a browser for
OAuth approval. Later sessions refresh saved credentials automatically.

After connection:

1. `design_mcp_list` inspects the remote catalog.
2. `design_mcp_load` dynamically registers only tools needed for the task.
3. Loaded tools use the `ardot_remote_*` prefix.
4. `design_mcp_call` remains a generic fallback.

## Security

- Ardot Remote is GUI-free but uses Ardot Cloud.
- OAuth credentials are stored at
  `~/.pi/agent/state/design-mcp/ardot-remote.oauth.json` with mode `0600`.
- Tool calls obey the nearest `.design-runner.json` policy.
- Unknown tools default to write-capable and require `allowDesignWrites: true`.
- `/design-mcp logout` removes stored OAuth credentials.
- Tool output is capped at 50 KB or 2,000 lines; full overflow output is written
  privately under `/tmp/pi-design-mcp/`.

## Checks

```bash
node ~/.local/node/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-cli.mjs \
  ~/.pi/agent/extensions/design-mcp/tests/core.test.ts

pi --no-extensions -e ~/.pi/agent/extensions/design-mcp/index.ts \
  --list-models unlikely-no-match-xyz
```
