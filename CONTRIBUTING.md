# Contributing

How to build Conduktor Console for VS Code from source, run its tests, cut a release, and find your way around the
code. For what the extensions do and how to use them, see the READMEs of [VS Code](extensions/vscode/README.md) and
[Zed](extensions/zed/README.md).

## Install from source

You need Node 22 or later, [pnpm](https://pnpm.io) (the version in `package.json`'s `packageManager`) and the `code`
command on your `PATH` (**Shell Command: Install 'code' command in PATH** in VS Code).

```sh
pnpm install
pnpm install-local   # packages a fresh .vsix and installs it over any earlier build
```

Then run **Developer: Reload Window**. Local builds are all version 0.0.1, so always install through
`pnpm install-local` (it rebuilds first) rather than an existing `.vsix`.

## Build, check and test

```sh
pnpm build                                   # bundles extensions/vscode/dist/extension.js and the MCP server
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test                                    # unit tests: core, mcp and extension (Vitest)
pnpm test:vscode                             # the extension inside a downloaded VS Code
pnpm test:ui                                 # the walkthrough, driven in a VS Code window (Playwright)
```

Press **F5** in this folder to start an Extension Development Host.

After changing an agent tool's name, description or input, run `pnpm sync-tools`: the extension manifest has to list
the tools, and a unit test fails until it matches core.

### The live suite

`pnpm test:vscode` has a live part that runs when `CONDUKTOR_SMOKE_URL` and `CONDUKTOR_SMOKE_TOKEN` are set — a
personal access token or an admin API key for a local Console:

```sh
CONDUKTOR_SMOKE_URL=http://localhost:8080 CONDUKTOR_SMOKE_TOKEN=<token> pnpm test:vscode
```

It needs a Console you can change, with a Kafka cluster registered as `local-kafka`, and, for the service account
tests, a SASL broker with an authorizer on `localhost:19093`, which the tests register as `local-kafka-sasl`, where
service accounts and ACLs behave like real Kafka.
[Conduktor's quick start](https://docs.conduktor.io/guide/get-started#run-conduktor) runs a Console on
`localhost:8080` with Docker; tests that need a cluster your stack lacks fail rather than skip. The tests create and delete their own `vscode-*` resources. The CLI tests
run `ctl` in Docker, or from `conduktor` on the `PATH` when Docker is missing.

The variables are separate from `CDK_*` because VS Code re-reads the login shell's environment on macOS, where
`CDK_*` usually point at whichever Console the CLI is using.

### The UI tests

`pnpm test:ui` opens a VS Code window and clicks through it as a new user would, against a small fake Console: the
walkthrough's pages, then each step's button, from Add Connection to a first Apply. It sees what the extension host
cannot: the walkthrough page, its checkmarks, and a prompt that closes by itself. When a test fails, a screenshot of
the window lands in `extensions/vscode/test/ui/screenshots/`, and CI keeps it as an artifact.

The harness pauses on each prompt for a moment before answering it, as a person reading it would. That pause is what
catches a prompt that loses focus, so it is not a delay to remove.

### Licenses of what ships

Each build writes `dist/THIRD_PARTY_NOTICES.md`, with the license of every npm package esbuild put in the bundle, and
copies `LICENSE` beside it; both go into the `.vsix` and the language server's package. A build stops when a bundled
package's license is not in the allow list at the top of `scripts/third-party-notices.mjs`, or when it ships no license
text. What an npm release leaves out (its own license, or the notice of code it bundles) goes in
`scripts/licenses/<package>/`, copied from its repository at the release's tag.

## Releases

Releases are built by GitHub Actions from a version tag (`.github/workflows/release.yml`):

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow checks, tests and packages the extension with the tag's version, then publishes a GitHub release with
`conduktor-console-0.2.0.vsix` attached and notes generated from the commits since the previous tag. A tag with a
suffix, such as `v0.2.0-rc.1`, makes a pre-release. **Run workflow** on the workflow's page builds the same `.vsix`
from any branch as a downloadable artifact, without releasing.

## Layout

```
packages/core/        no editor dependency; unit-tested with Vitest
  src/openapi/        Console OpenAPI → kind catalog, paths and a draft-07 JSON Schema
  src/client/         REST client, errors, whoami and token capability
  src/resources/      YAML documents with CLI-compatible variables, includes, .env files and apply order
  src/plan/           dry run and apply of a set of documents
  src/sync/           sync-folder paths, statuses, drift, bootstrap and secret placeholders
  src/cli/            the ctl command line and its output
  src/tools/          agent tools shared by the VS Code tools and the MCP server
  snapshot/           the bundled OpenAPI (also the test fixture), topic configs and field docs
packages/language-server/
                      LSP server over the core, for Zed and any LSP editor, bundled as dist/server.cjs
packages/mcp/         stdio MCP server over the core tools, bundled as dist/mcp-server.js
extensions/vscode/    VS Code wiring: connections, explorer, live documents, CodeLenses, validation, sync folder,
                      CLI runner, agents
extensions/zed/       the Zed extension (Rust, which Zed builds to wasm): runs the language server from the PATH,
                      else from npm
docs/specs/           designs
docs/assets/          the READMEs' illustrations and screenshots (SHOTS.md says how to capture them)
```

## Snapshots

The extension bundles what it cannot ask the Console for. Each has a script to refresh it:

| Snapshot                                     | Refresh                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `packages/core/snapshot/public-api-doc.yaml` | `CDK_BASE_URL=<Console> ./scripts/refresh-snapshot.sh`         |
| `packages/core/snapshot/topic-configs.json`  | `node scripts/refresh-topic-configs.ts`                        |
| `packages/core/snapshot/field-docs.json`     | `node scripts/refresh-field-docs.ts <conduktor-docs checkout>` |

- **OpenAPI:** kinds come only from the Console's OpenAPI (the `cli_<kind>_<group>_v<N>_<order>` tags the CLI also
  reads), so a newer Console's kinds appear without a release; the snapshot is the offline fallback. A unit test
  checks the catalog against the kind index the `conduktor` CLI ships, at the version the extension pins, which the
  script refreshes too.
- **Topic configs:** Kafka's own reference, for the version set in the script, plus the Confluent keys the Console
  knows.
- **Field docs:** the Conduktor reference pages (console, kafka and self-service), published at docs.conduktor.io. The
  docs' source repository is not public, so Conduktor refreshes this one: the script reads a local checkout, at
  `origin/main` or a ref given after the path, without touching it.

The schema builder turns the OpenAPI components into draft-07 JSON Schema for yaml-language-server: it translates
Java regexes, turns discriminator mappings into tagged `oneOf` branches, and only judges documents that are Console
resources.

## Conventions

- Checks pass before every commit: typecheck, lint, format, unit tests, and the live suite for changes to the
  extension. CI (`.github/workflows/ci.yml`) runs all but the live suite on every pull request, on Node 22 and 24.
- Tests first: a test that has been seen failing, then the change that makes it pass.
- Larger work starts with a design in `docs/specs/`.
