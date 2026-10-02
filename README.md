# Conduktor Console for VS Code

Browse a Conduktor Console, write resource YAML with schema validation and completion, and dry-run it —
between the `conduktor` CLI and the Console UI.

## Develop

    pnpm install
    pnpm build          # bundles packages/extension/dist/extension.js
    pnpm test           # core and extension unit tests
    pnpm test:vscode    # smoke test in a downloaded VS Code
    pnpm package        # packages/extension/dist/conduktor-console.vsix

`pnpm test:vscode` also runs the live suite when `CONDUKTOR_SMOKE_URL` and `CONDUKTOR_SMOKE_TOKEN` (a personal access
token or admin API key) are set. They are separate from `CDK_*` because VS Code re-reads the login shell environment on
macOS, where `CDK_*` usually points at whichever Console `ctl` is using.

Press F5 in this folder to launch an Extension Development Host. Install
[Red Hat YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) there for validation and completion.

`./scripts/refresh-snapshot.sh ../console` refreshes the bundled OpenAPI and the cliKind drift fixture.

## Use

1. **Conduktor: Add Connection** — Console URL, a personal access token or an admin API key, a name and a mode.
   The status bar shows the connection, what the token can reach (`admin`, `user`, `app`) and the mode.
   **Conduktor: Change Mode** switches between `read-only`, `dry-run` and `apply`.
2. The **Conduktor** activity bar view lists resource groups, kinds and resources. Clicking one opens it as YAML:
   read-only, or editable in `apply` mode, where **saving dry-runs it, asks, and applies it**.
3. **New Resource…** (the `+` on a kind or cluster in the tree, or the command palette) opens an untitled document
   from the kind's published example, with the cluster already filled in.
4. Any YAML file with a Conduktor `apiVersion` and `kind` gets the connected Console's schema: completion, hover and
   errors. Kubernetes, Argo CD and Helm documents in the same file are left alone.
5. CodeLenses above each resource: **Dry run** and, in `apply` mode, **Apply** (a dry run, a confirmation, then the
   real thing). The last result shows in the lens and at the end of the line; failures appear in Problems.
   **Diff with Live** compares the resource with what the Console holds.
6. On a resource in the tree: **Copy to Workspace…** saves it as a file to commit, and in `apply` mode
   **Delete from Console**.

`${VAR}` and `${VAR:-default}` are expanded from VS Code's environment, as `conduktor apply` does. `spec.schemaFile` and
the `conduktor.io/descriptionFile` label are read relative to the workspace folder root.

Console's topic list comes from its indexer, so a topic created here can take a minute or two to appear in the tree;
opening it by name works straight away.

## Demo script

1. A local Console stack, with Console on `http://localhost:8080`.
2. F5, then **Conduktor: Add Connection** with an admin's PAT, mode **Apply**.
3. Expand **kafka → Topic → local-kafka** and open a topic. Change a label and save: confirm, and it is applied.
4. Click `+` on **local-kafka**: a new Topic from the template. Rename it, **Dry run** (`+ Created`), **Diff with
   Live** (nothing on the Console yet), then **Apply**.
5. **Copy to Workspace…** on the topic to put it in git; the output channel shows the matching
   `conduktor apply -f … --dry-run` for CI.
6. **Delete from Console** to clean up.
