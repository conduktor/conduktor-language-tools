# Conduktor for VS Code — run actions and consumer groups

Status: approved 2026-10-02 · builds on [slice (a)](2026-10-02-slice-a-design.md) · demo click-ops.

## Intent

Do what a demo needs beyond YAML from the Explorer: restart a connector, add partitions to a topic, reset a consumer
group's offsets. And show consumer groups, with their lag, next to the resources they read from.

## What the Console offers

The OpenAPI marks runnable endpoints with `x-cdk-run-name-v2` (older ones: `x-cdk-run-name`) and `x-cdk-run-doc`;
`ctl run` builds its commands from the same tags. The snapshot has 20:

| Target         | Actions                                                                                             | Token |
| -------------- | --------------------------------------------------------------------------------------------------- | ----- |
| Connector      | stop, pause, resume, restart, get / reset / alter offsets                                           | any   |
| Topic          | add partitions, empty (optionally one partition), set low watermark                                 | any   |
| Consumer group | describe, delete, list topics, topic detail, list members, member detail, reset offsets (+ preview) | admin |
| Other          | partner zone credentials, whoami                                                                    | any   |

Consumer groups exist only under `/public/v1/clusters/{clusterName}/consumergroups`, which the Console serves to
admin tokens alone (`publicApi`: "Not admin token"); a PAT gets 401. Listing is a search,
`POST /public/v1/clusters/{c}/consumergroups` with paging, filters and sort, returning name, state, members,
overall lag, topics and max lag time.

## Run catalog (core)

Built from the OpenAPI alongside the `KindCatalog`. Each action has its name, doc, method and path, path and query
parameters, request body schema, and:

- **read** for GET, **write** for anything else;
- a **preview** when an action named `<name>Preview` exists (`consumerGroupResetOffsetsPreview`);
- a **target**: the kind whose item path is the action's path minus a suffix, parameters compared by position
  (`…/connector/{connector-name}/restart` → Connector), or the consumer group (`…/consumergroups/{consumerGroup}`).
  Actions with no target (whoami, partner zone credentials, whose path does not match its kind) are reachable only
  from **Conduktor: Run Action…**, which asks for each path parameter.

The v2 tag wins over v1 when both are present, as in `ctl`.

## Running an action (extension)

- **No body:** reads run straight away; writes run after a confirm that names the action and its target.
- **A body:** an **action input** document opens, YAML prefilled with a skeleton built from the request schema,
  with schema completion through the existing YAML contributor and **Preview** / **Run** CodeLenses. Field prompts
  like `ctl`'s flags are not offered: bodies such as `ResetOffsetRequest` are nested `oneOf`s.
- **Query parameters** (`topicEmpty`'s optional `partition`) are asked for in an input box; blank leaves them out.
- **Results:** content opens read-only as YAML; no content shows a notification and refreshes the Explorer.

| Mode      | Reads | Preview | Writes          |
| --------- | ----- | ------- | --------------- |
| read-only | yes   | no      | no              |
| dry-run   | yes   | yes     | no              |
| apply     | yes   | yes     | after a confirm |

Writes the mode does not allow are hidden from menus; from the palette they say why and how to change mode.

Run actions are not agent tools: agents never change the Console.

## Consumer groups in the Explorer

A **Consumer Groups** node under the selected cluster, beside the API groups.

- **Admin key:** the first 100 groups by highest lag, then "N more…". Each shows its state and lag
  (`Stable · lag 542`) and expands to the topics it reads with their lag; selecting a group opens its description.
  Its context menu carries the consumer-group actions, gated as above; reset offsets opens an action input with
  Preview.
- **Any other token:** one dimmed node, "needs an admin key".

No automatic refresh; the Explorer's Refresh reloads it.

## Testing

- **Unit:** the run catalog from the snapshot (v2 over v1 tags, read/write, preview pairing, targets by path),
  body skeletons, request building (parameter substitution and encoding), mode gating, consumer-group nodes from a
  fake search response.
- **Live, PAT:** add partitions to a throwaway topic, empty it, delete it; get a connector's offsets when the Connect
  cluster has a connector (skipped otherwise); the "needs an admin key" node.
- **Live, admin:** only with `CONDUKTOR_SMOKE_ADMIN_TOKEN` — list consumer groups and preview an offset reset.

## Out of scope

Automatic lag refresh, run actions as agent tools, flag-style prompts, consumer groups for PATs (needs a Console API).
