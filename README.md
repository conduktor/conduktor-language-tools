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
2. The **Conduktor** activity bar view lists resource groups, kinds and resources. Clicking one opens it read-only as YAML.
3. Any YAML file with a Conduktor `apiVersion` and `kind` gets the connected Console's schema: completion, hover and errors.
4. **Dry run** CodeLenses above each resource send it with `dryMode=true` and show `Created`, `Updated` or `NotChanged`
   inline; failures appear as problems on the resource.

`${VAR}` and `${VAR:-default}` are expanded from VS Code's environment, as `conduktor apply` does. `spec.schemaFile` and
the `conduktor.io/descriptionFile` label are read relative to the workspace folder root.

## Demo script

1. A local Console stack, with Console on `http://localhost:8080`.
2. F5, then **Conduktor: Add Connection** with an admin's PAT, mode **Dry run**.
3. Expand **kafka → Topic → local-kafka**, open a topic, show completion by typing under `spec:` in a new file.
4. Copy the topic YAML into `topics.yaml`, change `partitions`, click **Dry run**: `~ Updated (dry run)`.
5. Point at the output channel: the same check as `conduktor apply -f topics.yaml --dry-run`.
