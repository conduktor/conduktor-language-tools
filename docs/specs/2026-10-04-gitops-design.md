# Conduktor for VS Code — local GitOps

Status: phase 1 (bootstrap) implemented 2026-10-04, phase 2 (CLI runner) 2026-10-06, phase 3 (repository init) and
`ctl` without state 2026-10-07; phase 4 records decisions and is specified when started ·
builds on the [sync folder](2026-10-02-sync-folder-design.md).

## Intent

Treat a folder of Console resources as the source of truth, the way a GitOps repository would: bootstrap it from a
running Console, check and apply it with the same CLI a pipeline would run, and move changes through branches and
pull requests. Everything stays on the machine until the loop works; GitHub comes after.

The extension stays on the IaC endpoints — what `ctl` covers. Changes go through files, never through Console-only
actions.

## Phases

1. **Bootstrap** — Sync Everything into a repository layout (below).
2. **CLI runner** — plan and apply an environment with `ctl` from VS Code.
3. **Repository init** — git, workflows and the scripts they share with the local runner.
4. **GitOps mode** — saves go to a branch; a local pull request view plans it; merging applies it.

## Layout

```
<repo>/
  conduktor.yaml                                 environments and the kinds each one manages
  environments/<env>/global/<group>/<kind>/<name>.yaml
  environments/<env>/clusters/<cluster>/<group>/<kind>/[<connectCluster>/]<name>.yaml
  environments/<env>/.env.example                every ${VAR} the environment needs, without values
  .conduktor/.gitignore                          *
  .conduktor/base/<env>/<same path>              the version last synced or applied
  .gitignore                                     .env, environments/*/.env
  ci/plan.sh, ci/apply.sh                        what the pipelines run (phase 3)
  .github/workflows/conduktor-{plan,apply}.yml   plan on pull requests, apply on merge to main (phase 3)
```

`conduktor apply -f environments/<env> -r` must apply exactly the environment's resources: `ctl` loads every `.yaml`
under the folder, dot folders included, so nothing but resources lives under `environments/<env>/`. Base copies and
the repository config sit outside it.

`conduktor.yaml`:

```yaml
environments:
  dev:
    console: http://localhost:8080
    kinds: [KafkaCluster, Topic, Subject, Connector, Group, Application, ApplicationInstance]
    clusters: [local-kafka] # optional: only these clusters (and global resources); every cluster when absent
```

An environment is bound to a connection by its Console URL; its folder name defaults to the connection name. The
sync root chosen today becomes the repository root.

**Migration:** an existing `<root>/<connection>/` folder moves to `<root>/environments/<connection>/` and its
`.conduktor/base` to `<root>/.conduktor/base/<connection>/`, on first use, with the sync folder's never-overwrite
rules: nothing moves onto an existing path.

## Phase 1 — Bootstrap

**Conduktor: Sync Everything** on a connection (Explorer title, environment node, palette).

1. **Kinds:** a multi-select of the catalog's kinds, all ticked except User (usually owned by SSO or SCIM). The
   choice is saved to `conduktor.yaml` and preselected next time.
2. **Scope:** every chosen kind, globally and in **every** Kafka cluster, through nested parents (Connect clusters
   for connectors) — not only the cluster selected in the Explorer.
3. **Fetch:** about four requests at a time, with a cancellable progress notification. A 403 on a list skips that
   kind (or that parent) and is reported; other errors are reported and the rest continues.
4. **Write:** each resource as a synced copy, under the rules the sync folder already has: a file with local changes,
   a new file or a file the extension cannot identify is never overwritten, only reported. Resources removed from the
   Console show as deleted drift; local files are never deleted. Built-in resources (`metadata.builtIn`, such as the
   stock data quality rules) are left out and reported: the Console owns them and refuses them on apply.
5. **Secrets:** `${CDK_SECRET_…}` placeholders as today; `.env.example` lists every variable the environment's files
   reference, and is rewritten on each bootstrap.
6. **Summary:** resources written per kind, unchanged, skipped (with why) and conflicts, in the output panel and a
   notification.

Re-running Sync Everything refreshes synced copies and adds new resources; it is how drift is pulled in.

## Phase 2 — CLI runner (decided)

- Runs the pinned `conduktor/conduktor-ctl` image with the sync folder mounted; falls back to `conduktor` on PATH when
  Docker is not available.
- Commands per environment: **Plan** (`apply -r -f environments/<env> --dry-run`) and **Apply** (the same without
  `--dry-run`). There is no Validate (ctl has none), and no `--print-diff`, which ctl fails for resources the Console
  does not have yet. Connection and token come from the bound connection; `${VAR}` values from
  `environments/<env>/.env`.
- Output in a panel; failures map back to their files as Problems.
- **No state, no deletes** (Matt, 2026-10-07; this replaces the 2026-10-06 `--enable-state` decision). ctl's state
  told resources apart by all their metadata, deleting and recreating any whose description or labels changed
  (conduktor/ctl#148), and a pipeline has no shared copy of it. Without it, removing a file deletes nothing: Plan and
  Apply's confirmation list the files removed since they were synced as left on the Console, and deleting stays a
  Console action.

## Phase 3 — Repository init (decided)

- **Set Up GitOps Repository**: `git init` on `main` if needed (inside a larger repository, its files go there), the
  `.env` ignores, a README, and workflows that plan on pull requests and apply on merge to `main`.
- Workflows call shared scripts (`ci/plan.sh <env>`, `ci/apply.sh <env>`) so the local runner and GitHub run the same
  commands. The scripts are generated from the arguments the runner builds (Matt, 2026-10-07), so the extension keeps
  its own runner, Windows included; they call `conduktor`, and the workflows install the pinned release binary — the
  ctl image is Alpine, where GitHub's checkout action cannot run.
- Each workflow job reads its secrets from a GitHub Environment named after the environment: `CDK_BASE_URL`,
  `CDK_API_KEY` and each variable of its `.env.example`. GitHub's runners cannot reach a local Console, so the local
  runner stands in until a reachable Console exists.
- Generated scripts and workflows carry a mark; running Set Up again rewrites those and keeps any other existing file.

## Phase 4 — GitOps mode (decided)

- A connection mode next to read-only, dry-run and apply. Live documents are read-only; Apply and Apply All Changes
  give way to the git flow.
- Saving stages to a branch. A **pull request view** per branch shows the diff against `main`, the plan from the local
  runner, and **Merge**; merging into `main` runs the apply script.
- Real GitHub pull requests replace the local view later without changing the scripts.

## Testing (phase 1)

- **Unit:** the layout (environment paths, base paths outside environments), migration planning (what moves, what is
  refused), kind defaults and `conduktor.yaml` round-trips, `.env.example` from referenced variables, the bootstrap
  walk over a fake catalog and client (all clusters, nested parents, 403s skipped, cancellation), the summary.
- **Live:** Sync Everything against the local Console into a temporary repository: files for global and every
  cluster's resources, no file under `environments/<env>/` that is not a resource, `.env.example` lists the
  KafkaCluster secrets, a second run reports everything unchanged, a locally modified file survives. Then
  `conduktor apply -f environments/<env> -r --dry-run` with the local CLI reports every resource NotChanged.

  The CLI check covers global resources and real brokers. A Gateway's simulated cluster holds ACLs Kafka refuses
  (`IdempotentWrite` on a transactional id), so service accounts are exercised on a local Console stack's SASL
  broker (`local-kafka-sasl`, `StandardAuthorizer`).
