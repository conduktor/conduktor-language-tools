# Conduktor for VS Code — local sync folder

Status: implemented 2026-10-02 · builds on [slice (a)](2026-10-02-slice-a-design.md) · first step towards git sync.

## Intent

Stage Console changes as files that mirror the Explorer, see at a glance what is new, modified or drifted, and
apply them one at a time or all together in the right order — without copying the whole Console to disk.

## Dependency chains

Console's dry run cannot see resources that earlier documents in the same plan would create, so in a
Group → Application (`spec.owner`) → ApplicationInstance (`metadata.application`) chain only the Group dry-runs
cleanly. Observed errors name the missing resource: `Group with id '<name>' not found`,
`Missing GovernanceApplicationsEdit … on app <name>`.

- **Preview:** a failed dry run is **pending** — "checked when applied" — when its error names a resource that an
  earlier step of the same plan would create (or that is itself pending). Every other failure is a failure.
- **Apply:** in catalog order, one resource at a time; stop at the first failure and mark the rest **skipped**.
  Applying is refused only when the preview has real failures.

## Layout and state

```
<workspace>/conduktor/<connection>/
  global/<group>/<kind>/<name>.yaml
  clusters/<cluster>/<group>/<kind>/[<connectCluster>/]<name>.yaml
  .conduktor/.gitignore             *
  .conduktor/base/<same path>       the version last synced or applied
```

A resource's identity comes from its file (kind, apiVersion, metadata); it counts as synced when a base copy exists at
the same path, so there is no separate index to disagree with the files.

Nothing is copied unless asked: **Sync Locally** on a resource, a kind or a cluster node.

## Statuses

Compared on normalised YAML (identity first, keys sorted) with secret values redacted, so key order and secrets never
show as changes.

| Status         | Rule                                                           |
| -------------- | -------------------------------------------------------------- |
| new            | a local file with no base                                      |
| modified       | local ≠ base                                                   |
| in sync        | local = base                                                   |
| drifted (flag) | live ≠ base, found on **Refresh**; live gone counts as drifted |

## Behaviour once a connection has a sync folder

- The Explorer shows badges (A / M / ⚠), lists local-only resources under their kind and parents, and opens the
  local file for synced resources. **Show Only Changes** builds the tree from local changes alone.
- Saving an edited live document stages it: the edit becomes the local file (the Console version is its base), the
  file opens, and the live document reloads. **Edit Locally** stages without editing. Saving never applies.
- Files stay at `<name>.yaml` in their mirrored folder; a rename in the file or a layout change moves the file (and its
  base) as a workspace rename.
- **New Resource…** writes the template into the folder at its path.
- Per resource: Apply, Diff with Live, **Discard Local Changes** (back to base), **Re-sync from Console**.
- **Apply All Changes:** every new or modified file through the preview and step-by-step apply; each success becomes
  the new base. Drifted resources are named in the confirmation.
- Without a sync folder nothing changes: live documents still apply on save in `apply` mode.

## Secrets

Synced files hold `${CDK_SECRET_<KIND>_<NAME>_<FIELD PATH>}` instead of secret values (same field rules as the agent
redaction). They are expanded from VS Code's environment at apply, like any `${VAR}`; **Show Required Variables**
lists them. Base copies hold the placeholders too, so no secret is written to disk.

## Not in this step

Deletions (an explicit "mark for deletion" later), git commits and pushes, conflict merging (drift is shown; the user
re-syncs or keeps theirs).
