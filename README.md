# Conduktor Console for VS Code

Browse a Conduktor Console, write its resources as YAML with the Console's own schema, and dry-run or apply them —
without leaving the editor.

It sits between the [`conduktor` CLI](https://github.com/conduktor/ctl) and the Console UI. The CLI is the right
tool for GitOps pipelines, but it expects you to know the resource shapes, scopes and parent fields up front. The UI
is friendly, but it does not cover every API resource and changes made there do not end up in git. This extension
gives you the CLI's resource model with an editor's help: what exists, what a resource looks like, whether your YAML
is valid, and what applying it would change. Git comes with VS Code.

> **Status:** proof of concept, slice (a) of the [design](docs/specs/2026-10-02-slice-a-design.md) — demos and
> click-ops against non-production Consoles. Not on the Marketplace yet; build the `.vsix` yourself (below).

## What it does

|                           |                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Connect**               | Add a Console with a personal access token (PAT) or an admin API key. The status bar shows the connection, what the token can reach and the connection's mode.                                                                             |
| **Browse**                | An Explorer view of every resource kind the Console exposes — grouped as in the API, with clusters and Connect clusters as levels — built from that Console's own OpenAPI, so it always matches its version.                               |
| **Open and edit**         | Click a resource to open it as YAML. In `apply` mode the document is editable: saving runs a dry run, shows what will change, asks, then applies.                                                                                          |
| **Create**                | **New Resource…** (the `+` on a kind or cluster) opens a document from the kind's published example with the parents filled in.                                                                                                            |
| **Validate and complete** | Any YAML file with a Console `apiVersion` and `kind` gets the connected Console's JSON Schema: completion, hover and errors, per document in multi-document files. Kubernetes, Argo CD and Helm documents in the same file are left alone. |
| **Dry run, apply, diff**  | CodeLenses above every resource: **Dry run**, **Apply** (dry run, confirmation, apply) and **Diff with Live**. The last result shows in the lens and at the end of the line; failures land in Problems.                                    |
| **Into git**              | **Copy to Workspace…** saves a live resource as a file. The output channel prints the matching `conduktor apply -f … --dry-run` for CI.                                                                                                    |
| **Delete**                | **Delete from Console** on a resource in the tree, with confirmation.                                                                                                                                                                      |

## Requirements

- VS Code 1.100 or later.
- [Red Hat YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) for validation, completion
  and hover. The extension offers to install it.
- A Conduktor Console you can reach, and a personal access token created in that Console or an admin API key.

## Install

```sh
pnpm install
pnpm package
code --install-extension packages/extension/dist/conduktor-console.vsix
```

## Getting started

1. Open the **Conduktor** view in the activity bar and choose **Add Connection**: the Console URL (for a local stack,
   `http://localhost:8080`), a token, a name and a mode.
2. Expand a group and kind — for example **kafka → Topic → local-kafka** — and open a topic.
3. Use **New Resource…** on a cluster, edit the template, then **Dry run** and **Diff with Live**.
4. **Conduktor: Change Mode** → **Apply** to let the connection change the Console; **Apply** then appears in the
   CodeLens, live documents become editable, and **Delete from Console** appears in the tree.

### Modes

| Mode                | Browse and open | Dry run, diff | Apply, save live documents, delete |
| ------------------- | --------------- | ------------- | ---------------------------------- |
| `read-only`         | ✓               |               |                                    |
| `dry-run` (default) | ✓               | ✓             |                                    |
| `apply`             | ✓               | ✓             | ✓, after a confirmation            |

Use `apply` on non-production Consoles. The status bar turns to the warning colour when a connection is in `apply`
mode.

### Tokens and what they reach

| Token (`whoami` type)                         | Reaches                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Admin API key (`AdminToken`)                  | Every resource kind, plus the admin-only `/public/v1` APIs used by later slices. |
| Personal access token (`PersonalAccessToken`) | Every resource kind, as that user, with their permissions.                       |
| Application-instance token                    | The resources that instance owns.                                                |
| Machine token, browser session token          | Rejected: machine tokens have no REST audience, session tokens expire.           |

Tokens are kept in VS Code's secret storage, never in settings or logs. Connections are an application-level
setting, so a repository's `.vscode/settings.json` cannot redefine them.

### Working with the CLI

Files you write here work with `conduktor apply`, and the reverse:

- `${VAR}` and `${VAR:-default}` are expanded from VS Code's environment, and `$${VAR}` passes a literal `${VAR}`
  through — the same rules as the CLI.
- `spec.schemaFile` on a `Subject` and the `conduktor.io/descriptionFile` label on a `Topic` are read from files,
  relative to the workspace folder root (where you would run the CLI).
- Resources in one file are applied in the CLI's order (users and groups, then clusters, then self-service, then
  topics and the rest).

## Known limitations

- Console's topic list comes from its indexer, so a topic created here can take a minute or two to appear in the tree.
  Opening it by name, dry runs and diffs work straight away.
- The Console API returns no diff and no field paths in errors. Diffs are computed locally; errors are placed on the
  resource's first line, one Problem per policy rule.
- If the Console is unreachable, schemas fall back to the last OpenAPI cached for it, then to the one bundled with
  the extension.

## Development

```sh
pnpm install
pnpm build            # bundles packages/extension/dist/extension.js
pnpm test             # unit tests for both packages
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test:vscode      # smoke test inside a downloaded VS Code
```

Press **F5** in this folder to start an Extension Development Host.

The smoke test has a live part that runs when `CONDUKTOR_SMOKE_URL` and `CONDUKTOR_SMOKE_TOKEN` are set (a PAT or an
admin key for a local Console). It creates, edits, diffs and deletes a `vscode-smoke-<timestamp>` topic on the
`local-kafka` cluster. The variables are separate from `CDK_*` because VS Code re-reads the login shell environment on
macOS, where `CDK_*` usually points at whichever Console the CLI is using.

```sh
CONDUKTOR_SMOKE_URL=http://localhost:8080 CONDUKTOR_SMOKE_TOKEN=<token> pnpm test:vscode
```

### Layout

```
packages/core/        no VS Code dependency; unit-tested with Vitest
  src/openapi/        Console OpenAPI → kind catalog, paths and a draft-07 JSON Schema
  src/client/         REST client, errors, whoami and token capability
  src/resources/      YAML documents with CLI-compatible variables, includes and apply order
  src/plan/           dry run and apply of a set of documents
  snapshot/           the bundled OpenAPI, also the test fixture
packages/extension/   VS Code wiring: connections, explorer, conduktor: documents, CodeLenses, schema contributor
docs/specs/           design
docs/plans/           implementation plans, as executed
```

Kinds come only from the Console's OpenAPI (the `cli_<kind>_<group>_v<N>_<order>` tags the CLI also reads), so a newer
Console's kinds appear without a release. A unit test checks the catalog against the `cliKind` index that the Console
generates with the CLI. `./scripts/refresh-snapshot.sh ../console` refreshes the bundled OpenAPI and that index.

The schema builder turns the OpenAPI components into draft-07 JSON Schema for yaml-language-server: it translates
Java regexes, turns discriminator mappings into tagged `oneOf` branches, and only judges documents that are Console
resources.

## Roadmap

From the [design](docs/specs/2026-10-02-slice-a-design.md):

- **Slice (a), next:** upgrade a PAT to an admin key, run the CLI's actions (topic empty, connector restart, …),
  consumer groups and offset resets for admin keys.
- **AI helpers:** language-model tools over the core (schema, validate, dry run) and the Console MCP server for
  Copilot and other agents, with writes staying behind the confirmation.
- **Slice (b), GitOps:** a repository template with plan-on-PR and apply-on-merge GitHub Actions.
- **Slice (c), self-service:** ownership-aware validation for application teams.
