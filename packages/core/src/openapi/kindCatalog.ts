import type { JsonSchema, OpenApiDoc } from './types';

const CLI_TAG = /^cli_([^_]+)_([^_]+)_v(\d+)(?:_(\d+))?$/;
const PATH_PARAM = /\{[^}]+\}/g;
export const COMPONENT_REF = '#/components/schemas/';
export const DEFAULT_ORDER = 1000;

export interface KindVersion {
  kind: string;
  version: number;
  group: string;
  order: number;
  listPath: string;
  parentPathParams: string[];
  parentQueryParams: string[];
  bodySchema?: string;
  applyExample?: unknown;
}

export class KindCatalog {
  private constructor(private readonly byKind: ReadonlyMap<string, readonly KindVersion[]>) {}

  static fromOpenApi(doc: OpenApiDoc): KindCatalog {
    const byKind = new Map<string, KindVersion[]>();
    for (const [path, item] of Object.entries(doc.paths)) {
      if (!item.put || !item.get) continue;
      const match = item.put.tags?.map((tag) => CLI_TAG.exec(tag)).find((m) => m !== null);
      if (!match) continue;
      const [, kebabKind, group, version, order] = match;
      if (kebabKind === undefined || group === undefined || version === undefined) continue;
      const body = item.put.requestBody?.content?.['application/json'];
      const bodySchema = componentName(body?.schema);
      const kindVersion: KindVersion = {
        kind: pascalCase(kebabKind),
        version: Number(version),
        group,
        order: order === undefined ? DEFAULT_ORDER : Number(order),
        listPath: path,
        parentPathParams: (path.match(PATH_PARAM) ?? []).map((param) => param.slice(1, -1)),
        parentQueryParams: [...(item.parameters ?? []), ...(item.put.parameters ?? [])]
          .filter((p) => p.in === 'query' && p.name !== 'dryMode')
          .map((p) => p.name),
        ...(bodySchema !== undefined && { bodySchema }),
        applyExample: body?.example,
      };
      const versions = byKind.get(kindVersion.kind) ?? [];
      versions.push(kindVersion);
      versions.sort((a, b) => a.version - b.version);
      byKind.set(kindVersion.kind, versions);
    }
    return new KindCatalog(byKind);
  }

  kinds(): KindVersion[] {
    return [...this.byKind.values()]
      .flat()
      .sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind) || a.version - b.version);
  }

  kindNames(): Set<string> {
    return new Set(this.byKind.keys());
  }

  versions(kind: string): readonly KindVersion[] {
    return this.byKind.get(kind) ?? [];
  }

  latest(kind: string): KindVersion | undefined {
    return this.versions(kind).at(-1);
  }

  resolve(apiVersion: string, kind: string): KindVersion | undefined {
    const match = /^v(\d+)$/.exec(apiVersion);
    return match ? this.versions(kind).find((v) => v.version === Number(match[1])) : undefined;
  }

  orderOf(kind: string): number {
    return this.latest(kind)?.order ?? DEFAULT_ORDER;
  }
}

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function componentName(schema: JsonSchema | undefined): string | undefined {
  const ref = schema?.$ref;
  return typeof ref === 'string' && ref.startsWith(COMPONENT_REF) ? ref.slice(COMPONENT_REF.length) : undefined;
}
