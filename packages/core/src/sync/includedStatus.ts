import { parse, stringify } from 'yaml';
import { expandIncludes } from '../resources/includes';
import type { Resource } from '../resources/types';
import { isRecord } from '../util';
import { syncStatus, type SyncStatus } from './status';

const SCHEMA_FILE = 'schemaFile';
const DESCRIPTION_FILE = 'conduktor.io/descriptionFile';
const DESCRIPTION = 'conduktor.io/description';

/** The resource with its included files read in, as YAML; undefined when it includes nothing or cannot be read. */
export function expandedText(text: string, readInclude: (path: string) => string): string | undefined {
  const resource = resourceOf(text);
  if (!resource || includes(resource).length === 0) return undefined;
  try {
    return stringify(expandIncludes(resource, readInclude));
  } catch {
    return undefined;
  }
}

/**
 * A file's status counting what its included files hold: against the expanded copy recorded when it was applied, or
 * (for a base applied before that copy existed) against the base expanded with today's files. A file that includes
 * nothing reads exactly as before.
 */
export function statusWithIncludes(
  local: string,
  base: string | undefined,
  applied: string | undefined,
  readInclude: (path: string) => string,
): SyncStatus {
  if (base === undefined) return 'new';
  const expanded = expandedText(local, readInclude);
  if (expanded === undefined) return syncStatus(local, base);
  return syncStatus(expanded, applied ?? expandedText(base, readInclude) ?? base);
}

/** The included files a discard writes back, with what they held when the base was applied. */
export function includeRestores(base: string, applied: string): { path: string; content: string }[] {
  const from = resourceOf(base);
  const to = resourceOf(applied);
  if (!from || !to) return [];
  return includes(from).flatMap(({ path, field }) => {
    const content = field === SCHEMA_FILE ? specOf(to).schema : labelsOf(to)[DESCRIPTION];
    return typeof content === 'string' ? [{ path, content }] : [];
  });
}

/**
 * What the Console holds, laid out the way the local file is: content its includes point at goes back into those
 * files, and the YAML keeps the references in place of the content.
 */
export function collapseIncludes(
  live: Resource,
  local: string,
): { resource: Resource; writes: { path: string; content: string }[] } {
  const current = resourceOf(local);
  const writes: { path: string; content: string }[] = [];
  let resource = live;
  for (const { path, field } of current ? includes(current) : []) {
    if (field === SCHEMA_FILE && typeof specOf(resource).schema === 'string') {
      writes.push({ path, content: specOf(resource).schema as string });
      resource = { ...resource, spec: renamed(specOf(resource), 'schema', SCHEMA_FILE, path) };
    } else if (field === DESCRIPTION_FILE && typeof labelsOf(resource)[DESCRIPTION] === 'string') {
      writes.push({ path, content: labelsOf(resource)[DESCRIPTION] as string });
      const labels = renamed(labelsOf(resource), DESCRIPTION, DESCRIPTION_FILE, path);
      resource = { ...resource, metadata: { ...resource.metadata, labels } };
    }
  }
  return { resource, writes };
}

// The key swapped in place, so the YAML keeps its order.
function renamed(map: Record<string, unknown>, from: string, to: string, value: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(map).map(([key, v]) => (key === from ? [to, value] : [key, v])));
}

function includes(resource: Resource): { path: string; field: string }[] {
  const schemaFile = resource.kind === 'Subject' ? specOf(resource)[SCHEMA_FILE] : undefined;
  const descriptionFile = resource.kind === 'Topic' ? labelsOf(resource)[DESCRIPTION_FILE] : undefined;
  return [
    ...(typeof schemaFile === 'string' ? [{ path: schemaFile, field: SCHEMA_FILE }] : []),
    ...(typeof descriptionFile === 'string' ? [{ path: descriptionFile, field: DESCRIPTION_FILE }] : []),
  ];
}

function resourceOf(text: string): Resource | undefined {
  try {
    const value: unknown = parse(text);
    return isRecord(value) && isRecord(value.metadata) ? (value as Resource) : undefined;
  } catch {
    return undefined;
  }
}

function specOf(resource: Resource): Record<string, unknown> {
  return isRecord(resource.spec) ? resource.spec : {};
}

function labelsOf(resource: Resource): Record<string, unknown> {
  return isRecord(resource.metadata.labels) ? resource.metadata.labels : {};
}
