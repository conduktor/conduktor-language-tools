# Conduktor for VS Code — slice (a): demos and click-ops

Status: approved 2026-10-02. Implemented so far: the first bit
([plan](../plans/2026-10-02-slice-a-first-bit-plan.md)) and the write path
([plan](../plans/2026-10-02-slice-a-write-plan.md)).

## Intent

A VS Code extension that sits between `ctl` and the Console UI: discover what Console resources
exist, browse what is already in a Console, author and edit kubectl-style resource YAML with
schema-driven help, dry-run, and apply. Git comes for free from the editor.

Priorities are (a) presales/demos and click-ops on non-production Consoles, then (b) platform
teams building GitOps repos, then (c) application teams on self-service. **This spec covers (a)
only.** It is built so (b), (c) and the AI helpers attach to the same core without rework.

Success for (a): from a fresh install, a presenter pastes a Console URL and a personal access
token, browses clusters, topics and applications, opens a topic as YAML, edits it with
completion (including live cluster names), sees a dry-run diff, applies it, and watches the tree
refresh — without touching docs, the CLI or the Console UI.

## Decisions

| Decision      | Choice                                                                                                     | Why                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine        | Native TypeScript client over the Console OpenAPI; no `ctl` dependency                                     | IDE-native diagnostics, diff and tree need structured data `ctl` does not emit. Drift from `ctl` is bounded by the shared Console API shape. |
| Credentials   | A Console personal access token (PAT) or an admin API key; `whoami` decides what is enabled                | A PAT acts as the user, so RBAC applies as in the UI. Demos usually run as admin, and only an admin key reaches the admin-only APIs.         |
| Admin upgrade | A PAT whose user holds `PlatformTokenCreate` can mint an admin key for the connection, on explicit request | Gets a presenter from "I have a login" to the admin features without leaving the editor.                                                     |
| Repo          | New `conduktor/vscode-conduktor`, a sixth sibling in the workspace                                         | Own release cadence and `.vsix` CI; nothing in the Console's web UI is worth coupling to (see Reuse).                                        |
| UI            | VS Code native surfaces only (tree, editor, CodeLens, diff, quick pick, status bar); no webviews           | The editor already provides what a webview would rebuild.                                                                                    |
| Live edit     | Saving a live `conduktor:` document runs dry-run → diff + confirm → apply, on `apply`-mode connections     | The `kubectl edit` moment is the core of the click-ops demo.                                                                                 |
| Validation    | Red Hat YAML extension (`redhat.vscode-yaml`) with schemas supplied at runtime                             | Completion, hover and diagnostics without writing a YAML language server.                                                                    |

## Constraints from the Console API

- **A PAT reaches the IaC endpoints and `/api/mcp`, not `/public/v1/*`.** `withApiCaller`
  admits PATs (`ApiSurface.callerPermits`), but every `publicApi` endpoint — `/public/v1/clusters`,
  `consumergroups`, `users`, `groups`, `ksqldbs`, `service-accounts`, `certificates` — matches on
  the token type `AdminToken` and rejects anything else with "Not admin token". An admin user's PAT is still a `PersonalAccessToken`, so
  it is rejected too. The core of the extension is therefore built on the IaC
  list/get/upsert/delete endpoints, and admin-only features are an add-on for admin keys.
- **`whoami` identifies the token.** `GET /api/token/v1/whoami` accepts any REST caller and returns
  `TokenInfo` discriminated by `type`: `AdminToken`, `PersonalAccessToken`,
  `ApplicationInstanceToken`, `UserToken`, `MachineToken`. It does not say whether a PAT's user is
  an admin.
- **An admin's PAT can mint an admin key.** `POST /api/token/v1/admin_tokens` accepts a user
  credential whose user holds `PlatformTokenCreate` on the platform
  and returns the key once. Actions taken with it are audited under the creator's email.
- **CLI actions are described in the OpenAPI.** Operations carrying `x-cdk-run-name(-v2)` and
  `x-cdk-run-doc` are the actions `ctl run` exposes: topic empty / add partitions / set low
  watermark, connector pause / resume / restart / stop / offsets, partner-zone credentials (all
  IaC paths, PAT-accessible), and consumer-group describe / members / topics / offset-reset
  preview / offset-reset / delete (under `/public/v1`, admin key only).
- **The OpenAPI document is the schema and routing source.** `GET /api/public/docs/docs.yaml` is
  served unauthenticated (≈1 MB, OpenAPI 3.1). Kinds are the paths with both PUT and GET whose PUT
  carries a tag `cli_<kind-kebab>_<group>_v<N>_<order>`; the local dev Console exposes 30 such
  kind/version tags. Each kind has a `<Kind>Resource<V>` body schema.
- **Dry-run is server-side**: `PUT …?dryMode=true` returns
  `{resource, upsertResult: Created | Updated | NotChanged}`. The echoed `resource` is the input,
  not the server's view, so any diff is computed client-side. Delete has no dry-run.
- **Errors are unstructured**: `ErrorInfo {title, msg, cause}`; body decode failures are Tapir/circe
  text; policy failures are one string of `- message` lines.
- **Kind availability is per Console version.** Taking kinds from each Console's own OpenAPI means
  no version gates in the extension.

## Architecture

One pnpm workspace, two packages.

```
vscode-conduktor/
  packages/core/        no `vscode` import; Node + fetch; unit-tested
    openapi/            fetch + cache docs.yaml; KindCatalog; SchemaBuilder
    client/             ConsoleClient
    resources/          YAML documents with ranges; env substitution; includes; ordering; export
    plan/               dry-run a set of resources; live-vs-local normalised diff
    snapshot/           bundled public-api-doc.yaml fallback
  packages/extension/   VS Code wiring only
```

`core` is the seam the later slices reuse: the slice-2 language-model tools and MCP wiring, the
(b) repo template's validation, and any future language server all call `core`, never the
extension.

### core

**`openapi/`**

- `loadSpec(connection)` fetches `docs.yaml`, caches it per connection keyed by the document's
  `info.version`, and falls back to the bundled snapshot when the Console is unreachable.
- `KindCatalog` ports `ctl`'s `pkg/schema/openapi_parser.go`: the tag regex, path parameters on the
  PUT as parent path params, PUT query parameters other than `dryMode` as parent query params, the
  request-body `example` as `applyExample`, `order` from the tag. It exposes
  `kinds()`, `resolve(apiVersion, kind)`, `listPath(kind, parents)`, `getPath`, `upsertPath`,
  `deletePath`, using `ctl`'s rule for picking the kind version from the `apiVersion` number.
- `ActionCatalog` ports `ctl`'s run-action parsing: each `x-cdk-run-name(-v2)` operation becomes an
  action with its doc, method, path params, query params and body fields. An action is tagged
  `adminOnly` when its path is under `/public/v1/`, and `read` when its method is GET or its name
  ends in `Preview`; every other action is a write.
- `SchemaBuilder` produces one JSON Schema (2020-12) for "any Conduktor resource": an `if
kind == X and apiVersion == Y then $ref <X>Resource<V>` chain over every catalogued kind, with all
  referenced component schemas moved under `$defs`. Post-processing pins `kind` and `apiVersion`
  to `const` values (the published `apiVersion` pattern is unanchored) and adds the kind's
  description as `markdownDescription` for hover. Because the schema switches on `kind`, every
  document in a multi-document file validates against its own kind.

**`client/`** — `ConsoleClient(baseUrl, token, tls)` over `fetch`: `list`, `get`, `upsert(resource,
{dryRun})`, `delete`, `runAction(action, params)`, `whoami` returning the typed `TokenInfo`, and
`createAdminKey(name)`. It sends
`Authorization: Bearer <PAT>` and `X-CDK-CLIENT: VSCode/<version>`, and returns typed results or a
`ConsoleError {status, title, message, cause}`. Every call is reported to an optional request
listener (method, path, status, duration) so the extension can log it.

**`resources/`**

- Parses YAML with the `yaml` library keeping source ranges per document and per node, so results
  and errors land on the right lines.
- Applies `ctl`-compatible `${VAR}` / `${VAR:-default}` substitution with `$$` as the escape, and
  expands `ctl`'s two file includes (`Subject` `spec.schemaFile`; `Topic`
  `metadata.labels."conduktor.io/descriptionFile"`), relative to the file. This keeps a file that
  works in the editor working with `ctl` later.
- Sorts by catalog order for apply and reverse order for delete.
- `toExportYaml(resource)` strips server-managed fields (those present in the GET response schema
  but absent from the PUT body schema) and emits stable key order.

**`plan/`** — `dryRun(resources)` upserts each with `dryMode=true` in apply order and returns one
result per document (`Created | Updated | NotChanged | Error`). `diff(resource)` fetches the live
resource, normalises both sides through `toExportYaml`, and returns the two texts; a missing live
resource is a creation, not an error (the case `ctl --print-diff` gets wrong).

### extension

**Connections** — `conduktor.connections` setting: `{id, name, url, mode, caCertPath?, insecure?}`;
the token lives in `SecretStorage` keyed by `id`. "Add connection" asks for URL, name, token and
mode, then calls `whoami`. The token type sets the connection's capability:

| `whoami` type               | Capability                                                                      |
| --------------------------- | ------------------------------------------------------------------------------- |
| `AdminToken`                | `admin`: IaC plus the admin-only features below                                 |
| `PersonalAccessToken`       | `user`: IaC as that user; "Upgrade to admin key…" offered                       |
| `ApplicationInstanceToken`  | `app`: IaC within the instance's ownership (polished in slice c)                |
| `MachineToken`, `UserToken` | rejected — machine tokens have no REST audience; user sessions are not accepted |

The capability is re-read from `whoami` on every activation, so a revoked or replaced token is
noticed. "Upgrade to admin key…" (`user` connections) states that it creates an organisation-wide
admin key, then calls `createAdminKey` with the name `vscode-<connection>-<yyyy-mm-dd>` so it can
be found and revoked in Console's token list, and replaces the PAT in `SecretStorage`. A 403 says
the user lacks `PlatformTokenCreate` and leaves the connection unchanged.

One connection is active at a time; a status-bar item shows its name, capability and mode,
coloured with the warning theme colour in `apply` mode, and switches on click.

**Modes**

| Mode                | Browse/open, read actions | Dry-run, diff | Apply, delete, write actions | Saving a live document                                  |
| ------------------- | ------------------------- | ------------- | ---------------------------- | ------------------------------------------------------- |
| `read-only`         | ✓                         | —             | —                            | document is read-only                                   |
| `dry-run` (default) | ✓                         | ✓             | —                            | shows the plan; the save fails and the edit stays dirty |
| `apply`             | ✓                         | ✓             | ✓ after confirmation         | dry-run → diff + confirm → apply                        |

Mode and capability are independent: capability says what the token can reach, mode says what the
presenter allows the extension to change.

**Explorer** (`TreeDataProvider`) — connection → resource group (`console`, `kafka`, `self-serve`,
`iam`, …) → kind → parent levels (cluster, then Connect cluster for connectors) → resources. Parent
levels are populated from the parent kind's own list (KafkaCluster, KafkaConnectCluster). Nodes
load lazily; a 403 on a kind shows that kind greyed as "no access". Context actions: Open, Pull
into workspace, Diff vs workspace file, Delete, and the resource's run actions; on a kind: New…,
Refresh. On `admin` connections each cluster also has a **Consumer groups** node (list → group →
members and topics with lag), whose run actions are the consumer-group ones.

**Actions** — run actions from `ActionCatalog` appear on the node they belong to, matched by path
(a topic's actions on topic nodes, a connector's on connector nodes). Path params come from the
node; remaining query and body fields are asked for with input boxes, using each field's schema for
type and enum choices. `adminOnly` actions are hidden unless the capability is `admin`; write
actions follow the mode table and confirm with the action's doc text and target. The offset reset
shows its preview first, with _Apply / Cancel_. Results open as a read-only JSON document.

**`conduktor:` file system** (`FileSystemProvider`) — URIs
`conduktor://<connectionId>/<kind>/<parent…>/<name>.yaml`. `readFile` is `get` + `toExportYaml`.
`writeFile` follows the mode table: in `apply` mode it dry-runs, shows a modal with the result
(`Updated`, `NotChanged`, or `Created` when `metadata.name` was changed) and _Show diff / Apply /
Cancel_, then upserts and refreshes the tree. The filesystem is registered read-only for
`read-only` connections.

**Schema wiring** — declares `redhat.vscode-yaml` in `extensionDependencies` and registers a schema
contributor through its exported API. `requestSchema(uri)` claims a YAML file when its content has
`apiVersion` and a catalogued `kind`; `requestSchemaContent` serves the `SchemaBuilder` output for
the active connection (or the snapshot when none is active). No glob configuration is needed.

**Live completion** — a `CompletionItemProvider` for YAML that offers live values for parent and
reference fields: `metadata.cluster`, `metadata.connectCluster`, `spec.application`,
`metadata.appInstance`, and similar, taken from the catalog's parent params and the self-serve
kinds. Values come from list calls cached per connection with a short TTL, invalidated on apply.

**Actions in files** — a CodeLens above each document: _Dry run · Apply · Diff vs live · Delete_
(Apply and Delete only in `apply` mode), and file-level _Dry run all / Apply all_ in catalog order.
Results show as an inline decoration per document (`✓ NotChanged`, `+ Created`, `~ Updated`) and as
diagnostics on errors. "Conduktor: New resource…" picks a kind, opens an untitled document from its
`applyExample`, and offers live parent values through the completion above.

**Output channel "Conduktor"** — each request with method, path, status and timing, plus the
equivalent command for the action: `conduktor apply -f <file> --dry-run` for workspace files, and
`curl` for live documents and Explorer actions. This keeps the GitOps path in view during a demo.

**Commands** — Add/Remove/Switch connection, Upgrade to admin key, Refresh Explorer, New
resource, Dry run (document / file), Apply (document / file), Diff vs live, Pull into workspace,
Delete, Run action, Show output.

## Data flows

1. **Connect** — add connection → `whoami` sets the capability → `loadSpec` → catalogs + schema
   built → Explorer root appears; schema contributor now serves this Console's schema. With a
   `user` capability the presenter may run "Upgrade to admin key…" and the tree gains the admin
   nodes.
2. **Browse and open** — expand kind → `list(kind, parents)` → nodes; open → `conduktor:` URI →
   `get` → export YAML in an editor with full schema help.
3. **Edit live and save** — save → dry-run → modal → (apply mode) upsert → tree refresh and
   completion cache invalidated.
4. **Author new** — New resource → example → edit with completion → CodeLens Dry run → Apply →
   optional Pull into workspace to keep it in git.
5. **Workspace file** — open a `.yaml` in the repo → schema claimed by content → CodeLens actions
   against the active connection, with env substitution and includes applied before sending.

## Error handling

- **400** (decode): attach to the document's range; if circe's message carries a field path
  (`DownField(...)` chain), resolve it to that node's range instead.
- **Policy failure** (multi-line `- message`): one diagnostic per line on the document.
- **401**: prompt to replace the token for that connection. A 401 "Not admin token" on an
  admin-only call means the capability is stale: re-run `whoami` and rebuild the tree.
- **403**: greyed "no access" in the Explorer; in a file, a diagnostic naming the missing access.
- **Network / TLS**: connection marked offline in the tree and status bar; schema falls back to
  the cached or bundled document. `caCertPath` and `insecure` cover lab Consoles with self-signed
  certificates.
- **Unknown kind** in a file: diagnostic "kind not available on <connection>" instead of a
  schema failure.

## Reuse

The Console's web UI has no generated client for the public API, and its packages are not published, so nothing is
imported. Two of its patterns are worth copying: the `dryMode` preview-then-apply flow, and the shape of an upsert's
result.

## Testing

- **Catalog drift**: `KindCatalog` built from the committed `public-api-doc.yaml` must match the kind index the
  `conduktor` CLI ships (list paths, parents, order): the same data `ctl` derives.
- **Action catalog**: from the same document, `ActionCatalog` yields the twenty current actions
  with the right `adminOnly` and `read` tags (the consumer-group set admin-only; describe, members,
  topics, get offsets and the reset preview read).
- **Capability**: each `whoami` type maps to the table above; MachineToken and UserToken are
  rejected with a clear message.
- **Schema soundness**: every kind's `applyExample` validates against the generated schema with a
  2020-12 validator; known-bad variants (wrong `kind`, missing `spec`, wrong `apiVersion`) fail.
- **core units** (Vitest): env substitution and escapes, includes, ordering, export stripping,
  diff normalisation including the missing-live case, error mapping including the circe path.
- **Client**: request/response tests against a stub server; one opt-in integration suite against
  a local dev Console (`http://localhost:8080`) with a PAT from the environment.
- **Extension**: an `@vscode/test-electron` smoke test — activate, add a stub connection, Explorer
  lists kinds, a document gets diagnostics.
- **Manual demo script** in the repo README, run against a local Console before each demo.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm package` (`vsce package` → `.vsix`).

Tooling: TypeScript, pnpm, esbuild bundle, Vitest, ESLint, Prettier. Distribution for the PoC is
a sideloaded `.vsix`; Marketplace publishing is out of scope.

## Out of scope for this slice

- (b) GitOps repo template, GitHub Actions plan-on-PR / apply-on-merge, `--enable-state` pruning.
- (c) ownership-aware validation for application-instance scopes.
- Slice 2 AI helpers: language-model tools over `core` (`schema`, `validate`, `dryRun`), Console
  MCP registration with the PAT, the `conduktor` skill.
- Gateway resources; folder-wide plans; admin-only APIs beyond consumer groups (users and groups
  are covered by the IaC `User`/`Group` kinds; ksqlDB, service accounts and ACLs, certificates,
  interceptors and plugins wait for a later slice).
- Console API improvements this would benefit from later (server view or diff on dry-run,
  structured validation errors with field paths, a public validate endpoint, an anchored
  `apiVersion` pattern, delete dry-run, and `whoami` reporting the caller's platform permissions
  so the extension knows up front whether a PAT can mint an admin key).

## Confirmed during implementation

- `whoami` with a PAT returns `{type: PersonalAccessToken, name, email}`; a browser session returns `UserToken`.
- yaml-language-server applies a contributed schema to each document of a multi-document file separately.
- An unchanged Topic fetched with GET and dry-run back returns `NotChanged`, so for topics no server-managed fields
  need stripping. Other kinds are unchecked.
- The topic list lags writes (Console indexer, seconds to minutes); the item GET does not.
- The published OpenAPI carries Java regexes (`(?s)`, `\_`) and discriminated unions whose branches share an
  enum tag; the schema builder translates both. The `ApplicationGroup` example is invalid against its own schema: it
  uses the role `instanceViewConfig`, which the instance permission enum does not have.

Still open:

- Whether an admin user's PAT can call `POST /api/token/v1/admin_tokens` (the permission check reads as yes).
- Whether IaC list endpoints filter by the PAT owner's permissions rather than failing outright.
