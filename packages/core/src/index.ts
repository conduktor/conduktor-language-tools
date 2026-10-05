export { isRecord, kebabCase } from './util';
export { expandEnvVars, type EnvExpansion } from './resources/envVars';
export type { JsonSchema, OpenApiDoc } from './openapi/types';
export { InvalidOpenApiError, parseOpenApi } from './openapi/parseOpenApi';
export { COMPONENT_REF, DEFAULT_ORDER, KindCatalog, type KindVersion } from './openapi/kindCatalog';
export {
  itemPath,
  listPath,
  MissingParentError,
  parentsOf,
  resourcePath,
  upsertTarget,
  type Target,
} from './openapi/paths';
export type { Resource, UpsertResponse, UpsertResult } from './resources/types';
export { buildResourceSchema } from './openapi/schemaBuilder';
export { ConsoleError, describeError, NetworkError } from './client/errors';
export {
  capabilityOf,
  describeToken,
  UnsupportedTokenError,
  type Capability,
  type TokenInfo,
} from './client/tokenInfo';
export { ConsoleClient, normaliseBaseUrl, type ConsoleClientOptions, type RequestEvent } from './client/consoleClient';
export {
  catalogDocuments,
  parseResourceDocuments,
  type ParseOptions,
  type ResourceDocument,
} from './resources/parseDocuments';
export { expandIncludes, IncludeError } from './resources/includes';
export { sortForApply } from './resources/ordering';
export { buildSpec, loadSpec, type LoadedSpec, type SpecCache, type SpecSource } from './openapi/loadSpec';
export {
  upsertDocuments,
  type ReadInclude,
  type UpsertItem,
  type UpsertOptions,
  type UpsertOutcome,
} from './plan/upsertDocuments';
export { splitPolicyMessages } from './plan/messages';
export { comparableYaml, newResourceName, newResourceYaml } from './resources/yamlText';
export { rangeOf, scalarRanges, valueAt, type ScalarRange, type ValueAt, type YamlPath } from './resources/yamlPaths';
export type { ConnectionMode } from './connectionMode';
export { PARENT_KINDS } from './openapi/parents';
export { kindSchema } from './openapi/kindSchema';
export {
  agentInstructions,
  conduktorTools,
  isInside,
  ToolError,
  workspaceFile,
  type ToolContext,
  type ToolDefinition,
} from './tools';
export { planDocuments } from './plan/planDocuments';
export { referencedVariables } from './resources/envVars';
export {
  baseDir,
  collectResources,
  defaultKinds,
  describeBootstrap,
  eachLimit,
  driftOf,
  ENV_EXAMPLE,
  envExample,
  environments,
  REPO_CONFIG,
  withEnvironment,
  type EnvironmentConfig,
  environmentDir,
  environmentName,
  ENVIRONMENTS_DIR,
  migrationPaths,
  planMigration,
  planRootMove,
  resolveEnvironment,
  rootMovePaths,
  STATE_DIR,
  syncPath,
  syncStatus,
  withSecretPlaceholders,
  type BootstrapResult,
  type CollectOptions,
  type Drift,
  type Fetched,
  type Skipped,
  type Move,
  type SyncStatus,
} from './sync';
export {
  collides,
  describeSources,
  findReferences,
  matcher,
  NameIndex,
  overlapsOf,
  patternTraps,
  patternTypeOf,
  referenceAt,
  REFERENCE_RULES,
  referencingKinds,
  referrersOf,
  type Instance,
  type NameSource,
  type OwnedResource,
  type PatternReading,
  type PatternType,
  type Reach,
  type Reference,
  type ReferenceRule,
  type ReferenceTarget,
} from './references';
export {
  blankDocumentAt,
  fixedNames,
  fromTemplate,
  nextChoice,
  skeletonYaml,
  snippetOf,
  snippetVariants,
  templateDocument,
  templateName,
  type Answers,
  type Choice,
} from './templates';
export {
  checkTopicConfig,
  parseKafkaTopicConfigs,
  topicConfig,
  TOPIC_CONFIGS,
  type TopicConfigDoc,
  type TopicConfigProblem,
} from './topicConfigs';
