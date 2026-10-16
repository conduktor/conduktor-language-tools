import { claimsForEditing, resourceSnippets, type LoadedSpec, type ResourceSnippet } from '@conduktor/vscode-core';
import type { CompletionList, Diagnostic, Hover, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { getLanguageService } from 'yaml-language-server/lib/esm/languageservice/yamlLanguageService';
import { onlyKindVersions, snippetCompletions } from './completions';

const SCHEMA_SCHEME = 'conduktor-schema';

// yaml-language-server labels schema problems `yaml-schema: <title>` and its own (syntax, unused anchors) `YAML`. The
// editor's YAML server reports the latter already, so only the former are ours to publish.
const SCHEMA_SOURCE = /^yaml-schema/;

export interface SchemaService {
  useSpec(spec: LoadedSpec): void;
  /** The spec it answers from: the Console's, or the bundled one until it arrives. */
  current(): LoadedSpec | undefined;
  /** Whether the document is a Console resource this service answers for. */
  claims(document: TextDocument): boolean;
  validate(document: TextDocument): Promise<Diagnostic[]>;
  complete(document: TextDocument, position: Position): Promise<CompletionList | null>;
  hover(document: TextDocument, position: Position): Promise<Hover | null>;
}

/**
 * The Console's schema, through yaml-language-server's own service: what the Red Hat YAML extension gives VS Code, for
 * editors whose YAML server cannot be handed a schema per document. Only documents with a Console kind are answered,
 * so this server sits next to the editor's YAML server without doubling it.
 */
export function createSchemaService(): SchemaService {
  let spec: LoadedSpec | undefined;
  // Built on first use: a skeleton per kind and variant is not free, and the spec rarely changes.
  let snippets: ResourceSnippet[] | undefined;
  // The version is in the URI, so a new spec is never answered from yaml-language-server's schema cache.
  const schemaUri = (current: LoadedSpec) => `${SCHEMA_SCHEME}://schema/${current.version}.json`;

  const service = getLanguageService({
    schemaRequestService: async (uri: string) => {
      if (spec && uri === schemaUri(spec)) return JSON.stringify(spec.schema);
      throw new Error(`Unknown schema ${uri}`);
    },
    workspaceContext: { resolveRelativePath: (relative: string, resource: string) => new URL(relative, resource).href },
  });
  service.configure({ validate: true, completion: true, hover: true, hoverSchemaSource: false });
  service.registerCustomSchemaProvider(async () => (spec ? schemaUri(spec) : []));

  const claims = (document: TextDocument): boolean =>
    spec !== undefined && claimsForEditing(document.getText(), spec.catalog);

  return {
    useSpec(next) {
      spec = next;
      snippets = undefined;
    },
    current: () => spec,
    claims,
    async validate(document) {
      if (!claims(document)) return [];
      const diagnostics = await service.doValidation(document, false);
      return diagnostics.filter((d) => SCHEMA_SOURCE.test(d.source ?? '')).map((d) => ({ ...d, source: 'Conduktor' }));
    },
    async complete(document, position) {
      if (!spec) return null;
      const { catalog, schema } = spec;
      const whole = snippetCompletions(
        document,
        position,
        catalog,
        () => (snippets ??= resourceSnippets(catalog, schema, [])),
      );
      if (whole !== undefined) return whole;
      if (!claims(document)) return null;
      return onlyKindVersions(await service.doComplete(document, position, false), document, position, catalog);
    },
    async hover(document, position) {
      return claims(document) ? service.doHover(document, position) : null;
    },
  };
}
