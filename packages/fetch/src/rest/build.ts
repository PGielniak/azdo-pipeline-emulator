/**
 * Classic Build artifacts and definition lookup (E09-S03-T03).
 *
 * The fallback for artifacts the Pipelines API does not serve — a `PublishBuildArtifacts` step
 * produces a *container* artifact reachable only through the Build API — plus the name → id →
 * yaml-path lookup the parity harness needs.
 *
 * Three measured facts shape this:
 *
 *  - **`typeKey`, never the message, decides "no such artifact"** (C-E09-076). Both APIs use
 *    `ArtifactNotFoundException`, but the wording and the .NET namespace differ, so a fallback that
 *    matched on message text would work against one API and silently not the other.
 *  - **An empty artifact list is a 200, a named miss is a 404** (C-E09-075). "Published nothing" and
 *    "no artifact by that name" are two different answers from two different calls.
 *  - **The Definitions `name` filter is exact and case-insensitive, with `*` wildcards — not a
 *    prefix filter** (C-E09-077), which is the exact inverse of the Git Refs filter (C-E09-030).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AzureDevOpsClient, RestError, type RestFetch } from './client.js';
import { extractArchive } from '../repo/extract.js';
import { artifactCacheDir } from './runs.js';

/** C-E09-076: the same string from both APIs, and the only safe discriminator. */
export const ARTIFACT_NOT_FOUND_TYPE_KEY = 'ArtifactNotFoundException';

/** C-E09-074: only a container-backed artifact has a URL this machine can fetch. */
export const DOWNLOADABLE_ARTIFACT_TYPES = ['Container', 'PipelineArtifact'] as const;

export interface BuildArtifact {
  readonly id?: number;
  readonly name: string;
  readonly type?: string;
  readonly downloadUrl?: string;
  readonly data?: string;
}

export interface BuildDefinitionSummary {
  readonly id: number;
  readonly name: string;
  /** Folder path, `\` at the root. */
  readonly path?: string;
  readonly revision?: number;
  readonly queueStatus?: string;
}

/** C-E09-078: `process` and `repository` come only from the detail call. */
export interface BuildDefinitionDetail extends BuildDefinitionSummary {
  /** `process.yamlFilename`, present for a YAML definition (`process.type: 2`). */
  readonly yamlFilename?: string;
  readonly processType?: number;
  readonly repository?: {
    readonly id?: string;
    readonly name?: string;
    readonly type?: string;
    readonly defaultBranch?: string;
    readonly url?: string;
  };
}

function asSummary(value: unknown): BuildDefinitionSummary | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'number' || typeof row.name !== 'string') return undefined;
  return {
    id: row.id,
    name: row.name,
    ...(typeof row.path === 'string' ? { path: row.path } : {}),
    ...(typeof row.revision === 'number' ? { revision: row.revision } : {}),
    ...(typeof row.queueStatus === 'string' ? { queueStatus: row.queueStatus } : {}),
  };
}

/**
 * Look a definition up by name.
 *
 * C-E09-077: the filter is exact and case-insensitive and treats `*` as a wildcard, so a name
 * containing a literal `*` cannot be sent as-is — such a name is looked up by listing instead. The
 * returned name is then compared case-insensitively rather than trusting the count, because a
 * wildcard the caller did not intend would otherwise silently pick a different definition.
 */
export async function findDefinitionByName(
  client: AzureDevOpsClient,
  name: string,
): Promise<BuildDefinitionSummary | undefined> {
  const wildcarded = name.includes('*');
  const response = await client.request<{ value?: unknown }>({
    path: 'build/definitions',
    area: 'build',
    ...(wildcarded ? {} : { query: { name } }),
  });
  const value = response.body?.value;
  if (!Array.isArray(value)) return undefined;

  const folded = name.toLowerCase();
  for (const entry of value) {
    const summary = asSummary(entry);
    if (summary !== undefined && summary.name.toLowerCase() === folded) return summary;
  }
  return undefined;
}

/** Fetch a definition's detail — the only place the yaml path and repository live (C-E09-078). */
export async function getDefinition(
  client: AzureDevOpsClient,
  definitionId: number,
): Promise<BuildDefinitionDetail> {
  const response = await client.request<Record<string, unknown>>({
    path: `build/definitions/${definitionId}`,
    area: 'build',
  });
  const summary = asSummary(response.body);
  if (summary === undefined) {
    throw new RestError(`build definition ${definitionId} returned no id or name`, {
      status: response.status,
      url: `build/definitions/${definitionId}`,
    });
  }

  const process = response.body.process as { yamlFilename?: unknown; type?: unknown } | undefined;
  const repository = response.body.repository as Record<string, unknown> | undefined;

  return {
    ...summary,
    ...(typeof process?.yamlFilename === 'string' ? { yamlFilename: process.yamlFilename } : {}),
    ...(typeof process?.type === 'number' ? { processType: process.type } : {}),
    ...(repository === undefined
      ? {}
      : {
          repository: {
            ...(typeof repository.id === 'string' ? { id: repository.id } : {}),
            ...(typeof repository.name === 'string' ? { name: repository.name } : {}),
            ...(typeof repository.type === 'string' ? { type: repository.type } : {}),
            ...(typeof repository.defaultBranch === 'string'
              ? { defaultBranch: repository.defaultBranch }
              : {}),
            ...(typeof repository.url === 'string' ? { url: repository.url } : {}),
          },
        }),
  };
}

/** Convenience for the harness: one name in, id plus yaml path out (two calls, C-E09-078). */
export async function resolveDefinition(
  client: AzureDevOpsClient,
  name: string,
): Promise<BuildDefinitionDetail | undefined> {
  const summary = await findDefinitionByName(client, name);
  return summary === undefined ? undefined : getDefinition(client, summary.id);
}

function asArtifact(value: unknown): BuildArtifact | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string') return undefined;
  const resource = row.resource as Record<string, unknown> | undefined;
  return {
    name: row.name,
    ...(typeof row.id === 'number' ? { id: row.id } : {}),
    ...(typeof resource?.type === 'string' ? { type: resource.type } : {}),
    ...(typeof resource?.downloadUrl === 'string' ? { downloadUrl: resource.downloadUrl } : {}),
    ...(typeof resource?.data === 'string' ? { data: resource.data } : {}),
  };
}

/**
 * List a build's artifacts.
 *
 * C-E09-075: this is a 200 with an empty array when the build published nothing — it is *not* the
 * 404 that a named miss produces, and conflating the two would turn a normal outcome into an error.
 */
export async function listBuildArtifacts(
  client: AzureDevOpsClient,
  buildId: number,
): Promise<readonly BuildArtifact[]> {
  const response = await client.request<{ value?: unknown }>({
    path: `build/builds/${buildId}/artifacts`,
    area: 'build',
  });
  const value = response.body?.value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const artifact = asArtifact(entry);
    return artifact === undefined ? [] : [artifact];
  });
}

/** Fetch one named artifact; `undefined` when the build has no artifact by that name. */
export async function getBuildArtifact(
  client: AzureDevOpsClient,
  buildId: number,
  artifactName: string,
): Promise<BuildArtifact | undefined> {
  let response;
  try {
    response = await client.request<Record<string, unknown>>({
      path: `build/builds/${buildId}/artifacts`,
      area: 'build',
      query: { artifactName },
    });
  } catch (error) {
    // C-E09-076: decide on `typeKey`. The message differs between the two artifact APIs, so
    // matching on its text would work against one of them and silently not the other.
    if (error instanceof RestError && error.typeKey === ARTIFACT_NOT_FOUND_TYPE_KEY) {
      return undefined;
    }
    throw error;
  }
  return asArtifact(response.body);
}

export interface BuildArtifactDownload {
  readonly dir: string;
  readonly artifactName: string;
  readonly buildId: number;
  readonly bytes: number;
  readonly files: number;
}

export interface DownloadBuildArtifactOptions {
  readonly cacheDir: string;
  readonly alias: string;
  readonly buildId: number;
  readonly artifactName: string;
  readonly fetchImpl?: RestFetch;
  /** Reuses the client's credential; the container download is not anonymous, unlike Pipelines'. */
  readonly authorization: string;
}

/**
 * Download a container artifact into the same cache layout the Pipelines path writes.
 *
 * C-E09-074: `resource.type` decides whether this is even possible — a `FilePath` artifact names a
 * UNC share that does not exist on this machine, so it is refused with that reason rather than
 * attempted and failed obscurely. Unlike the Pipelines signed URL (C-E09-071), the Build
 * `downloadUrl` is an ordinary organization-scoped resource and *does* need the credential.
 */
export async function downloadBuildArtifact(
  client: AzureDevOpsClient,
  options: DownloadBuildArtifactOptions,
): Promise<BuildArtifactDownload> {
  const artifact = await getBuildArtifact(client, options.buildId, options.artifactName);
  if (artifact === undefined) {
    throw new RestError(`build ${options.buildId} has no artifact named ${options.artifactName}`, {
      url: `build/builds/${options.buildId}/artifacts`,
    });
  }
  if (artifact.downloadUrl === undefined) {
    throw new RestError(
      `artifact ${artifact.name} is a \`${artifact.type ?? 'unknown'}\` resource with no ` +
        'downloadUrl; only container-backed artifacts can be fetched locally',
      { url: `build/builds/${options.buildId}/artifacts` },
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(artifact.downloadUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: { Authorization: options.authorization, Accept: 'application/zip' },
    });
  } catch (error) {
    throw new RestError(`artifact ${artifact.name} download failed`, {
      url: 'build artifact downloadUrl',
      cause: error,
    });
  }
  if (!response.ok) {
    throw new RestError(`artifact ${artifact.name} download returned HTTP ${response.status}`, {
      status: response.status,
      url: 'build artifact downloadUrl',
    });
  }

  const dir = artifactCacheDir(
    options.cacheDir,
    options.alias,
    options.buildId,
    options.artifactName,
  );
  await mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(join(dir, 'artifact.zip'), bytes);
  const extracted = await extractArchive(bytes, 'zip', dir);

  return {
    dir,
    artifactName: options.artifactName,
    buildId: options.buildId,
    bytes: bytes.length,
    files: extracted.files,
  };
}
