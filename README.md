<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img alt="Conduktor Console for VS Code and Zed: your Kafka platform's resources as YAML, checked against your Console as you type" src="docs/assets/banner-light.svg" width="100%">
  </picture>
</p>

<p align="center">
  <a href="extensions/vscode/README.md"><b>VS Code</b></a> ·
  <a href="extensions/zed/README.md"><b>Zed</b></a> ·
  <a href="#two-modes"><b>Modes</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

<p align="center">
  <a href="https://github.com/conduktor/conduktor-language-tools/releases/latest"><img alt="Latest release" src="https://img.shields.io/badge/download-latest%20.vsix-bcfe68?style=flat-square&labelColor=072024"></a>
  <img alt="VS Code 1.101 or later" src="https://img.shields.io/badge/VS%20Code-1.101%2B-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white">
  <img alt="Zed, as a dev extension" src="https://img.shields.io/badge/Zed-preview-084CCF?style=flat-square&logo=zedindustries&logoColor=white">
  <img alt="Works with the conduktor CLI 0.9.3" src="https://img.shields.io/badge/conduktor%20CLI-0.9.3-bcfe68?style=flat-square&labelColor=072024">
  <img alt="Tools for Copilot, Claude Code and MCP" src="https://img.shields.io/badge/AI%20agents-Copilot%20%C2%B7%20Claude%20Code%20%C2%B7%20MCP-8b5cf6?style=flat-square">
</p>

---

Write your Kafka platform's resources as YAML (topics, applications, groups, policies, service accounts) with your
Conduktor Console's own schema behind you, and know what the Console will say before anything changes.

It sits between the [`conduktor` CLI](https://github.com/conduktor/ctl) and the Console UI. The CLI is the right tool
for pipelines, but it expects you to know every resource's shape, scope and parent fields up front. The UI is
friendly, but it does not cover every API resource, and what you change there never reaches git. Here you get the
CLI's resource model with an editor's help: what exists, what a resource looks like, whether your YAML is valid, and
what applying it would change.

<p align="center">
  <img alt="In VS Code: browse a Console, open a topic, change it, apply it and diff it with the live version" src="docs/assets/shots/explore.gif" width="88%">
</p>

## Pick your editor

Both run on the same core: VS Code through its extension, Zed through a language server.

|                                                           | [VS Code](extensions/vscode/README.md) | [Zed](extensions/zed/README.md) |
| --------------------------------------------------------- | :------------------------------------: | :-----------------------------: |
| The Console's schema: completion, hover, errors, snippets |                   ✓                    |                ✓                |
| Field docs on hover, topic configs and presets            |                   ✓                    |                ✓                |
| References: completion, problems, quick fixes             |                   ✓                    |                ✓                |
| Go to definition, find references, rename, search by name |                   ✓                    |                ✓                |
| Dry run on open and save; Apply in dev                    |                   ✓                    |                ✓                |
| Outline by resource                                       |                   ✓                    |      keys (Zed's grammar)       |
| Resource tree, live documents, Diff with Live             |                   ✓                    |                                 |
| Sync folder, Plan and Apply with the CLI                  |                   ✓                    |                                 |
| Guided start                                              |                   ✓                    |                                 |
| Agent tools for Copilot, Claude Code and any MCP client   |                   ✓                    |                                 |
| Install                                                   |   a `.vsix` from the latest release    |    a dev extension, for now     |

What Zed lacks is UI: its extensions cannot add views or panels.

## Two modes

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/modes-dark.svg">
    <img alt="prod never changes the Console; dev changes it after a confirmation" src="docs/assets/modes-light.svg" width="100%">
  </picture>
</p>

- **prod** is for the Console that matters. Explore it, open any Conduktor YAML from anywhere, and check it against
  the Console without any risk of changing it. Connections start there.
- **dev** is for the Console you build on: everything prod does, plus changes, each after a confirmation.

VS Code switches with **Conduktor: Change Mode**; Zed with a code action, until it restarts.

## Roadmap

- **Git from the sync folder:** commit staged changes, explicit deletions, and conflict handling for drift.
- **GitOps repositories,** as a separate extension: repository init, CI scripts and workflows, pull requests.
- **Self-service:** ownership-aware validation for application teams.
- **Zed in its registry,** and the language server on npm for any editor that speaks LSP.

## Contributing

Building from source, running the tests, cutting a release and the repository's layout: see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0: see [LICENSE](LICENSE).
