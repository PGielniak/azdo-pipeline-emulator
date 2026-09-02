/**
 * Variable groups — **names only** (E09-S03-T04).
 *
 * The API volunteers non-secret values in plaintext (C-E09-080): the page's own sample shows
 * `"key1": {"value": "value1"}` next to `"key2": {"value": null, "isSecret": true}`, and the live
 * organization confirms it. So "never fetch variable-group values" (docs/05 §1, decision
 * 2026-07-30) is something this module **does**, not something the service does for it.
 *
 * The enforcement is structural rather than conventional (C-E09-084): `GroupVariable` has **no
 * value field**, and the value is dropped at the parse boundary. Carrying it and filtering later
 * would leave a window in which a log line, an error, or a cache write could see it; dropping it
 * here means there is nothing to leak, and a test can prove it by asserting the plaintext string
 * appears nowhere in the result or its `JSON.stringify`.
 *
 * One shape trap (C-E09-081): `isSecret` is **absent** on a non-secret variable, never `false`, so
 * `v.isSecret === false` is a check that never fires.
 */

import { AzureDevOpsClient } from './client.js';

export interface GroupVariable {
  readonly name: string;
  /** C-E09-081: `undefined` in the response means "not secret"; normalized to a boolean here. */
  readonly isSecret: boolean;
  readonly isReadOnly: boolean;
}

export interface VariableGroupNames {
  readonly id: number;
  readonly name: string;
  readonly description?: string;
  /** `Vsts` for an inline group; something else for a key-vault-backed one (C-E09-083). */
  readonly type?: string;
  readonly isShared?: boolean;
  /** Sorted by name so the emitted `.env.example` block is stable across fetches. */
  readonly variables: readonly GroupVariable[];
}

/**
 * Parse one group, discarding every value.
 *
 * Exported because the discard is the task's whole contract: a test drives this directly with a
 * body containing a plaintext value and proves the value cannot come back out.
 */
export function parseVariableGroup(value: unknown): VariableGroupNames | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const group = value as Record<string, unknown>;
  if (typeof group.id !== 'number' || typeof group.name !== 'string') return undefined;

  const variables: GroupVariable[] = [];
  const members = group.variables;
  if (members !== null && typeof members === 'object' && !Array.isArray(members)) {
    for (const [name, raw] of Object.entries(members as Record<string, unknown>)) {
      const member =
        raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      // `member.value` is read by nothing here, deliberately: it is never copied anywhere.
      variables.push({
        name,
        isSecret: member.isSecret === true,
        isReadOnly: member.isReadOnly === true,
      });
    }
  }
  variables.sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: group.id,
    name: group.name,
    ...(typeof group.description === 'string' ? { description: group.description } : {}),
    ...(typeof group.type === 'string' ? { type: group.type } : {}),
    ...(typeof group.isShared === 'boolean' ? { isShared: group.isShared } : {}),
    variables,
  };
}

/**
 * Fetch one variable group by name.
 *
 * C-E09-082: `groupName` treats `*` as a wildcard, so a name containing one is not sent as a filter
 * — the same trap as the Definitions `name` filter (C-E09-077) — and the returned name is verified
 * rather than the count trusted.
 */
export async function getVariableGroup(
  client: AzureDevOpsClient,
  groupName: string,
): Promise<VariableGroupNames | undefined> {
  const wildcarded = groupName.includes('*');
  const response = await client.request<{ value?: unknown }>({
    path: 'distributedtask/variablegroups',
    area: 'distributedtask',
    ...(wildcarded ? {} : { query: { groupName } }),
  });
  const value = response.body?.value;
  if (!Array.isArray(value)) return undefined;

  const folded = groupName.toLowerCase();
  for (const entry of value) {
    const group = parseVariableGroup(entry);
    if (group !== undefined && group.name.toLowerCase() === folded) return group;
  }
  return undefined;
}

/** Fetch several groups, reporting the ones that do not exist rather than failing. */
export async function getVariableGroups(
  client: AzureDevOpsClient,
  groupNames: readonly string[],
): Promise<{ groups: readonly VariableGroupNames[]; missing: readonly string[] }> {
  const groups: VariableGroupNames[] = [];
  const missing: string[] = [];
  for (const name of groupNames) {
    const group = await getVariableGroup(client, name);
    if (group === undefined) missing.push(name);
    else groups.push(group);
  }
  return { groups, missing };
}

/**
 * Render the `.env.example` block for a fetched group.
 *
 * Names and secret flags only — there is no value to render, because `GroupVariable` never had one.
 * A secret member is annotated so the reader knows the service would not have supplied its value
 * either (C-E09-080).
 */
export function envExampleBlock(group: VariableGroupNames): readonly string[] {
  const lines = [
    `# Variable group '${group.name}' (id ${group.id}) — names only; ` +
      'azdo-emu never fetches values (docs/05 §1)',
  ];
  if (group.variables.length === 0) {
    lines.push(`# (group '${group.name}' declares no variables)`);
    return lines;
  }
  for (const variable of group.variables) {
    const notes = [
      ...(variable.isSecret ? ['secret'] : []),
      ...(variable.isReadOnly ? ['read-only'] : []),
    ];
    lines.push(`${variable.name}=${notes.length === 0 ? '' : `   # ${notes.join(', ')}`}`);
  }
  return lines;
}
