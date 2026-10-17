import type { KindCatalog, KindVersion } from '../openapi/kindCatalog';
import { kindSchema } from '../openapi/kindSchema';
import { schemaAt } from '../openapi/schemaAt';
import type { JsonSchema } from '../openapi/types';
import type { Resource } from '../resources/types';
import type { YamlPath } from '../resources/yamlPaths';
import { fieldDocs, kindDoc, REFERENCE_URL } from './lookup';

/**
 * What a field of a Console resource is, as Markdown: its path, type and whether it is required, the reference docs'
 * text for it, its default, and a link to the docs. `reference` is a line an editor adds about where a reference points.
 */
export function fieldHover(
  schema: JsonSchema,
  catalog: KindCatalog,
  resource: Resource,
  path: YamlPath,
  reference?: string,
): string {
  const kind = catalog.resolve(resource.apiVersion, resource.kind);
  const field = kind?.bodySchema
    ? schemaAt(kindSchema(schema, kind as KindVersion & { bodySchema: string }), resource, path)
    : undefined;
  const docs = fieldDocs(resource.kind, path);
  const sections = new Set(docs.map((doc) => doc.url));
  const parts = [
    [`**${markdownCode(dottedPath(path))}**`, field?.type, field?.required && 'required'].filter(Boolean).join(' · '),
    // The docs can describe a field once per variant, each in its own section: say which is which.
    ...docs.map((doc) => (sections.size > 1 ? `[${doc.section}](${doc.url}): ${doc.text}` : doc.text)),
  ];
  if (field?.default !== undefined) parts.push(`Default ${markdownCode(JSON.stringify(field.default))}`);
  if (reference) parts.push(reference);
  const section = sections.size === 1 ? docs[0]?.url : undefined;
  parts.push(`[Docs](${section ?? kindDoc(resource.kind)?.url ?? REFERENCE_URL})`);
  return parts.join('\n\n');
}

/** A kind, as Markdown: what it is, its facts, and a link to its docs. */
export function kindHover(kind: string): string {
  const doc = kindDoc(kind);
  if (!doc) return `**${kind}**\n\n[Docs](${REFERENCE_URL})`;
  return [`**${kind}** — ${doc.summary}`, doc.facts.join(' · '), `[Docs](${doc.url})`].filter(Boolean).join('\n\n');
}

/**
 * A code span fenced longer than any backtick run inside it, so a value from the file cannot end it and add Markdown
 * (VS Code trusts its hover to run commands).
 */
export function markdownCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function dottedPath(path: YamlPath): string {
  return path
    .map((segment, i) => (typeof segment === 'number' ? `[${segment}]` : i === 0 ? segment : `.${segment}`))
    .join('');
}
