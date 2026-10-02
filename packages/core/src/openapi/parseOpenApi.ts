import { parse } from 'yaml';
import { isRecord } from '../util';
import type { OpenApiDoc } from './types';

export class InvalidOpenApiError extends Error {
  override name = 'InvalidOpenApiError';
}

export function parseOpenApi(text: string): OpenApiDoc {
  let doc: unknown;
  try {
    doc = parse(text, { maxAliasCount: -1 });
  } catch (error) {
    throw new InvalidOpenApiError(`Not a YAML document: ${(error as Error).message}`);
  }
  if (!isRecord(doc) || typeof doc.openapi !== 'string' || !isRecord(doc.paths)) {
    throw new InvalidOpenApiError('Not an OpenAPI document');
  }
  return doc as unknown as OpenApiDoc;
}
