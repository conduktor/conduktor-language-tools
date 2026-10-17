## Write a resource

Run **New Resource…** from this step, from the `+` on the view's title bar, or from the `+` on a kind in the tree,
which skips the question about the kind.

1. Pick a kind, such as **Topic**. Where the kind has variants (a cluster's Kafka flavour and Schema Registry, an
   alert's type, a data quality rule's language), it asks which one.
2. The first time, it asks where Conduktor should keep its files. Pick a folder to get the resource as a file in your
   sync folder, or press Escape to get an unsaved document.

For a Topic on the cluster `local-kafka`, you get something like this; your Console's schema decides the exact fields:

```yaml
apiVersion: v2
kind: Topic
metadata:
  name: my-topic
  cluster: local-kafka
  # labels: map of string
  # catalogVisibility: PRIVATE | PUBLIC
  # descriptionIsEditable: boolean
  # description: string
  # sqlStorage: object
spec:
  partitions: 1
  # replicationFactor: integer
  # configs: map of string
```

As you fill it in:

- **Completion** offers the fields the Console accepts and their allowed values. Fields that name other resources,
  such as a topic's `cluster` or an application's `owner`, offer the names that exist in your files and on the Console.
- **Hover** a field for its type, its allowed values, whether it is required and the reference docs' text for it.
- In a Topic's `spec.configs`, every Kafka topic config comes with its docs, default and valid values.
- In an empty document, or after `---`, completion offers a snippet per kind: `Conduktor: Topic`, and so on.

Schema completion and errors come through the
[Red Hat YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) extension, which Conduktor
offers to install when it is missing.
