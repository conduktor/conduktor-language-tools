import { parse, parseAllDocuments } from 'yaml';
import { describeError } from '../client/errors';
import type { KindCatalog } from '../openapi/kindCatalog';
import { isRecord } from '../util';
import { expandEnvVars } from './envVars';
import type { Resource } from './types';

const KIND_LINE = /^kind:[ \t]*["']?([A-Za-z]+)["']?[ \t]*(?:#.*)?$/m;
const API_VERSION_LINE = /^apiVersion:[ \t]*["']?([\w./-]+)["']?[ \t]*(?:#.*)?$/m;
const NAMESPACE_LINE = /^[ \t]+namespace:/m;
const CONSOLE_API_VERSION = /^v\d+$/;
const SEPARATOR = /^(?:---|\.\.\.)(?:[ \t].*)?\r?$/;
const BLANK_OR_COMMENT = /^[ \t]*(?:#.*)?\r?$/;

export interface ResourceDocument {
  index: number;
  start: number;
  end: number;
  kind: string;
  apiVersion: string;
  namespaced?: boolean;
  resource?: Resource;
  error?: string;
}

export interface ParseOptions {
  // Without env, ${VAR} references are left as written.
  env?: Readonly<Record<string, string | undefined>>;
}

export function parseResourceDocuments(text: string, options: ParseOptions = {}): ResourceDocument[] {
  const documents: ResourceDocument[] = [];
  for (const { start, end } of splitDocuments(text)) {
    const source = text.slice(start, end);
    const identity = sniffIdentity(source);
    if (identity) documents.push({ index: documents.length, start, end, ...identity, ...toResource(source, options) });
  }
  return documents;
}

// Kubernetes, Argo CD and Helm share kind names with Console (ServiceAccount, Application); no Console kind has a
// namespace or a group-qualified apiVersion. Validity is not checked here: a broken Console document is kept so the
// dry run can report what is wrong with it.
export function catalogDocuments(text: string, catalog: KindCatalog, options: ParseOptions = {}): ResourceDocument[] {
  const kinds = catalog.kindNames();
  return parseResourceDocuments(text, options).filter(
    (document) => !document.namespaced && CONSOLE_API_VERSION.test(document.apiVersion) && kinds.has(document.kind),
  );
}

/**
 * Whether an editor should give a file the Console's schema: as soon as one of its documents names a Console kind,
 * while its apiVersion is still to be written. catalogDocuments wants both, which suits a dry run, not typing.
 */
export function claimsForEditing(text: string, catalog: KindCatalog): boolean {
  const kinds = catalog.kindNames();
  return parseAllDocuments(text).some((document) => {
    if (!('get' in document)) return false;
    const kind = document.get('kind');
    const apiVersion = document.get('apiVersion');
    return (
      typeof kind === 'string' &&
      kinds.has(kind) &&
      (apiVersion === undefined || (typeof apiVersion === 'string' && CONSOLE_API_VERSION.test(apiVersion))) &&
      document.getIn(['metadata', 'namespace']) === undefined
    );
  });
}

function toResource(source: string, options: ParseOptions): Pick<ResourceDocument, 'resource' | 'error'> {
  const { text, missing } = options.env ? expandEnvVars(source, options.env) : { text: source, missing: [] };
  if (missing.length > 0) return { error: `Missing environment variables: ${missing.join(', ')}` };
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    return { error: describeError(error) };
  }
  const name = isRecord(value) && isRecord(value.metadata) ? value.metadata.name : undefined;
  if (typeof name !== 'string' || name === '') return { error: 'metadata.name is required' };
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

type Identity = Pick<ResourceDocument, 'kind' | 'apiVersion' | 'namespaced'>;

function sniffIdentity(source: string): Identity | undefined {
  try {
    const raw: unknown = parse(source);
    if (!isRecord(raw) || typeof raw.apiVersion !== 'string' || typeof raw.kind !== 'string') return undefined;
    const namespaced = isRecord(raw.metadata) && raw.metadata.namespace !== undefined;
    return { kind: raw.kind, apiVersion: raw.apiVersion, ...(namespaced && { namespaced }) };
  } catch {
    if (source.includes('{{')) return undefined;
  }
  const kind = KIND_LINE.exec(source)?.[1];
  const apiVersion = API_VERSION_LINE.exec(source)?.[1];
  if (!kind || !apiVersion) return undefined;
  return { kind, apiVersion, ...(NAMESPACE_LINE.test(source) && { namespaced: true }) };
}
