export { isRecord } from './util';
export { expandEnvVars, type EnvExpansion } from './resources/envVars';
export type { JsonSchema, OpenApiDoc } from './openapi/types';
export { InvalidOpenApiError, parseOpenApi } from './openapi/parseOpenApi';
export { COMPONENT_REF, DEFAULT_ORDER, KindCatalog, type KindVersion } from './openapi/kindCatalog';
export { itemPath, listPath, MissingParentError, parentsOf, upsertTarget, type Target } from './openapi/paths';
export type { Resource, UpsertResponse, UpsertResult } from './resources/types';
export { buildResourceSchema } from './openapi/schemaBuilder';
