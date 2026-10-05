import type { Resource } from '../resources/types';
import { replaceSecrets } from '../tools/redact';

/**
 * Secrets replaced with `${CDK_SECRET_…}` variables named after the resource — kind, parents, name — and the field, so
 * the same connector in two clusters gets two variables.
 */
export function withSecretPlaceholders(
  resource: Resource,
  parents: readonly string[],
): { resource: Resource; variables: string[] } {
  const variables: string[] = [];
  const replaced = replaceSecrets(resource, (path) => {
    const variable = ['CDK_SECRET', resource.kind, ...parents, resource.metadata.name, ...path].map(slug).join('_');
    variables.push(variable);
    return `\${${variable}}`;
  }) as Resource;
  return { resource: variables.length > 0 ? replaced : resource, variables };
}

function slug(part: string): string {
  return part
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
