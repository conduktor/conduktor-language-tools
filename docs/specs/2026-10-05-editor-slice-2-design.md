# Conduktor for VS Code — editor intelligence, slice 2

Status: approved 2026-10-05; steps 1–4 implemented · built step by step in the order below, each step reviewed and tried by the user
before the next · builds on [references and insights](2026-10-04-references-design.md).

## Intent

Make the editor explain and scaffold Console resources, not only check them: what references a resource, a sound
starting document for every kind and variant, the repository's own templates, help with Kafka topic configs, and the
documentation behind every field.

## Steps

1. **Find All References** — who refers to a resource.
2. **Variant picker and generated skeleton** — New Resource for every kind and variant.
3. **Snippets** — the same skeletons offered by completion.
4. **Repository templates** — `templates/<Kind>/*.yaml` offered by New Resource.
5. **Kafka topic configs** — completion, hovers and checks in `spec.configs`.
6. **Field docs** — hovers from the documentation, with links.

## 1. Find All References

**Shift+F12** (and the context menu's Find All References) on a resource's `metadata.name` lists every document in
the repository that refers to it, through the [reference table](2026-10-04-references-design.md#references) read in
reverse:

- a reference naming it (`spec.owner: team-a` for Group `team-a`), in the same scope (cluster, Connect cluster);
- a pattern matching it (Topic `orders.v2` is owned by an instance with PREFIXED `orders.`, and granted to a service
  account whose ACL matches it), read the way Console reads that pattern;
- a wildcard: a permission or ACL of `*`, or a `cluster: '*'` scope, covers it.

A **CodeLens** on `metadata.name` says `referenced by 3` (nothing when none); clicking it shows the same list.

The repository is the sync folder's environment plus untitled documents, as for names; the Console is not searched.
Only the referencing kinds' files are read, once per sync-folder change.

## 2. Variant picker and generated skeleton

New Resource builds the document from the kind's schema rather than only its published example:

- **Variants:** for each discriminated union in the kind's `spec` (to two levels deep: `spec.kafkaFlavor`,
  `spec.schemaRegistry`, `spec.authorization`, Alert `spec`, DataQualityRule `spec`), a quick pick of its discriminator
  values; an optional union also offers "none".
- **Skeleton:** required fields with typed placeholders (strings from the published example where it has one, else
  empty; numbers `0`; booleans `false`; enums their first value); optional fields as comments; parents filled; a free
  name.
- Every generated skeleton, for every kind and variant, is valid against the kind's schema once its placeholders are
  filled with any valid values (unit test).

## 3. Snippets

In an empty document, or after a `---` line, completion offers `Conduktor: <Kind>` and `Conduktor: <Kind>
(<variant>)`, built from the step-2 skeleton as snippets: tab stops on the values to fill (name, parents, required
placeholders), the parents' choices from the selected cluster and the Console where known.

## 4. Repository templates

Files under `<repository>/templates/<Kind>/*.yaml` — outside `environments/`, so `ctl` never applies them — are
offered by New Resource next to the built-in skeleton. Picking one copies it with a free `metadata.name` and the
chosen parents filled in; everything else is kept, comments included.

## 5. Kafka topic configs

A script builds a checked-in `topic-configs.json` from Kafka's topic configuration reference for a pinned version
(key, doc, type, default, valid values), plus the Confluent keys the Console knows. In a Topic's `spec.configs`:

- **completion** of keys, with doc and default;
- **hover** with doc, default and the Kafka docs anchor;
- **Problems:** an unknown key (warning — brokers can carry their own), a value of the wrong type or outside its
  valid values.
- **Presets** inside a Topic's `spec`: built-in profiles (high throughput, low latency, compacted, short and long
  retention) that set `partitions`, `replicationFactor` and the matching `spec.configs`, and the Console's
  TopicTemplates (their `defaults.spec`), offered as completions — not as whole documents.

## 6. Field docs

A script extracts the field bullets of conduktor-docs' reference pages (console, kafka, self-service) into a
checked-in `field-docs.json` (kind, field path, text, docs anchor). **Hover** on a field shows its text, its schema
type, allowed values and whether it is required, and for a reference where its target is (repository, Console) with a
link to open it; every hover ends with a **Docs** link to the kind's section. Hover on `kind:` summarises the kind.
URLs: `https://docs.conduktor.io/guide/reference/<page>#<anchor>`.

## Testing

Each step: unit tests for its pure core, live tests for what the user sees, a fresh review, then the user tries it
(installed with `pnpm install-local`).
