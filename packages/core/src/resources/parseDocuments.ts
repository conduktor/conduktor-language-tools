import { parse, parseAllDocuments } from 'yaml';
import { describeError } from '../client/errors';
import type { KindCatalog } from '../openapi/kindCatalog';
import { isRecord } from '../util';
import { expandEnvVars } from './envVars';
import type { Resource } from './types';

const KIND_LINE = /^kind:[ \t]*["']?([A-Za-z]+)["']?[ \t]*(?:#.*)?$/m;

export interface ResourceDocument {
  index: number;
  start: number;
  end: number;
  kind: string;
  resource?: Resource;
  error?: string;
}

export interface ParseOptions {
  env: Readonly<Record<string, string | undefined>>;
}

export function parseResourceDocuments(text: string, options: ParseOptions): ResourceDocument[] {
  const documents: ResourceDocument[] = [];
  for (const document of parseAllDocuments(text)) {
    const start = document.contents?.range[0] ?? document.range[0];
    const end = document.range[2];
    const source = text.slice(start, end);
    if (document.errors.length > 0) {
      const kind = KIND_LINE.exec(source)?.[1];
      if (kind) documents.push({ index: documents.length, start, end, kind, error: document.errors[0]!.message });
      continue;
    }
    const raw: unknown = document.toJS();
    if (!isRecord(raw) || typeof raw.apiVersion !== 'string' || typeof raw.kind !== 'string') continue;
    documents.push({ index: documents.length, start, end, kind: raw.kind, ...toResource(source, options) });
  }
  return documents;
}

export function catalogDocuments(text: string, catalog: KindCatalog, options: ParseOptions): ResourceDocument[] {
  const kinds = catalog.kindNames();
  return parseResourceDocuments(text, options).filter((document) => kinds.has(document.kind));
}

function toResource(source: string, options: ParseOptions): Pick<ResourceDocument, 'resource' | 'error'> {
  const { text, missing } = expandEnvVars(source, options.env);
  if (missing.length > 0) return { error: `Missing environment variables: ${missing.join(', ')}` };
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    return { error: describeError(error) };
  }
  if (
    !isRecord(value) ||
    !isRecord(value.metadata) ||
    typeof value.metadata.name !== 'string' ||
    !value.metadata.name
  ) {
    return { error: 'metadata.name is required' };
  }
  return { resource: value as Resource };
}
