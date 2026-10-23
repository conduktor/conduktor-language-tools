# Conduktor Console for Zed

Your Kafka platform's resources as YAML, checked against your Conduktor Console as you type.

> **Preview.** Not in Zed's extension registry yet: install it as a dev extension, below. The VS Code version, with
> more to it, is in [extensions/vscode](../vscode/README.md).

A language server brings the Console to every Conduktor YAML file. It runs next to Zed's own YAML server and answers
only for documents that hold Console resources, so your Kubernetes, Helm and CI files are left alone.

## What you get

- **The Console's schema:** completion, hover and errors as you type, and a whole resource per kind in an empty file
  or after `---`.
- **Field docs on hover,** from the Conduktor reference docs.
- **References:** the names a field refers to (a Topic's cluster, an Application's owner, a service account's ACLs)
  come from the workspace's YAML files, open or not, and from the Console, offered as soon as the value starts. A name
  that is in neither is flagged, with the closest one as a quick fix.
- **Navigation:** go to definition, find references, **editor: rename** (F2) on a resource's name or a reference to
  it, across the workspace's files, and **project symbols** (cmd-T) to find any resource by name.
- **Labels already in use:** keys under `labels:`, most used first, then the values a key takes, from your files and
  the Console's resources of the same kind.
- **Topic configs:** under a Topic's `spec.configs`, every Kafka topic config with its docs and default, the values it
  takes, problems for unknown keys and refused values with their fixes, and presets (and the Console's topic
  templates) in the code actions.
- **A dry run** of each file when it is opened and saved, with what the Console refuses on the resource's first line.
- **Dry run** and, in dev, **Apply** in the code actions (cmd-.), and above each resource once `"code_lens": "on"` is
  in Zed's settings. Apply dry-runs first and asks before it changes anything.

Zed extensions cannot add UI, so the resource tree, live documents, the status bar and the guided start stay in VS
Code. Zed builds its outline from the YAML grammar rather than from the server, so the outline shows keys, not
resources: use cmd-T to jump to one.

## Install

1. Build the server and put it on your `PATH`:

   ```sh
   pnpm install && pnpm install-zed-dev
   ```

   This links `~/.local/bin/conduktor-console-language-server` to the build in `packages/language-server/dist`.
   `~/.local/bin` has to be on the `PATH` Zed sees.

2. In Zed, run **zed: install dev extension** and choose this repository's `extensions/zed/` folder.

After rebuilding the server, run **editor: restart language server** for Zed to pick it up.

The extension runs the server it finds on the `PATH` first. Without one, it installs
`@conduktor/console-language-server` from npm into its own folder, and keeps the copy it has when npm cannot be
reached. That package is not published yet, so for now the `PATH` is the way.

## Connect to a Console

With the `conduktor` CLI set up, there is nothing to do: the server checks against the Console in `CDK_BASE_URL`, with
`CDK_API_KEY`, in prod.

To check against another Console, or give a project its own, name it in Zed's settings (**zed: open settings**) or in
the project's `.zed/settings.json`. Changes apply as soon as the file is saved:

```json
"lsp": {
  "conduktor-console": {
    "settings": { "url": "http://localhost:8080", "name": "local", "mode": "prod", "token": "<token>" }
  }
}
```

Leave `token` out to take it from `CONDUKTOR_TOKEN`. Zed reads a project's own settings only once you trust its
folder. Without any Console, resources are checked against the schema bundled with the server, and the first one you
open says how to name one.

## Modes

The server starts in the connection's mode, prod unless the settings say `dev`. In prod it never changes the Console:
dry runs, never applies. **Switch _connection_ to dev mode** in the code actions (cmd-.) lets Apply change it until
Zed restarts, after a confirmation; **Switch _connection_ back to prod mode** undoes it.

## Telemetry

The language server sends usage events to Conduktor: counts and the Console's kind names, never resource names, URLs,
files or YAML. Set `DO_NOT_TRACK=1` in the environment Zed starts from to turn it off.
[TELEMETRY.md](../../TELEMETRY.md) lists every event and field.

## Contributing

Building from source, running the tests and cutting a release: see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

Apache-2.0: see [LICENSE](LICENSE).
