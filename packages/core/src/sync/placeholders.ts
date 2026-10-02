import type { Resource } from '../resources/types';
import { replaceSecrets } from '../tools/redact';

export function withSecretPlaceholders(resource: Resource): { resource: Resource; variables: string[] } {
  const variables: string[] = [];
  const replaced = replaceSecrets(resource, (path) => {
    const variable = ['CDK_SECRET', resource.kind, resource.metadata.name, ...path].map(slug).join('_');
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
