import { describeError } from '../client/errors';
import { isRecord } from '../util';
import type { Resource } from './types';

const DESCRIPTION_FILE = 'conduktor.io/descriptionFile';
const DESCRIPTION = 'conduktor.io/description';

export class IncludeError extends Error {
  override name = 'IncludeError';
}

export function expandIncludes(resource: Resource, readInclude?: (path: string) => string): Resource {
  const { spec } = resource;
  if (resource.kind === 'Subject' && isRecord(spec) && typeof spec.schemaFile === 'string') {
    const { schemaFile, ...rest } = spec;
    return { ...resource, spec: { ...rest, schema: read(schemaFile, readInclude) } };
  }
  const { labels } = resource.metadata;
  if (resource.kind === 'Topic' && isRecord(labels) && typeof labels[DESCRIPTION_FILE] === 'string') {
    const { [DESCRIPTION_FILE]: descriptionFile, ...rest } = labels;
    return {
      ...resource,
      metadata: {
        ...resource.metadata,
        labels: { ...rest, [DESCRIPTION]: read(descriptionFile as string, readInclude) },
      },
    };
  }
  return resource;
}

function read(path: string, readInclude: ((path: string) => string) | undefined): string {
  if (!readInclude) {
    throw new IncludeError(`${path} is read from a file; save the YAML as a file to use it`);
  }
  try {
    return readInclude(path);
  } catch (error) {
    throw new IncludeError(`Failed to read ${path}: ${describeError(error)}`);
  }
}
