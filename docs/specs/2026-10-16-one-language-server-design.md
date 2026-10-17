# One language server for every editor

Status: decided 2026-10-16, step 1 done · follows the Zed language server (#1) and the repository's layout (#2).

## Intent

The editor features exist twice over core: as VS Code providers in `extensions/vscode`, and as the language server in
`packages/language-server` that Zed runs. They already differ (VS Code finds names across the repository, the server
only in open files), and every fix has to be made twice. Vue's, Svelte's, Astro's, Prisma's and Tailwind's tools, and
rust-analyzer, keep one implementation: the language server, with a VS Code extension that is its client plus what
only VS Code can show. This repository does the same.

## What moves, what stays

| In the language server, for every editor                                          | In the VS Code extension, VS Code's own UI                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| the schema: completion, hover, problems                                           | the explorer tree and its states                              |
| field docs on hover                                                               | live documents (the `conduktor:` file system), Diff with Live |
| the dry run on open and save; Dry run and Apply                                   | the status bar, Change Mode, connections and their secrets    |
| references: completion, problems, go to definition, find references, match lenses | the sync folder's commands and views                          |
| labels, topic configs and presets, snippets                                       | the CLI runner, New Resource…                                 |
|                                                                                   | the Copilot tools and the MCP registration                    |

## How VS Code talks to the server

- The extension bundles the server and starts it with `vscode-languageclient`. It ships in the `.vsix`, so nothing is
  downloaded.
- The connection stays in VS Code. When the server asks for its `conduktor` settings, the client answers with the
  active connection and its token from secret storage. It pushes them again when the connection or its mode changes,
  and the server already applies new settings without a restart. Workspace settings never reach the server, so a
  repository still cannot point VS Code at another Console.
- Red Hat YAML is no longer required. The server serves the schema itself, for Console documents only; users keep the
  Red Hat extension for their other YAML.
- Where VS Code shows more than LSP can, such as a dry run's result at the end of the line or Apply's modal
  confirmation, the server's lenses and `window/showMessageRequest` stand in first. A custom notification carries the
  results for the extension to draw only if that reads worse.

## Order

1. Close the server's gaps: field docs on hover, reference problems, definition, find references, match lenses, and
   names from the whole workspace rather than the open files.
2. Add the client and the connection bridge to the extension, move the schema and the dry run to the server, and drop
   the Red Hat contributor and the VS Code validator.
3. Move the remaining language features one pull request at a time, deleting each VS Code provider as the server
   takes it over.

Each step passes the live suite (`pnpm test:vscode` against a local Console) before it merges. It is the only test that
sees what a VS Code user sees.

## Open questions

- Whether Apply keeps VS Code's modal confirmation, with the extension answering the server's request itself, or the
  notification is enough.
- Whether lenses are enough for results, or the server needs a custom notification.
