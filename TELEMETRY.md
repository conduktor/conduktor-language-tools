# Telemetry

The VS Code extension, the language server (what Zed runs) and the MCP server send usage events to Conduktor. We use
them to see which features get used and where people stop. Only release builds send anything: a build from source has
no key to send with.

## Turning it off

Any one of these stops all of it:

- In VS Code, set `telemetry.telemetryLevel` to anything but `all`. Events go through VS Code's telemetry logger, which
  drops usage events otherwise, so enterprise policies on that setting apply too.
- Anywhere, set `DO_NOT_TRACK=1`, or `CDK_ENABLE_PRODUCT_METRICS=false` (the variable Conduktor Console uses), in the
  environment the editor or agent starts from.

## What is never sent

Resource names, cluster names, connection names, Console URLs, file paths, YAML, error messages and tokens. A kind is
sent by the name the Console's OpenAPI gives it, anything else as `other`; a tool by its name in this repository,
anything else as `other`. Each event sets Segment's `context.ip` to `0.0.0.0`, so Segment does not record your IP
address.

## Where it goes

To Segment's EU region (`events.eu1.segmentapis.com`), in batches: every 10 seconds, every 20 events, and at exit. A
send that fails is dropped, never retried. `CONDUKTOR_TELEMETRY_URL` sends them somewhere else instead, such as a proxy.

`anonymousId` is a random UUID, created the first time in `~/.config/conduktor/telemetry.json` (or under
`$XDG_CONFIG_HOME`) and shared by the three. Delete the file to start over with a new one.

## On every event

| Property           | Value                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `surface`          | `editor` (the VS Code extension or the language server) or `mcp`                                                               |
| `client`           | `vscode`, `zed`, `claude-code`, `claude-desktop`, `cursor`, `codex` or `other`, from the name the editor or agent gives itself |
| `clientVersion`    | Its version, when it reads as one (`1.105.0`); left out otherwise                                                              |
| `extensionVersion` | This release's version                                                                                                         |
| `os`, `arch`       | Node's `process.platform` and `process.arch`, such as `darwin` and `arm64`                                                     |
| `sessionId`        | A random UUID, new for each process                                                                                            |

## Events

Each is named `cdk.extension.` followed by the name below. VS Code only means the language server and the MCP server
never send it.

| Event                                        | When                                                                                    | Properties                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Started`                                    | The extension activates, or the language server or MCP server starts                    | `connections`: how many are saved (VS Code only)                                                  |
| `Lived`                                      | Every hour in which anything happened, and at exit                                      | `automaticChecks`: dry runs made on open or save                                                  |
| `console.Connected`                          | A Console accepts the connection's token: at start, and after a switch or a mode change | `mode` (`prod`, `dev`), `token` (`admin`, `user`, `app`), `openApi` (`live`, `cache`, `snapshot`) |
| `console.Failed`                             | A Console cannot be used for dry runs                                                   | `mode`, `reason` (`refused`, `no-token`)                                                          |
| `connection.Added`                           | A connection is saved (VS Code only)                                                    | `mode`, `token`                                                                                   |
| `connection.Removed`, `connection.Switched`  | (VS Code only)                                                                          | None                                                                                              |
| `mode.Changed`                               | A connection goes to prod or dev                                                        | `mode`                                                                                            |
| `resources.Checked`                          | A dry run someone asked for, including the one before an Apply                          | Counts                                                                                            |
| `resources.Applied`                          | Resources applied to the Console                                                        | Counts, and `from`: a `file`, a `live` document, or the sync folder's `changes`                   |
| `folder.Validated`                           | Validate Folder against Console (VS Code only)                                          | Counts                                                                                            |
| `resource.Diffed`                            | Diff with Live (VS Code only)                                                           | `kind`                                                                                            |
| `resource.Drafted`                           | New Resource (VS Code only)                                                             | `kind`                                                                                            |
| `resource.Deleted`                           | Delete from Console (VS Code only)                                                      | `kind`                                                                                            |
| `resource.Renamed`                           | A rename across files                                                                   | `kind`, `files`: how many files it edits                                                          |
| `sync.Completed`                             | Sync Locally, Edit Locally or Sync Everything (VS Code only)                            | `scope` (`resource`, `kind`, `everything`), `resources`                                           |
| `environment.Planned`, `environment.Applied` | Plan Environment or Apply Environment with CLI (VS Code only)                           | `result` (`success`, `failure`)                                                                   |
| `agent.Configured`                           | Copy MCP Config for Claude Code (VS Code only)                                          | `agent` (`claude-code`)                                                                           |
| `tool.Called`                                | An agent calls a tool: Copilot in VS Code, or any agent through the MCP server          | `tool`, `result` (`success`, `failure`)                                                           |

Counts are `resources`, `created`, `updated`, `unchanged`, `failed` and `pending` (waiting for a resource earlier in
the run, or skipped after a failure), with `kinds`, the sorted list of kinds involved.
