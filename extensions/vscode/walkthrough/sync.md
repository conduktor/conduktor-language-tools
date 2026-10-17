## Keep your resources in git

The sync folder stages changes as files before they reach the Console, laid out like a GitOps repository:

```
<sync folder>/
  conduktor.yaml
  environments/<env>/
    global/<group>/<kind>/<name>.yaml
    clusters/<cluster>/<group>/<kind>/<name>.yaml
    .env.example
  templates/<Kind>/*.yaml
```

- `conduktor.yaml` names the environments: their Console, kinds and clusters.
- A connector sits one folder deeper, under its Connect cluster.
- `.env.example` lists every `${VAR}` the environment needs.
- `templates/` holds your own starting points for **New Resource…**.

- **Sync Everything** asks which clusters and kinds, then writes every resource as a file. Run it again to pull in what
  changed on the Console; it never overwrites a file with local changes.
- **Sync Locally**, on a resource, a kind or a cluster in the tree, copies just that.
- **Set Sync Folder…**, in the view's title bar menu, points it somewhere else, such as an existing repository.

The tree marks each resource the way the file explorer marks git changes: dimmed with a cloud when it is only on the
Console, a check for a synced copy, **M** edited, **A** new, and a warning mark when it changed or was deleted on the
Console since it was synced. **Show Only Changes** filters the tree to them; in dev, **Apply All Changes** applies
every new or modified file in dependency order.

Secrets never reach the disk. Synced files hold `${CDK_SECRET_…}` placeholders, real values go in a git-ignored
`.env`, and **Show Required Variables** lists them.
