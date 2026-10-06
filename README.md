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

|                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connect**               | Add a Console with a personal access token (PAT) or an admin API key. The status bar shows the connection, what the token can reach and the connection's mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Browse**                | An Explorer view in two parts: **Global** resources (users, groups, applications, policies, clusters…) and the resources of one **Cluster**, picked with **Select Cluster** (connectors keep their Connect cluster level). Built from the Console's own OpenAPI, so it always matches its version.                                                                                                                                                                                                                                                                                                                                                 |
| **Open and edit**         | Click a resource to open it as YAML. In `apply` mode the document is editable: saving runs a dry run, shows what will change, asks, then applies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Create**                | **New Resource…** (the `+` on a kind or cluster) starts from a repository template or builds the document from the kind's schema: it asks which variant where a kind has them (a cluster's Kafka flavour and Schema Registry, an alert's type, a data quality rule's language), fills the required fields (from the published example where it fits), lists the optional ones as comments, and fills in the parents and a free name. In an empty YAML document, or after a `---` line, completion offers the same as snippets — `Conduktor: <Kind>` and one per variant — with tab stops on the name, a choice of clusters and the values to fill. |
| **Validate and complete** | Any YAML file with a Console `apiVersion` and `kind` gets the connected Console's JSON Schema: completion, hover and errors, per document in multi-document files. Kubernetes, Argo CD and Helm documents in the same file are left alone.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Dry run, apply, diff**  | CodeLenses above every resource: **Dry run**, **Apply** (dry run, confirmation, apply) and **Diff with Live**. The last result shows in the lens and at the end of the line; failures land in Problems.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Into git**              | **Copy to Workspace…** saves a live resource as a file. The output channel prints the matching `conduktor apply -f … --dry-run` for CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Delete**                | **Delete from Console** on a resource in the tree, with confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Sync folder**           | Stage resources as local files mirroring the tree, see what is new, modified or drifted, and apply all changes in dependency order. **Sync Everything** bootstraps a GitOps repository from the Console. See [Local sync folder](#local-sync-folder).                                                                                                                                                                                                                                                                                                                                                                                              |
| **References**            | Completion of the names a field refers to, from the repository and the Console; Problems for references to nothing, pattern traps and overlapping ownership; CodeLens counts of what each pattern matches; Go to Definition. See [References](#references).                                                                                                                                                                                                                                                                                                                                                                                        |
| **Topic configs**         | In a Topic's `spec.configs`: completion of Kafka's topic configs with their docs and defaults, hovers linking to the Kafka docs, and Problems for unknown keys and values Kafka would refuse. Under `spec`, presets (high throughput, durable, compacted, retention…) and the Console's topic templates set partitions, replication and configs in one go. See [Topic configs](#topic-configs).                                                                                                                                                                                                                                                    |
| **Field docs**            | Hover any field of a Console resource for its type, allowed values and whether it is required, the reference docs' text for it, where a reference points (with a link to open it) and a Docs link; hover `kind` for a summary of the kind. See [Field docs](#field-docs).                                                                                                                                                                                                                                                                                                                                                                          |
| **Agents**                | Tools for Copilot agent mode and Claude Code: kinds, schemas, validation, dry runs and live resources. See [AI agents](#ai-agents).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Local sync folder

Stage changes as files before they reach the Console — the first step towards git sync.

- **Where:** one sync folder holds every connection, each as an environment:
  `<sync folder>/environments/<connection>/global/<group>/<kind>/<name>.yaml` and
  `<sync folder>/environments/<connection>/clusters/<cluster>/<group>/<kind>/[<connect cluster>/]<name>.yaml`,
  mirroring the Explorer. `conduktor apply -f environments/<env> -r` applies exactly the environment's resources.
  Files are kept at `<name>.yaml`: rename a resource in its file and the file follows. You are asked the
  first time anything is written (`<workspace>/conduktor` is offered), and **Set Sync Folder…** changes it — for
  example to a GitOps repository — offering to move the existing environments and to add the folder to the
  workspace. The choice is remembered per workspace (machine-wide when no folder is open).
- **Repository templates:** files in `<sync folder>/templates/<Kind>/*.yaml` are offered by **New Resource…** next to
  the schema-built document. Picking one copies it as written, comments included, with a free `metadata.name` (starting
  from the template's own) and the chosen cluster. `templates/` sits outside `environments/`, so `ctl` never applies
  it and its files never count as resources.
- **Sync Everything** bootstraps the whole picture: pick the kinds the repository manages (all but User, which SSO or
  SCIM usually owns; the choice is kept in `conduktor.yaml` at the root, with the environment's Console URL), and every
  resource of those kinds, globally and in every cluster, becomes a file. Built-in resources are left out. Files with
  local changes, new files and files it cannot identify are never overwritten, only reported; re-running it pulls in
  what changed on the Console. Secrets become `${CDK_SECRET_…}` placeholders, listed in
  `environments/<env>/.env.example`; real values go in a git-ignored `.env`. Check the result with
  `conduktor apply -f environments/<env> -r --dry-run`: every resource should come back NotChanged.
- **Sync Locally** on a resource, a kind or a cluster copies just that; nothing else is copied. A git-ignored
  `.conduktor/base/<env>/` at the root of the sync folder keeps the version last synced or applied (the _base_),
  outside the environment so the CLI never applies it. Folders from the older `<sync folder>/<connection>/` layout
  move into `environments/` on first use.
- From then on the Explorer marks each resource: **A** new locally, **M** modified locally, **⚠** changed or deleted
  on the Console since it was synced (found by **Refresh Local Changes**). Synced resources open as local files, and
  **Show Only Changes** filters the tree to them.
- **Saving a resource opened from the tree stages it** whenever it cannot apply straight away (dry-run mode, or once a
  sync folder exists): the edit is written to its file in the sync folder (secrets as placeholders), that file opens
  marked **M**, and the tree's copy reloads what the Console holds. **Edit Locally** does the same without editing
  first, and **New Resource…** writes into the folder. Only apply mode without a sync folder applies on save.
- Apply one resource from its file or the tree, or **Apply All Changes**: every new or modified file in dependency
  order, one at a time, stopping at the first failure. Each success becomes the new base. **Discard Local Changes**
  goes back to the base; **Re-sync from Console** replaces the file with what the Console holds.
- Secrets never reach the disk: synced files hold `${CDK_SECRET_<KIND>_<PARENTS>_<NAME>_<FIELD>}` placeholders (the
  parents, such as the cluster, keep the same connector in two clusters apart), expanded from VS Code's environment when
  applied. **Show Required Variables** lists them.

Resources that depend on others in the same plan (a Group, an Application it owns, an ApplicationInstance of that
Application) cannot all pass a dry run before the first exists — Console's dry run does not see uncommitted creations.
They show as **pending** ("checked when applied") rather than failed, and Apply goes one step at a time. This works
for multi-resource files as well as Apply All Changes.

## References

Fields that name other resources — an application's `owner` group, an instance's `cluster` and owned `resources`, a
service account's ACLs, a group's members and permissions, a data quality policy's rules and targets — are
understood in the editor ([the full table](docs/specs/2026-10-04-references-design.md#references)):

- **Completion** offers the names that exist, from the repository (the sync folder and open documents) and from the
  connected Console's IaC lists, each marked with where it was found.
- **Problems** flag a name that is in neither, once the Console has answered (never offline); an application
  instance whose resources overlap another instance's; and pattern traps — a self-serve name ending in `*` (Console
  rejects it), a permission's LITERAL `foo*` (stored as PREFIXED `foo`) or PREFIXED `foo*` (matches nothing). A
  pattern that matches nothing yet is only a note: claiming a prefix ahead of its topics is legitimate.
- **CodeLens** above each pattern counts what it matches (`matches 12 Topic resources`); click to list and open them.
- **Go to Definition** (Cmd-click, F12) opens a reference's repository file, or the live resource.
- **Find All References** (Shift+F12 on a resource's `metadata.name`) lists every repository document that refers to
  it — by name, by a pattern that matches it (an instance owning `orders.` PREFIXED owns `orders.v2`), or by a `*`
  — and a CodeLens on the name says `referenced by N`.

Console reads patterns three ways, and the editor follows it: instance resources and data quality targets compare
characters (PREFIXED is a plain prefix); group and user permissions treat a trailing `*` as a prefix; service-account
ACLs go to Kafka, where LITERAL `*` is the wildcard. Consumer groups, Kafka principals and transactional ids have no
IaC list, so references to them are not checked.

## Topic configs

The topic configs come from Kafka's own reference for the version the local stack runs (4.2), plus the Confluent keys Console
knows, in a checked-in snapshot (`packages/core/snapshot/topic-configs.json`); refresh it with
`node scripts/refresh-topic-configs.ts`. In a Topic's `spec.configs`, completion offers every config not yet set
(with a choice of values where Kafka lists them), hovers show the doc, type, default and valid values with a link,
and Problems flag an unknown key (a warning — brokers may carry their own) or a value of the wrong type or range.
Typing a key directly under `spec` offers **presets**: built-in profiles and the Console's TopicTemplates, which set
`partitions`, `replicationFactor` and the matching configs without touching anything else in the document.

## Field docs

The field texts and kind summaries come from the Conduktor reference pages (console, kafka and self-service) in a
checked-in snapshot (`packages/core/snapshot/field-docs.json`). The docs repository is private, so refresh it from a
local checkout: `node scripts/refresh-field-docs.ts <conduktor-docs checkout>`, which reads the pages at `origin/main` (or
a ref given after the path) without touching the checkout. A hover reads the schema at the field inside the variant the
document chose, so `spec.kafkaFlavor.key` is described for `type: Confluent`. Where the docs describe a field once per
variant (a schema registry's `security.type`), each text names its section. A Topic's `spec.configs` keep the topic
config hover.

## AI agents

Coding agents get the same live schema and dry run as the editor, so they write resources the Console accepts instead
of guessing their shape. They never change the Console: an agent writes YAML and dry-runs it, and you apply it with the
CodeLens or by saving a live document. They read only files inside the workspace, with symlinks resolved, and never see
a secret: passwords, tokens, keys and credential headers such as `Authorization` are redacted.

| Tool                        | What it does                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `conduktor_list_kinds`      | The kinds the connected Console accepts, with versions and parent fields                        |
| `conduktor_get_kind_schema` | One kind's JSON Schema and its published example                                                |
| `conduktor_validate`        | Schema errors with JSON paths, per resource, for YAML text or a workspace file. No Console call |
| `conduktor_dry_run`         | Created / Updated / NotChanged or the Console's error, per resource. Nothing is applied         |
| `conduktor_get_resources`   | Existing resources as YAML, with secret values redacted                                         |

- **Copilot (agent mode):** the tools are available as soon as a connection is ready; reference them in a prompt with
  `#conduktorValidate`, `#conduktorDryRun` and so on. The Console's own MCP server (topics, consumer groups, lineage,
  insights and more) is offered to VS Code as **Conduktor Console (<connection>)** in the MCP servers list.
- **Claude Code:** run **Conduktor: Copy MCP Config for Claude Code**, paste it into the project's `.mcp.json`, and
  `export CONDUKTOR_TOKEN=<personal access token>` before starting `claude`. It adds the same tools (run by a copy
  of `dist/mcp-server.js` that the extension keeps in VS Code's global storage, refreshed when the extension updates)
  and the Console's MCP server.
- **Any other MCP client:** run `node packages/extension/dist/mcp-server.js` with `CONDUKTOR_URL`, `CONDUKTOR_TOKEN`,
  and optionally `CONDUKTOR_MODE` (`dry-run` by default; `read-only` turns dry runs off) and `CONDUKTOR_NAME`.

Tokens are never written to a file: VS Code adds them when it starts a server, and the copied config uses
`${CONDUKTOR_TOKEN}`. Secret values (passwords, SASL configs, keys) are redacted before an agent sees a resource, and
YAML that carries a redacted value back is rejected.

Try: _"Using the Conduktor tools, write topics.yaml with an `orders` topic on local-kafka: 6 partitions, 7 days
retention. Validate and dry-run it."_

## Requirements

- VS Code 1.100 or later.
- [Red Hat YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) for validation, completion
  and hover. The extension offers to install it.
- A Conduktor Console you can reach, and a personal access token created in that Console or an admin API key.

## Install

```sh
pnpm install
pnpm install-local   # packages a fresh .vsix and installs it over any earlier build
```

Then run **Developer: Reload Window** in VS Code. Every build is version 0.0.1, so always install through
`pnpm install-local` (it rebuilds first) rather than an existing `.vsix`. It needs the `code` command on your `PATH`
(**Shell Command: Install 'code' command in PATH** in VS Code).

## Getting started

1. Open the **Conduktor** view in the activity bar and choose **Add Connection**: the Console URL (for a local stack,
   `http://localhost:8080`), a token, a name and a mode.
2. **Select Cluster** (the server icon on the view's title bar; picked for you when there is only one), then expand
   **Cluster → kafka → Topic** and open a topic. **Global** holds everything that is not in a cluster.
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
- `spec.schemaFile` on a `Subject` and the `conduktor.io/descriptionFile` label on a `Topic` (sent as
  `metadata.description`, where the Console keeps it) are read from files,
  relative to the root of the workspace folder holding the YAML (where you would run the CLI), or to the YAML's own
  folder when it is outside the workspace. A path that leads outside that folder, through `..` or a symlink, is
  refused, so a cloned repository cannot send other files to the Console. In the sync folder, an apply also records
  what the included files held, so editing one marks the YAML as modified, and **Discard Local Changes** writes it
  back.
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

After changing an agent tool's name, description or input, run `pnpm sync-tools`: the extension manifest has to list
the tools, and a unit test fails until it matches core.

The smoke test has a live part that runs when `CONDUKTOR_SMOKE_URL` and `CONDUKTOR_SMOKE_TOKEN` are set (a PAT or an
admin key for a local Console). It creates, edits, diffs and deletes a `vscode-smoke-<timestamp>` topic on the
`local-kafka` cluster. It expects a local Console stack, including its SASL broker on `localhost:19093`
(registered as the `local-kafka-sasl` cluster by the test), where service accounts and ACLs behave like real Kafka;
the bootstrap test also runs `conduktor` when it is on the PATH. The variables are separate from `CDK_*` because VS Code re-reads the login shell environment on
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
  src/sync/           sync-folder paths, statuses, drift and secret placeholders
  src/tools/          agent tools shared by the VS Code tools and the MCP server
packages/mcp/         stdio MCP server over the core tools, bundled as dist/mcp-server.js
packages/extension/   VS Code wiring: connections, explorer, conduktor: documents, CodeLenses, schema contributor, agents
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
- **Git sync:** commit staged changes from the sync folder, explicit deletions, and conflict handling for drift.
- **Slice (b), GitOps:** a repository template with plan-on-PR and apply-on-merge GitHub Actions.
- **Slice (c), self-service:** ownership-aware validation for application teams.
