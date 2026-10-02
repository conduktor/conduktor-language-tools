# Conduktor for VS Code — AI helpers

Status: approved 2026-10-02 · builds on [slice (a)](2026-10-02-slice-a-design.md).

## Intent

Let coding agents author Console resources the way a careful person would: look up what the connected Console
accepts, write the YAML, validate it, dry-run it, and hand it to the person to apply. Agents get the same live
schema and dry run the editor uses, so they stop guessing resource shapes.

## Decisions

| Decision     | Choice                                                                                                                                                                       | Why                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Agents       | VS Code language-model tools (Copilot agent mode) and a bundled stdio MCP server (Claude Code and other MCP clients)                                                         | Two surfaces over one implementation; VS Code tools can read unsaved editor text. |
| Writes       | None. Agents dry-run and write files; the person applies through the existing confirmed paths                                                                                | Agent proposes, human disposes — the same stance as Console's own automation.     |
| Console data | Console's MCP server (`/api/mcp`, 31 read tools) registered with VS Code's MCP provider API                                                                                  | It already answers questions about topics, consumer groups, lineage, insights.    |
| Tokens       | Never written to files: added to the Console MCP definition at start, passed to the stdio server through its environment, `${CONDUKTOR_TOKEN}` placeholders in copied config | Same rule as the rest of the extension.                                           |

Secrets are redacted in every resource an agent reads (passwords, SASL and JAAS configs, tokens, API and access keys,
PEM private keys, and the password or secret query parameters inside connection URLs), as Console's own MCP responses
are, found by field name across all kinds. Only string values are secrets, so a `maxTokens` number stays. Validate and
dry run reject YAML that still holds the redaction placeholder, so applying an agent's YAML can never overwrite a secret.

## Tools

All tools are read-only on the Console and live in `packages/core/src/tools`, with no VS Code or MCP dependency.

| Tool                        | Input                                                  | Output                                                                                                  |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `conduktor_list_kinds`      | —                                                      | Kinds on this Console: versions, group, parent fields, apply order                                      |
| `conduktor_get_kind_schema` | `kind`, `apiVersion?`                                  | The kind's JSON Schema and its published example YAML                                                   |
| `conduktor_validate`        | `yaml` or `path`                                       | Per document: schema errors with JSON paths, or valid. No Console call                                  |
| `conduktor_dry_run`         | `yaml` or `path`                                       | Per document: Created / Updated / NotChanged or the Console's error. Refused on `read-only` connections |
| `conduktor_get_resources`   | `kind`, `name?`, parents (`cluster`, `connectCluster`) | Live resources as YAML                                                                                  |

Tool descriptions carry the workflow (schema before writing, validate and dry-run after, never claim an apply);
the MCP server also sends it as `instructions`.

`path` is relative to the workspace (VS Code) or the server's working directory (MCP). In VS Code an open
document's current text wins over the file on disk.

## Surfaces

- **VS Code:** `contributes.languageModelTools` plus `vscode.lm.registerTool`; the manifest entries are checked
  against the core definitions by a unit test. Context comes from the active session.
- **MCP server:** `packages/mcp`, bundled to `dist/mcp-server.js` in the extension. Environment:
  `CONDUKTOR_URL`, `CONDUKTOR_TOKEN`, `CONDUKTOR_MODE` (default `dry-run`), `CONDUKTOR_NAME`. Loads the Console's
  OpenAPI at start, falling back to the bundled snapshot.
- **Console MCP in VS Code:** `vscode.lm.registerMcpServerDefinitionProvider`, one HTTP server for the active
  connection, token added in `resolveMcpServerDefinition`. Needs VS Code 1.101.
- **Claude Code:** **Conduktor: Copy MCP Config for Claude Code** copies a `.mcp.json` snippet with both servers and
  `${CONDUKTOR_TOKEN}` placeholders.

## Testing

- Core: each tool against the snapshot catalog and a fake client — path-level schema errors, unknown kinds and
  versions, mode refusal, missing parents, `yaml`/`path` handling.
- MCP: the server over an in-memory transport, and the bundled entry point spawned over stdio against a small fake
  Console.
- VS Code: the smoke test calls the tools through `vscode.lm.invokeTool`, offline and against the live Console.
