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
export {
  fieldAt,
  rangeOf,
  scalarRanges,
  valueAt,
  type ScalarRange,
  type ValueAt,
  type YamlPath,
} from './resources/yamlPaths';
export { canChange, migrateMode, type ConnectionMode } from './connectionMode';
export { PARENT_KINDS } from './openapi/parents';
export { kindSchema } from './openapi/kindSchema';
export { schemaAt, type FieldSchema } from './openapi/schemaAt';
export {
  agentInstructions,
  conduktorTools,
  containedFile,
  isInside,
  ToolError,
  workspaceFile,
  type ToolContext,
  type ToolDefinition,
} from './tools';
export { planDocuments } from './plan/planDocuments';
export { referencedVariables } from './resources/envVars';
export { envSearchPath, parseDotenv } from './resources/dotenv';
export {
  baseDir,
  basePathOf,
  bootstrapProgress,
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
  folderNameProblem,
  resolveEnvironment,
  rootMovePaths,
  STATE_DIR,
  syncPath,
  syncStatus,
  collapseIncludes,
  expandedText,
  includeRestores,
  statusWithIncludes,
  withSecretPlaceholders,
  type BootstrapResult,
  type BootstrapStage,
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
  cliCommand,
  cliEnvironment,
  CTL_VERSION,
  ctlArgs,
  DEFAULT_CTL_IMAGE,
  readCliOutput,
  type CliCommand,
  type CliOutcome,
  type CliRunnerChoice,
} from './cli';
export {
  fieldDocs,
  headingSlug,
  kindDoc,
  parseReferencePage,
  REFERENCE_URL,
  type FieldDoc,
  type KindDoc,
} from './fieldDocs';
export {
  applyPreset,
  checkTopicConfig,
  configValueYaml,
  parseKafkaTopicConfigs,
  presetFromTemplate,
  topicConfig,
  topicConfigContext,
  TOPIC_CONFIGS,
  TOPIC_PRESETS,
  type TopicConfigContext,
  type TopicConfigDoc,
  type TopicPreset,
  type TopicConfigProblem,
} from './topicConfigs';
export { setFields, type FieldValue } from './resources/setFields';
