// @azdo-emu/fetch — REST clients. Oracle (preview endpoint) landed in E00-S03-T02;
// auth/artifact fetchers land in E08.
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
