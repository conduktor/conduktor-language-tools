# README screenshots

The screenshots of the READMEs (the repository's and VS Code's) live in `docs/assets/shots/`: `explore.gif` and one
PNG per section. To retake one, follow
its steps below and overwrite the file under the same name. GitHub shows images up to 10 MB.

## Setting up

- a local Console stack, and a
  connection called **local** in **prod** mode (switch to **dev** only for the shots that say so).
- The **Light Modern** theme, as the existing shots use, the window at 1440×900 or so, the minimap and breadcrumbs off, a 15–16 px editor
  font. Capture the VS Code window only (⌘⇧4, then Space, then click the window), so it comes out at 2× — about
  2560 px wide. A GIF should be under 10 MB: 15 fps, a few seconds, no cursor hunting.
- A scratch sync folder (**Set Sync Folder…**) so the shots never show real files.

## The shots

### `explore` — the hero

A GIF: the Explorer and an editor side by side.

1. **Select Cluster** → `local-kafka`; expand **Cluster → kafka → Topic**.
2. Open `orders`. Hover over the **Dry run** CodeLens, then click it: `NotChanged (dry run)` appears at the end of the
   line.
3. Change `partitions` and click **Diff with Live**.

### `authoring` — writing with the schema

A topic file in the sync folder, mid-edit.

1. **New Resource…** on **Topic** under `local-kafka`.
2. Under `spec:`, start typing `con` so completion offers `configs`; under `configs:`, type `ret` so the topic config
   list shows `retention.ms` with its doc.
3. Alternatively, hover `replicationFactor` to show the field docs card.

### `validation` — checked on open

A file with two topics open, the Problems panel visible below.

1. Write `checks.yaml` (outside the sync folder) with one good topic on `local-kafka` and one on `no-such-cluster`.
2. Open it: the good one shows `Created (dry run)` at the end of its line, the bad one a red squiggle, and Problems
   lists the Console's message.

### `diff` — Diff with Live

1. Sync `load-test-001` locally (**Sync Locally**), set `partitions: 3` and add a `retention.ms` config.
2. **Diff with Live** from the editor title: the Console's version on the left, the file on the right.

### `validate-folder` — a whole repository

1. In a scratch folder, `groups/team.yaml` (a new Group), `apps/shop.yaml` (an Application owned by it) and
   `topics/bad.yaml` (a topic on `no-such-cluster`).
2. Right-click the folder in the VS Code Explorer → **Validate Folder against Console**.
3. Capture the summary notification with Problems open: the application **pending** (a warning, waiting for the
   group), the topic failed.

### `sync` — the sync folder

1. **Sync Everything** with `local-kafka` and global, then edit one topic file (**M**), add a new one with **New
   Resource…** (**A**), and leave the rest synced.
2. Capture the Conduktor Explorer with **Global** and the cluster expanded, showing the marks and the dots rolled up
   to the kind and the cluster.

### `cli` — Plan with the CLI

1. With the sync folder from `sync`, run **Plan Environment with CLI** from the Explorer's `…` menu.
2. Capture the **Conduktor CLI** panel showing the `$ docker run …` line, a diff with `[-…-]{+…+}` markers and the
   `Topic/…: Updated` lines.

### `agents` — AI agents

1. Copilot Chat in agent mode, the local connection ready.
2. Ask: _"Using the Conduktor tools, write topics.yaml with an `orders-eu` topic on local-kafka: 6 partitions, 7 days
   retention. Validate and dry-run it."_
3. Capture the chat with the `conduktor_validate` and `conduktor_dry_run` tool calls expanded and the file it wrote.
