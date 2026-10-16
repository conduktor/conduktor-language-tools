# Conduktor Console for VS Code

Your Kafka platform's resources as YAML, checked against your Conduktor Console as you type.

> **Preview — in internal testing.** Source, full guide and releases:
> [github.com/conduktor/vscode-conduktor](https://github.com/conduktor/vscode-conduktor) ·
> [latest release](https://github.com/conduktor/vscode-conduktor/releases/latest) ·
> [report a problem](https://github.com/conduktor/vscode-conduktor/issues)

Browse every resource a Conduktor Console manages, write them as YAML with the Console's own schema behind you, and
know — before anything changes — exactly what the Console will say. It sits between the `conduktor` CLI and the
Console UI: the CLI's resource model, with an editor's help.

## Features

**Explore.** The **Conduktor** view shows the Console's **Global** resources and those of one **Cluster** — users,
groups, applications, policies, topics, subjects, connectors, service accounts… Click one to open it as YAML. A kind
the cluster does not have reads **Not available**, with the Console's reason.

**Write.** Any YAML with a Console `apiVersion` and `kind` gets the Console's JSON Schema: completion, errors, and
field docs on hover. **New Resource…** builds a document for any kind and variant; snippets, topic config presets and
the Console's topic templates fill in the rest. Fields that name other resources — owners, clusters, ACLs, permissions
— are completed from your files and the Console, and checked.

**Check.** **Dry run** above every resource asks the Console what applying it would do. Conduktor YAML is dry-run for
you when you open and save it, **Diff with Live** shows the change side by side, and **Validate Folder against
Console** checks a whole repository as one plan. Results land in Problems and at the end of each line.

**Change.** In dev mode, **Apply** above every resource, save a live document to apply it, or delete from the tree —
each after a dry run and a confirmation.

**Sync folder.** **Sync Locally** or **Sync Everything** copies resources into a folder laid out like a GitOps
repository, with secrets kept out as `${CDK_SECRET_…}` placeholders. The tree marks what is new, edited or drifted;
**Apply All Changes** applies them in dependency order. **Plan Environment with CLI** runs `ctl` over it, as a
pipeline would.

**AI agents.** Copilot agent mode and Claude Code get the Console's schema and dry run as tools, so they write YAML the
Console accepts. They never change the Console and never see a secret.

## Getting started

1. **Conduktor: Add Connection** — the Console URL, a personal access token or an admin API key, a name and a mode.
2. **Select Cluster** on the Conduktor view's title bar, then open a topic.
3. **New Resource…** on a kind, fill it in, save: it is dry-run for you. **Diff with Live** shows what would change.

## Modes

| Mode   | What it can do                                                                      |
| ------ | ----------------------------------------------------------------------------------- |
| `prod` | Everything but change the Console: browse, dry run, diff, validate, plan, sync      |
| `dev`  | Also apply, save live documents, delete and Apply Environment, after a confirmation |

New connections start in prod. **Conduktor: Change Mode** switches the active connection.

## Settings

| Setting                              | Default     | What it does                                                        |
| ------------------------------------ | ----------- | ------------------------------------------------------------------- |
| `conduktor.validation.onOpenAndSave` | `true`      | Dry-run Conduktor YAML files when they are opened and saved         |
| `conduktor.subjects.prettySchema`    | `true`      | Lay a Subject's JSON or Avro schema out over lines                  |
| `conduktor.explorer.autoReveal`      | `false`     | Select the active editor's resource in the Explorer                 |
| `conduktor.cli.runner`               | `auto`      | Run `ctl` in Docker, from `conduktor.cli.path`, or either           |
| `conduktor.cli.image`                | _(empty)_   | The `ctl` image for Docker; empty for the version it is tested with |
| `conduktor.cli.path`                 | `conduktor` | The `conduktor` CLI to run when Docker is not used                  |

## Requirements

- A Conduktor Console you can reach, and a personal access token created in it or an admin API key.
- The [Red Hat YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) extension, which it
  offers to install.
- For the CLI runner: Docker, or the [`conduktor` CLI](https://github.com/conduktor/ctl) 0.9.3 or later.

Tokens are kept in VS Code's secret storage, never in settings, files or logs.
