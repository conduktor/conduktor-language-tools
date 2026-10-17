## Explore the Console

The **Conduktor** view, in the activity bar, shows the Console's resources in two parts:

- **Global:** users, groups, applications, policies and everything else that is not in a cluster.
- **Cluster:** the topics, subjects, connectors and service accounts of one Kafka cluster.

**Select Cluster**, on the view's title bar, picks that cluster. A Console with a single cluster has it selected
already, and each connection remembers the one you picked.

Expand **Cluster → kafka → Topic** and click a topic: it opens as YAML, the way the Console holds it.

A kind the cluster does not have, such as Subjects without a Schema Registry, reads **Not available**. A real failure
reads **Failed to load**. Hover either for the Console's answer.

**Reveal in Conduktor Explorer**, in an open resource's context menu, selects it in the tree.
