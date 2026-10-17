import { scalarYaml, type TextEdit } from '../fixes';
import type { KindCatalog } from '../openapi/kindCatalog';
import { rangeOf, type YamlPath } from '../resources/yamlPaths';
import { isRecord } from '../util';
import { referrersOf, type ReferenceTarget } from './reverse';

/**
 * The edits that rename a resource: its name wherever a document defines it, and each reference that names it in its
 * own scope. Patterns, `*`, and references in every cluster at once are left as written, and counted: they may cover
 * other resources too, or no longer cover this one.
 */
export function renameEdits(
  target: ReferenceTarget,
  newName: string,
  documents: readonly { text: string; resource: unknown }[],
  catalog: KindCatalog,
): { edits: { index: number; edit: TextEdit }[]; patterns: number } {
  const edits: { index: number; edit: TextEdit }[] = [];
  const replace = (index: number, path: YamlPath) => {
    const text = documents[index]?.text ?? '';
    const range = rangeOf(text, path);
    if (range)
      edits.push({
        index,
        edit: { start: range[0], end: range[1], newText: scalarYaml(newName, text.slice(range[0], range[1])) },
      });
  };
  const params = catalog.latest(target.kind)?.parentPathParams ?? [];
  documents.forEach(({ resource }, index) => {
    if (defines(resource, target, params)) replace(index, ['metadata', 'name']);
  });
  let patterns = 0;
  const referrers = referrersOf(
    target,
    documents.map((document) => document.resource),
    catalog,
  );
  for (const { index, reference, how } of referrers) {
    if (how === 'names' && target.parents.every((parent, i) => reference.scope[i] === parent))
      replace(index, reference.path);
    else patterns++;
  }
  return { edits, patterns };
}

function defines(resource: unknown, target: ReferenceTarget, params: readonly string[]): boolean {
  if (!isRecord(resource) || resource.kind !== target.kind || !isRecord(resource.metadata)) return false;
  const { metadata } = resource;
  return metadata.name === target.name && params.every((param, i) => metadata[param] === target.parents[i]);
}
