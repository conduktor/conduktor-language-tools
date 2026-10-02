import { parse } from 'yaml';
import { describeError } from '../client/errors';
import type { KindCatalog } from '../openapi/kindCatalog';
import { isRecord } from '../util';
import { expandEnvVars } from './envVars';
import type { Resource } from './types';

const KIND_LINE = /^kind:[ \t]*["']?([A-Za-z]+)["']?[ \t]*(?:#.*)?$/m;
const SEPARATOR = /^(?:---|\.\.\.)(?:[ \t].*)?\r?$/;
const BLANK_OR_COMMENT = /^[ \t]*(?:#.*)?\r?$/;

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
  for (const { start, end } of splitDocuments(text)) {
    const source = text.slice(start, end);
    const kind = sniffKind(source);
    if (kind) documents.push({ index: documents.length, start, end, kind, ...toResource(source, options) });
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

// Documents are split on separator lines rather than by the YAML parser: like ctl, variables are expanded before
// parsing, and `${VAR}` inside a flow mapping is a syntax error that would otherwise shift the parser's boundaries.
function splitDocuments(text: string): { start: number; end: number }[] {
  const documents: { start: number; end: number }[] = [];
  let start: number | undefined;
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineEnd = offset + line.length;
    if (SEPARATOR.test(line)) {
      if (start !== undefined) documents.push({ start, end: offset });
      start = undefined;
    } else if (start === undefined && !BLANK_OR_COMMENT.test(line)) {
      start = offset;
    }
    offset = lineEnd + 1;
  }
  if (start !== undefined) documents.push({ start, end: text.length });
  return documents;
}

function sniffKind(source: string): string | undefined {
  try {
    const raw: unknown = parse(source);
    if (isRecord(raw)) return typeof raw.apiVersion === 'string' && typeof raw.kind === 'string' ? raw.kind : undefined;
  } catch {
    // unparseable until variables are expanded; fall back to the kind line
  }
  return KIND_LINE.exec(source)?.[1];
}
