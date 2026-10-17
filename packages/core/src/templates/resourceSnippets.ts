import type { KindCatalog, KindVersion } from '../openapi/kindCatalog';
import { kindSchema } from '../openapi/kindSchema';
import type { JsonSchema } from '../openapi/types';
import { newResourceName } from '../resources/yamlText';
import { skeletonYaml } from './skeleton';
import { snippetOf, snippetVariants } from './snippet';

export interface ResourceSnippet {
  kind: string;
  /** Which union option of the spec it inserts, when the kind has several. */
  variant?: string;
  /** In the snippet syntax VS Code and LSP clients share. */
  snippet: string;
  detail: string;
}

/**
 * A whole resource per kind and variant, at the kind's latest version. `clusters` come first-preferred: the first is
 * written in, all of them offered as a choice.
 */
export function resourceSnippets(
  catalog: KindCatalog,
  schema: JsonSchema,
  clusters: readonly string[],
): ResourceSnippet[] {
  const snippets: ResourceSnippet[] = [];
  for (const name of catalog.kindNames()) {
    const kind = catalog.latest(name);
    if (!kind?.bodySchema) continue;
    const root = kindSchema(schema, kind as KindVersion & { bodySchema: string });
    const parents = Object.fromEntries(
      kind.parentPathParams.map((param) => [param, param === 'cluster' ? (clusters[0] ?? '') : '']),
    );
    const choices: Record<string, readonly string[]> =
      kind.parentPathParams.includes('cluster') && clusters.length > 0 ? { 'metadata.cluster': clusters } : {};
    for (const { label, answers } of snippetVariants(root)) {
      const text = skeletonYaml(root, kind, parents, newResourceName(kind), answers);
      snippets.push({
        kind: name,
        ...(label && { variant: label }),
        snippet: snippetOf(text, choices),
        detail: `${kind.group} · v${kind.version}`,
      });
    }
  }
  return snippets;
}
