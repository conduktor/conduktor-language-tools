import { catalogDocuments, type LoadedSpec } from '@conduktor/vscode-core';

export const SCHEMA_SCHEME = 'conduktor-schema';

export function schemaUriFor(spec: LoadedSpec): string {
  return `${SCHEMA_SCHEME}://schema/${spec.version}.json`;
}

export function claimsDocument(text: string, spec: LoadedSpec): boolean {
  return catalogDocuments(text, spec.catalog, { env: {} }).length > 0;
}
