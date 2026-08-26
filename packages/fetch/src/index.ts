// @azdo-emu/fetch — REST clients. Oracle (preview endpoint) landed in E00-S03-T02;
// the expansion service (convert-time expansion step) in E00-S04-T01, its cache/lockfile in
// E00-S04-T02; auth/artifact fetchers land in E09.
export const PACKAGE_NAME = '@azdo-emu/fetch';

export {
  DEFAULT_API_VERSION,
  ORACLE_ENV_VARS,
  OracleUsageError,
  authorizationHeader,
  configFromEnv,
  organizationName,
  preview,
  previewUrl,
  redact,
  type OracleConfig,
  type PreviewOutcome,
  type PreviewRequest,
} from './oracle.js';

export {
  expand,
  expansionRequestHash,
  serializeTemplateParameters,
  provenanceFor,
  type ExpansionOutcome,
  type ExpansionProvenance,
  type ExpansionRequest,
  type FetchLike,
} from './expand.js';

// E12-S01-T01's expansion gate: the arm selector `convert` binds (E10-S02-T01).
export {
  ExpansionConfigMissingError,
  OfflineExpansionUnavailableError,
  OFFLINE_EXPANSION_WARNING,
  resolveExpansion,
  type ExpansionManifestEntry,
  type ExpansionMode,
  type OfflineExpander,
  type OfflineExpansion,
  type ResolveExpansionOptions,
  type ResolvedExpansion,
} from './expansion-source.js';

export {
  ExpansionCacheMissError,
  ExpansionError,
  cacheExpansion,
  expandCached,
  expansionCacheDir,
  finalYamlHash,
  readCachedExpansion,
  writeExpansionLockfileEntry,
  type CachedExpansion,
  type ExpandCachedOptions,
  type ExpansionLockEntry,
} from './expansion-cache.js';
