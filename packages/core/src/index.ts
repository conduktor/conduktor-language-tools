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
export {
  ConsoleError,
  describeError,
  listProblem,
  NetworkError,
  UnexpectedResponseError,
  type ListProblem,
} from './client/errors';
export {
  capabilityOf,
  describeToken,
  UnsupportedTokenError,
  type Capability,
  type TokenInfo,
} from './client/tokenInfo';
export { ConsoleClient, normaliseBaseUrl, type ConsoleClientOptions, type RequestEvent } from './client/consoleClient';
export {
  apiVersionFixes,
  catalogDocuments,
  claimsForEditing,
  parseResourceDocuments,
  type ParseOptions,
  type ResourceDocument,
} from './resources/parseDocuments';
export { expandIncludes, IncludeError } from './resources/includes';
export { documentAt, parsedDocuments, type ParsedDocument } from './resources/parsedDocuments';
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
export { outcomeLabel, outcomeProblems, summarise } from './plan/summary';
export { comparableYaml, newResourceName, newResourceYaml } from './resources/yamlText';
export { prettySchema } from './resources/prettySchema';
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
export { agentInstructions, conduktorTools } from './tools/definitions';
export { ToolError, type ToolContext, type ToolDefinition } from './tools/types';
export { containedFile, includeRoot, isInside, workspaceFile } from './tools/workspacePath';
export { planDocuments } from './plan/planDocuments';
export { referencedVariables } from './resources/envVars';
export { envSearchPath, fileVariables, parseDotenv } from './resources/dotenv';
export {
  baseDir,
  basePathOf,
  environmentDir,
  environmentName,
  ENVIRONMENTS_DIR,
  migrationPaths,
  planMigration,
  planRootMove,
  rootMovePaths,
  STATE_DIR,
  type Move,
} from './sync/layout';
export {
  bootstrapProgress,
  collectResources,
  describeBootstrap,
  eachLimit,
  type BootstrapResult,
  type BootstrapStage,
  type CollectOptions,
  type Fetched,
  type Skipped,
} from './sync/bootstrap';
export { ENV_EXAMPLE, envExample } from './sync/envExample';
export { syncPath } from './sync/paths';
export {
  defaultKinds,
  environments,
  folderNameProblem,
  REPO_CONFIG,
  resolveEnvironment,
  withEnvironment,
  type EnvironmentConfig,
} from './sync/repoConfig';
export { withSecretPlaceholders } from './sync/placeholders';
export { collapseIncludes, expandedText, includeRestores, statusWithIncludes } from './sync/includedStatus';
export { driftOf, syncStatus, type Drift, type SyncStatus } from './sync/status';
export { findReferences, referenceAt, type Reference } from './references/extract';
export { describeSources, NameIndex, type NameSource } from './references/nameIndex';
export {
  collides,
  matcher,
  overlapsOf,
  patternTraps,
  patternTypeOf,
  type Instance,
  type OwnedResource,
  type PatternReading,
  type PatternType,
} from './references/patterns';
export { referencingKinds, referrersOf, type Reach, type ReferenceTarget } from './references/reverse';
export { REFERENCE_RULES, type ReferenceRule } from './references/table';
export { instanceOf, referenceProblems, type NameLookup, type ReferenceProblem } from './references/problems';
export { blankDocumentAt } from './templates/blank';
export { fromTemplate, templateDocument, templateName } from './templates/fromTemplate';
export { fixedNames, skeletonYaml } from './templates/skeleton';
export { snippetOf, snippetVariants } from './templates/snippet';
export { resourceSnippets, type ResourceSnippet } from './templates/resourceSnippets';
export { nextChoice, type Answers, type Choice } from './templates/variants';
export {
  cliCommand,
  cliEnvironment,
  CTL_VERSION,
  ctlArgs,
  DEFAULT_CTL_IMAGE,
  type CliCommand,
  type CliRunnerChoice,
} from './cli/command';
export { DiffMarkers } from './cli/diffMarkers';
export { readCliOutput, type CliOutcome } from './cli/output';
export { fieldDocs, kindDoc, REFERENCE_URL } from './fieldDocs/lookup';
export { headingSlug, parseReferencePage, type FieldDoc, type KindDoc } from './fieldDocs/mdx';
export { fieldHover, kindHover, markdownCode } from './fieldDocs/hover';
export { checkTopicConfig, configChoices, type TopicConfigProblem } from './topicConfigs/check';
export { topicConfigContext, type TopicConfigContext } from './topicConfigs/context';
export { parseKafkaTopicConfigs, type TopicConfigDoc } from './topicConfigs/kafkaDocs';
export { configValueYaml, topicConfig, TOPIC_CONFIGS } from './topicConfigs/lookup';
export { applyPreset, presetFromTemplate, TOPIC_PRESETS, type TopicPreset } from './topicConfigs/presets';
export {
  configKeySnippet,
  configMarkdown,
  topicConfigProblems,
  type TopicConfigRangeProblem,
} from './topicConfigs/editor';
export { setFields, type FieldValue } from './resources/setFields';
export { closest, editBetween, scalarYaml, type Fix, type TextEdit } from './fixes';
export { resourceSymbol, resourceSymbols, type ResourceSymbol } from './resources/symbols';
export { renameEdits } from './references/rename';
