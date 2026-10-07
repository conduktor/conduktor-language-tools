import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { stringify } from 'yaml';
import { itemPath, listPath } from '../openapi/paths';
import { kindSchema } from '../openapi/kindSchema';
import { PARENT_KINDS } from '../openapi/parents';
import type { JsonSchema } from '../openapi/types';
import { planDocuments } from '../plan/planDocuments';
import type { UpsertOutcome } from '../plan/upsertDocuments';
import { referencedVariables } from '../resources/envVars';
import { isRecord, kebabCase } from '../util';
import { REDACTED, REDACTED_MESSAGE, redactedPaths, redactSecrets } from './redact';
import { noSuchVersion, resolveKind, resourceDocuments, type BodyKind } from './resolve';
import { ToolError, type ToolContext, type ToolDefinition } from './types';

const LIST_LIMIT = 50;
const YAML_OR_PATH = {
  yaml: { type: 'string', description: 'Conduktor resource YAML; several resources may be separated by ---.' },
  path: { type: 'string', description: 'A YAML file in the workspace, relative to its root. Use instead of yaml.' },
};

export const agentInstructions = [
  'These tools work with Conduktor Console resources: kubectl-style YAML (apiVersion, kind, metadata, spec)',
  'whose fields are specific to Conduktor and to the connected Console version.',
  'Before writing a resource, call conduktor_get_kind_schema for its kind (conduktor_list_kinds lists them) and',
  'follow the schema exactly; conduktor_get_resources shows existing resources to copy from.',
  'After writing or changing YAML, call conduktor_validate and fix every error, then conduktor_dry_run.',
  'These tools never change the Console. When the dry run is clean, say the YAML is ready and that the user applies',
  'it from the editor; never say it has been applied.',
].join(' ');

const listKinds: ToolDefinition = {
  name: 'conduktor_list_kinds',
  title: 'List Conduktor kinds',
  description:
    'List the Conduktor Console resource kinds the connected Console accepts (for example Topic, Application, ' +
    'KafkaCluster) with their apiVersions, API group, the metadata fields that name their parents (such as cluster) ' +
    'and the order they are applied in. Call this first when you are not sure which kind to use.',
  inputSchema: { type: 'object', properties: {} },
  async run(_input, context) {
    const kinds = new Map<
      string,
      { kind: string; apiVersions: string[]; group: string; parents: string[]; applyOrder: number }
    >();
    for (const kv of context.catalog.kinds()) {
      const entry = kinds.get(kv.kind);
      if (entry) {
        entry.apiVersions.push(`v${kv.version}`);
        entry.parents = kv.parentPathParams;
      } else {
        kinds.set(kv.kind, {
          kind: kv.kind,
          apiVersions: [`v${kv.version}`],
          group: kv.group,
          parents: kv.parentPathParams,
          applyOrder: kv.order,
        });
      }
    }
    return json({ console: context.connectionName, kinds: [...kinds.values()] });
  },
};

const getKindSchema: ToolDefinition = {
  name: 'conduktor_get_kind_schema',
  title: 'Get Conduktor kind schema',
  description:
    'Get the JSON Schema and an example YAML for one Conduktor Console resource kind on the connected Console. ' +
    'Call this before writing or editing a resource of that kind and follow it exactly: Conduktor resources look ' +
    'like Kubernetes YAML but their fields are Conduktor-specific.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', description: 'The resource kind, for example Topic.' },
      apiVersion: { type: 'string', description: 'A version such as v2. Defaults to the latest.' },
    },
    required: ['kind'],
  },
  async run(input, context) {
    const kind = bodyKind(resolveKind(context, input.kind, input.apiVersion));
    const schema = JSON.stringify(kindSchema(context.schema, kind), null, 2);
    const example =
      kind.applyExample === undefined
        ? ''
        : `\n\nExample:\n\n\`\`\`yaml\n${stringify(kind.applyExample).trimEnd()}\n\`\`\``;
    const parents =
      kind.parentPathParams.length > 0 ? ` It lives under metadata.${kind.parentPathParams.join(', metadata.')}.` : '';
    return `${kind.kind} v${kind.version} on ${context.connectionName}.${parents}\n\nJSON Schema:\n\n\`\`\`json\n${schema}\n\`\`\`${example}`;
  },
};

const validate: ToolDefinition = {
  name: 'conduktor_validate',
  title: 'Validate Conduktor YAML',
  description:
    "Validate Conduktor Console resource YAML against the connected Console's schema, without contacting the " +
    'Console. Pass the YAML text or a workspace file path. Returns, for each resource, the schema errors with ' +
    'their JSON paths. Run it after writing or changing a resource, fix every error, then use conduktor_dry_run.',
  inputSchema: { type: 'object', properties: YAML_OR_PATH },
  async run(input, context) {
    const documents = resourceDocuments(input, context).map((document) => {
      const { resource } = document;
      const identity = { index: document.index, kind: document.kind, name: resource?.metadata.name ?? null };
      const errors = !resource
        ? [{ path: '/', message: document.error ?? 'Not a Conduktor resource' }]
        : [
            ...redactedPaths(resource).map((path) => ({ path, message: REDACTED_MESSAGE })),
            ...schemaErrors(context, resource.kind, resource.apiVersion, resource).filter(
              (error) => !isVariable(valueAt(resource, error.path)),
            ),
          ];
      return { ...identity, valid: errors.length === 0, errors, ...withVariables(document.variables) };
    });
    return json({
      console: context.connectionName,
      documents,
      ...(documents.some((d) => d.variables) && { note: VARIABLES_NOTE }),
    });
  },
};

const dryRun: ToolDefinition = {
  name: 'conduktor_dry_run',
  title: 'Dry-run Conduktor YAML',
  description:
    'Dry-run Conduktor Console resource YAML on the connected Console: the Console checks it (ownership, policies, ' +
    'references) and reports whether each resource would be Created, Updated or NotChanged, or why it would fail. ' +
    'Nothing is applied and the Console does not change. Pass the YAML text or a workspace file path. After a clean ' +
    'dry run, tell the user it is ready and that they apply it from the editor; never say it has been applied.',
  inputSchema: { type: 'object', properties: YAML_OR_PATH },
  async run(input, context) {
    const documents = resourceDocuments(input, context);
    for (const { resource } of documents) {
      const [path] = resource ? redactedPaths(resource) : [];
      if (path) throw new ToolError(`${resource!.kind} ${resource!.metadata.name} ${path} ${REDACTED_MESSAGE}.`);
    }
    const items = await planDocuments(context.client, context.catalog, documents, {
      readInclude: context.readInclude,
    });
    const variablesOf = new Map(documents.map((d) => [d.index, d.variables]));
    const results = items.map(({ document, outcome }) => ({
      index: document.index,
      kind: document.kind,
      name: document.resource?.metadata.name ?? null,
      ...describeOutcome(outcome),
      ...withVariables(variablesOf.get(document.index) ?? []),
    }));
    const note =
      'Nothing was changed: this was a dry run. The user applies from the editor (the Apply CodeLens, or by saving a live document).';
    return json({
      console: context.connectionName,
      documents: results,
      note: results.some((r) => r.variables) ? `${note} ${VARIABLES_NOTE}` : note,
    });
  },
};

const getResources: ToolDefinition = {
  name: 'conduktor_get_resources',
  title: 'Get Conduktor resources',
  description:
    'Read resources that already exist on the connected Console, as YAML: all of one kind, or one by name. Kinds ' +
    'that live in a Kafka cluster need cluster, and connectors also connectCluster. Use it to copy the shape of an ' +
    'existing resource or to check what is there before changing it.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', description: 'The resource kind, for example Topic.' },
      name: { type: 'string', description: 'One resource by name. Omit to list them.' },
      cluster: { type: 'string', description: 'The Kafka cluster, for kinds that live in one.' },
      connectCluster: { type: 'string', description: 'The Kafka Connect cluster, for connectors.' },
      apiVersion: { type: 'string', description: 'A version such as v2. Defaults to the latest.' },
    },
    required: ['kind'],
  },
  async run(input, context) {
    const kind = resolveKind(context, input.kind, input.apiVersion);
    const missing = kind.parentPathParams.filter((param) => typeof input[param] !== 'string' || input[param] === '');
    if (missing.length > 0) {
      const parentKind = PARENT_KINDS[missing[0]!];
      const hint = parentKind
        ? ` conduktor_get_resources with kind ${parentKind} lists the ${plural(missing[0]!)}.`
        : '';
      throw new ToolError(`${kind.kind} needs ${missing.join(' and ')}.${hint}`);
    }
    const parents = Object.fromEntries(kind.parentPathParams.map((param) => [param, input[param] as string]));
    const resources =
      typeof input.name === 'string' && input.name !== ''
        ? [await context.client.get(itemPath(kind, parents, input.name))]
        : await context.client.list(listPath(kind, parents));
    if (resources.length === 0) return `# No ${kind.kind} resources on ${context.connectionName}.\n`;
    const { value, redacted } = redactSecrets(resources.slice(0, LIST_LIMIT));
    const notes = [
      redacted > 0 &&
        `# Secret values are replaced with ${REDACTED}. Never copy them into YAML you write: leave those fields out or use \${VAR} placeholders the user sets.`,
      resources.length > LIST_LIMIT &&
        `# The first ${LIST_LIMIT} of ${resources.length}; ask for one by name for the rest.`,
    ].filter(Boolean);
    const yaml = (value as unknown[]).map((resource) => stringify(resource)).join('---\n');
    return notes.length > 0 ? `${notes.join('\n')}\n${yaml}` : yaml;
  },
};

export const conduktorTools: readonly ToolDefinition[] = [listKinds, getKindSchema, validate, dryRun, getResources];

const VARIABLES_NOTE =
  '${VAR} references are set by the user when applying; they are left unexpanded here, so a dry run sends them as written.';

function withVariables(variables: readonly string[]) {
  return variables.length > 0 ? { variables } : {};
}

function isVariable(value: unknown): boolean {
  return typeof value === 'string' && referencedVariables(value).length > 0;
}

function valueAt(value: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .reduce<unknown>(
      (node, key) =>
        isRecord(node) || Array.isArray(node) ? (node as Record<string, unknown>)[unescapePointer(key)] : undefined,
      value,
    );
}

function unescapePointer(key: string): string {
  return key.replace(/~1/g, '/').replace(/~0/g, '~');
}

const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
const validators = new WeakMap<JsonSchema, Map<string, ValidateFunction>>();

function schemaErrors(context: ToolContext, kindName: string, apiVersion: string, value: unknown) {
  const kind = context.catalog.resolve(apiVersion, kindName);
  if (!kind) return [{ path: '/apiVersion', message: noSuchVersion(context, kindName, apiVersion) }];
  const body = bodyKind(kind);
  const cache = validators.get(context.schema) ?? new Map<string, ValidateFunction>();
  validators.set(context.schema, cache);
  const key = `${body.kind}/${body.version}`;
  const check = cache.get(key) ?? ajv.compile(kindSchema(context.schema, body));
  cache.set(key, check);
  return check(value) ? [] : describeAjvErrors(check.errors ?? []);
}

function describeAjvErrors(errors: readonly ErrorObject[]): { path: string; message: string }[] {
  const seen = new Set<string>();
  const described: { path: string; message: string }[] = [];
  for (const error of errors) {
    if (error.keyword === 'if') continue;
    const message =
      error.keyword === 'enum'
        ? `must be one of: ${(error.params as { allowedValues: unknown[] }).allowedValues.join(', ')}`
        : (error.message ?? 'is invalid');
    const path = error.instancePath || '/';
    const key = `${path} ${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    described.push({ path, message });
  }
  return described;
}

function describeOutcome(outcome: UpsertOutcome) {
  switch (outcome.status) {
    case 'ok':
      return { result: outcome.result };
    case 'pending':
      return {
        pending: `Waits for ${outcome.waitingFor.join(', ')}, created earlier in this YAML; checked when applied.`,
        error: outcome.message,
      };
    case 'error':
      return { error: outcome.message };
    case 'skipped':
      return { skipped: true };
  }
}

function bodyKind(kind: ReturnType<typeof resolveKind>): BodyKind {
  if (!kind.bodySchema) throw new ToolError(`${kind.kind} v${kind.version} has no published schema.`);
  return kind as BodyKind;
}

function plural(param: string): string {
  return param === 'connectCluster' ? 'Connect clusters' : `${kebabCase(param).replace(/-/g, ' ')}s`;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
