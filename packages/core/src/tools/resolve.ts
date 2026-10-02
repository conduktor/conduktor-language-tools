import { describeError } from '../client/errors';
import type { KindVersion } from '../openapi/kindCatalog';
import { catalogDocuments, type ResourceDocument } from '../resources/parseDocuments';
import { ToolError, type ToolContext } from './types';

export type BodyKind = KindVersion & { bodySchema: string };

export function resolveKind(context: ToolContext, kind: unknown, apiVersion?: unknown): KindVersion {
  if (typeof kind !== 'string' || kind === '') throw new ToolError('kind is required, for example Topic.');
  const versions = context.catalog.versions(kind);
  if (versions.length === 0) throw unknownKind(context, kind);
  if (apiVersion === undefined) return versions.at(-1)!;
  const resolved = typeof apiVersion === 'string' ? context.catalog.resolve(apiVersion, kind) : undefined;
  if (!resolved) throw new ToolError(noSuchVersion(context, kind, String(apiVersion)));
  return resolved;
}

export function noSuchVersion(context: ToolContext, kind: string, apiVersion: string): string {
  const versions = context.catalog.versions(kind).map((v) => `v${v.version}`);
  return `${kind} has no ${apiVersion} on ${context.connectionName}; it has ${versions.join(', ')}.`;
}

export function resourceDocuments(input: Record<string, unknown>, context: ToolContext): ResourceDocument[] {
  const documents = catalogDocuments(sourceText(input, context), context.catalog, { env: context.env });
  if (documents.length === 0) {
    throw new ToolError(
      'No Conduktor resources found: each document needs an apiVersion such as v2 and a Console kind. ' +
        'conduktor_list_kinds lists the kinds.',
    );
  }
  return documents;
}

function sourceText(input: Record<string, unknown>, context: ToolContext): string {
  const { yaml, path } = input;
  if ((typeof yaml === 'string') === (typeof path === 'string')) {
    throw new ToolError('Pass either yaml (the resource text) or path (a file in the workspace), not both.');
  }
  if (typeof yaml === 'string') return yaml;
  if (!context.readFile) throw new ToolError('Files cannot be read here; pass the YAML text as yaml instead.');
  try {
    return context.readFile(path as string);
  } catch (error) {
    throw new ToolError(`Cannot read ${String(path)}: ${describeError(error)}`);
  }
}

function unknownKind(context: ToolContext, kind: string): ToolError {
  const names = [...context.catalog.kindNames()];
  const lower = kind.toLowerCase();
  const exact = names.filter((name) => name.toLowerCase() === lower);
  const similar = exact.length > 0 ? exact : names.filter((name) => name.toLowerCase().includes(lower)).slice(0, 3);
  const hint = similar.length > 0 ? ` Did you mean ${similar.join(' or ')}?` : '';
  return new ToolError(`Unknown kind "${kind}".${hint} conduktor_list_kinds lists them all.`);
}
