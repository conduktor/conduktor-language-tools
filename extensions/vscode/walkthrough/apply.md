## Apply it, in dev

| Mode   | What it can do                                                                      |
| ------ | ----------------------------------------------------------------------------------- |
| `prod` | Everything but change the Console: browse, dry run, diff, validate, plan, sync      |
| `dev`  | Also apply, save live documents, delete and Apply Environment, after a confirmation |

Prod cannot change the Console by any route: no apply, no save to the Console, no delete. Switch to dev only on a
Console you build on.

1. Run **Conduktor: Change Mode** and pick **Dev**. It changes the active connection, and the status bar turns to the
   warning colour, so you always know.
2. Open your resource. **Apply** is now in the CodeLens above it, and in the editor's title bar for the whole file.
3. Apply dry-runs first, shows what will change and asks. Confirm, and it applies. Resources in one file go in the
   CLI's order: users and groups, then clusters, then self-service, then topics and the rest.

The result shows in the CodeLens and in a notification, and the tree refreshes. A new topic can take a minute or two
to appear there, because the Console lists topics from its indexer; opening it by name, dry runs and diffs work
straight away.

In dev, saving a live document opened from the tree applies it, after the same dry run and confirmation; with a sync
folder, it stages the edit as a local file instead. To go back, run **Change Mode** again and pick **Prod**.
