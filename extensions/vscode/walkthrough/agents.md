## Let AI agents write it

Coding agents get the same live schema and dry run as the editor:

| Tool                        | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `conduktor_list_kinds`      | The kinds the connected Console accepts, with versions and parent fields |
| `conduktor_get_kind_schema` | One kind's JSON Schema and its published example                         |
| `conduktor_validate`        | Schema errors with JSON paths, per resource; no Console call             |
| `conduktor_dry_run`         | Created / Updated / NotChanged or the Console's error, per resource      |
| `conduktor_get_resources`   | Existing resources as YAML, with secret values redacted                  |

**Copilot (agent mode):** nothing to set up. The tools are ready as soon as a connection is; mention them with
`#conduktorValidate`, `#conduktorDryRun` and so on. The Console's own MCP server (topics, consumer groups, lineage,
insights) is offered as **Conduktor Console** with the connection's name, in the MCP servers list.

**Claude Code:**

1. Run **Copy MCP Config for Claude Code**.
2. Paste it into the project's `.mcp.json`.
3. `export CONDUKTOR_TOKEN=<personal access token>` before starting `claude`.

Then try: _"Using the Conduktor tools, write topics.yaml with an `orders` topic on local-kafka: 6 partitions, 7 days
retention. Validate and dry-run it."_

Agents never change the Console: they write YAML and dry-run it, and you apply it. They read only files inside the
workspace, and never see a secret.
