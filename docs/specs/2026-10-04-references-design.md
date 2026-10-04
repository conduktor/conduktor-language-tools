# Conduktor for VS Code — references and insights

Status: implemented 2026-10-04 · editor intelligence, slice 1 (hovers, docs links and templates are slice 2) · builds on
[slice (a)](2026-10-02-slice-a-design.md) and [local GitOps](2026-10-04-gitops-design.md).

## Intent

Help get every resource right while writing it, not at apply time: offer the names a field can refer to, flag
references to things that do not exist, show what a pattern matches, and catch the ownership overlaps and pattern
traps Console would reject or silently reinterpret. Without this the editor is little better than plain text over the
files.

The extension stays on the IaC endpoints: names come from the repository and from the Console's IaC lists. Consumer
groups, Kafka principals and transactional ids have no IaC list, so references to them are not checked.

## References

A declarative **reference table** in core names, per kind, each field whose value refers to something else:

| Kind                                                             | Field                                              | Refers to                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Application                                                      | `spec.owner`                                       | Group                                                        |
| Application                                                      | `spec.policyRef[]`                                 | ResourcePolicy                                               |
| ApplicationInstance                                              | `metadata.application`                             | Application                                                  |
| ApplicationInstance                                              | `spec.cluster`                                     | KafkaCluster                                                 |
| ApplicationInstance                                              | `spec.topicPolicyRef[]`                            | TopicPolicy                                                  |
| ApplicationInstance                                              | `spec.policyRef[]`                                 | ResourcePolicy                                               |
| ApplicationInstance                                              | `spec.resources[].name` (+ `patternType`)          | Topic / Subject / Connector by `type`, on `spec.cluster`     |
| ApplicationInstance                                              | `spec.resources[].connectCluster`                  | KafkaConnectCluster on `spec.cluster`                        |
| ApplicationInstancePermission                                    | `metadata.application`                             | Application                                                  |
| ApplicationInstancePermission                                    | `metadata.appInstance`, `spec.grantedTo`           | ApplicationInstance                                          |
| ApplicationGroup                                                 | `metadata.application`                             | Application                                                  |
| ApplicationGroup                                                 | `spec.permissions[].appInstance`                   | ApplicationInstance                                          |
| ApplicationGroup                                                 | `spec.members[]`                                   | User                                                         |
| ServiceAccount                                                   | `metadata.cluster`                                 | KafkaCluster                                                 |
| ServiceAccount                                                   | `metadata.appInstance`                             | ApplicationInstance                                          |
| ServiceAccount                                                   | `spec.authorization.acls[].name` (+ `patternType`) | Topic by `type`, on `metadata.cluster`                       |
| Group                                                            | `spec.members[]`                                   | User                                                         |
| Group, User                                                      | `spec.permissions[].cluster`                       | KafkaCluster, or `*`                                         |
| Group, User                                                      | `spec.permissions[].kafkaConnect`                  | KafkaConnectCluster, or `*`                                  |
| Group, User                                                      | `spec.permissions[].name` (+ `patternType`)        | KafkaCluster / Topic / Subject / Connector by `resourceType` |
| Topic, Subject, KafkaConnectCluster, KsqlDBCluster, IndexedTopic | `metadata.cluster`                                 | KafkaCluster                                                 |
| Connector                                                        | `metadata.connectCluster`                          | KafkaConnectCluster on `metadata.cluster`                    |
| Subject                                                          | `spec.references[].subject`                        | Subject on `metadata.cluster`                                |
| IndexedTopic                                                     | `metadata.name`                                    | Topic on `metadata.cluster`                                  |
| KafkaCluster, KafkaConnectCluster                                | `spec.policiesRef[]`                               | ResourcePolicy                                               |
| DataQualityPolicy                                                | `metadata.group`                                   | Group                                                        |
| DataQualityPolicy                                                | `spec.rules[]`                                     | DataQualityRule                                              |
| DataQualityPolicy                                                | `spec.targets[].cluster`                           | KafkaCluster                                                 |
| DataQualityPolicy                                                | `spec.targets[].topic` (+ `patternType`)           | Topic on `.cluster`                                          |

Every path in the table must exist in its kind's schema; a unit test enforces it, so a Console API change cannot
leave the table pointing at nothing. More rows are added as data. Not in slice 1: ApplicationInstancePermission
`spec.resource` (its cluster is the granting instance's), Alert targets, PartnerZone topics.

## Names

Names come from two places, each name marked with where it was found:

- **Repository:** the sync folder's environment for the active connection, plus open documents with their unsaved
  edits.
- **Console:** the kind's IaC list, under the reference's cluster (and Connect cluster), fetched when first needed and
  cached for the session; the Explorer's Refresh clears the cache.

## Patterns

Console reads a name pattern three ways (the Console source):

| Where                                                    | LITERAL                        | PREFIXED                         | Traps                                                                |
| -------------------------------------------------------- | ------------------------------ | -------------------------------- | -------------------------------------------------------------------- |
| ApplicationInstance resources, DataQualityPolicy targets | equal                          | `startsWith`, `""` claims all    | a name ending in `*` is rejected (instance resources)                |
| Group / User permissions                                 | equal; `*` is everything       | `startsWith`; `""` is everything | LITERAL `foo*` becomes prefix `foo`; PREFIXED `foo*` matches nothing |
| ServiceAccount ACLs                                      | equal; `*` is Kafka's wildcard | `startsWith`                     | —                                                                    |

Matching is case-sensitive and character-wise (`click` covers `clickstream`).

**Overlap:** two ApplicationInstance resources collide when they are equal, or one is PREFIXED and the other's name
starts with it, with the same `type` and `connectCluster` — within an instance or across instances on the same cluster.
Console rejects it at apply; the editor flags it first.

## In the editor

- **Completion** at every reference: names from the repository and the Console, each with its source
  (`team-a · Group · repo + Console`), next to the YAML extension's schema completion.
- **Problems** (source `Conduktor`):
  - a reference to something in neither the repository nor the Console — only once the Console has been asked, so
    working offline never raises it;
  - an ApplicationInstance resource overlapping another instance's, naming it and where it is;
  - pattern traps, with what Console will do instead;
  - (information) a pattern that matches nothing yet — a prefix claimed ahead of its topics is legitimate.
- **CodeLens** above each pattern or single reference: `matches 12 topics`, `orders · on Console`; clicking lists the
  matches, and choosing one opens it (its repository file, or the live resource).
- **Go to Definition** on a reference opens its repository file, else the live resource.

## Testing

- **Unit:** table paths against each kind's schema; reference extraction; the three pattern readings and their traps;
  overlap; YAML path at an offset and a path's range (empty values included); the name index merging sources.
- **Live:** completion offers the Console's groups for `spec.owner`; a missing group is a warning and an existing one is
  not; a PREFIXED instance resource's lens counts the matching `local-kafka` topics; two instances in the repository
  claiming overlapping prefixes are flagged; Go to Definition opens a repository file.
