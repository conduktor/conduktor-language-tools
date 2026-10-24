# Conduktor Console language server

Your Kafka platform's resources as YAML (topics, applications, groups, policies, service accounts) in any editor
that speaks LSP, checked against your Conduktor Console as you type.

It is the server behind [Conduktor Console for Zed](https://github.com/conduktor/conduktor-language-tools/tree/main/extensions/zed).
VS Code has its own extension, with a resource tree, Diff with Live and agent tools on top:
[Conduktor Console on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=conduktor.conduktor-console).

## What it does

- **The Console's schema:** completion, hover and errors for every kind your Console accepts, and a whole resource
  per kind in an empty file or after `---`.
- **Field docs on hover,** from the Conduktor reference docs.
- **References:** the names a field refers to (a Topic's cluster, an Application's owner, a service account's ACLs)
  come from the workspace's YAML files and from the Console. A name that is in neither is flagged, with the closest
  one as a quick fix.
- **Navigation:** go to definition, find references, rename across the workspace's files, and workspace symbols to
  find any resource by name.
- **Topic configs:** under a Topic's `spec.configs`, every Kafka topic config with its docs, default and valid values,
  and presets in the code actions.
- **Dry runs** when a file is opened and saved, with what the Console refuses on the resource's first line. **Dry
  run** and, in dev mode, **Apply** are code actions and code lenses.

It only answers for YAML documents with a Console `apiVersion` and `kind`, so it runs next to your editor's own YAML
server and leaves Kubernetes, Helm and CI files alone.

## Install

Node.js 22 or later:

```sh
npm install -g @conduktor/console-language-server
```

Then have your editor's LSP client start it over stdio for YAML files:

```sh
conduktor-console-language-server --stdio
```

## Connect to a Console

With the [`conduktor` CLI](https://github.com/conduktor/ctl) set up, there is nothing to do: the server checks against
the Console in `CDK_BASE_URL`, with `CDK_API_KEY`, in prod mode.

To name a Console yourself, give the server settings under the `conduktor` section, through `workspace/configuration`
or `workspace/didChangeConfiguration`:

```json
{
  "conduktor": { "url": "https://console.example.com", "name": "prod", "mode": "prod", "token": "<token>" }
}
```

Leave `token` out to take it from `CONDUKTOR_TOKEN`. Without any Console, resources are checked against the schema
bundled with the server.

## Modes

The server starts in the connection's mode, prod unless the settings say `dev`. In prod it never changes the Console:
dry runs, never applies. In dev, Apply dry-runs first and asks before it changes anything.

## Telemetry

Release builds send usage events to Conduktor: counts and the Console's kind names, never resource names, URLs, files
or YAML. [TELEMETRY.md](https://github.com/conduktor/conduktor-language-tools/blob/main/TELEMETRY.md) lists every event
and how to turn it off.

## License

Apache-2.0.
