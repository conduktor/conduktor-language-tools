import snapshot from '../../snapshot/field-docs.json';
import type { YamlPath } from '../resources/yamlPaths';
import type { FieldDoc, KindDoc } from './mdx';

export const REFERENCE_URL = 'https://docs.conduktor.io/guide/reference';

const KINDS = new Map((snapshot.kinds as KindDoc[]).map((doc) => [doc.kind, doc]));
const FIELDS = new Map<string, FieldDoc[]>();
for (const doc of snapshot.fields as FieldDoc[]) FIELDS.set(doc.kind, [...(FIELDS.get(doc.kind) ?? []), doc]);
const ROOTS = new Set(['spec', 'metadata', 'kind', 'apiVersion']);

export function kindDoc(kind: string): KindDoc | undefined {
  return KINDS.get(kind);
}

/**
 * The docs for a field, as the reference pages spell it: the exact path first, then shortened ones (the docs sometimes
 * write `spec.security.type` for `spec.schemaRegistry.security.type`), never a single segment that would attach to
 * every nested field of that name.
 */
export function fieldDocs(kind: string, path: YamlPath): FieldDoc[] {
  const hovered = path.filter((segment): segment is string => typeof segment === 'string');
  const docs = (FIELDS.get(kind) ?? []).map((doc) => ({ doc, segments: segmentsOf(doc.path) }));
  const exact = docs.filter(({ segments }) => segments.join('.') === hovered.join('.'));
  const shortened = docs.filter(
    ({ segments }) =>
      segments[0] === 'spec' &&
      segments.length >= 3 &&
      segments.length < hovered.length &&
      hovered.slice(-(segments.length - 1)).join('.') === segments.slice(1).join('.'),
  );
  return [...exact, ...shortened].map(({ doc }) => doc);
}

// The docs write list items as `[]` and some fields relative to `spec`.
function segmentsOf(path: string): string[] {
  const segments = path.replace(/\[\]/g, '').split('.');
  const [root = ''] = segments;
  return ROOTS.has(root) ? segments : ['spec', ...segments];
}
