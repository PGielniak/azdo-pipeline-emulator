/**
 * Expanded-YAML normalizer (E03-S05-T01) — the canonicalization both sides of `preview-diff` pass
 * through before they are compared (docs/02 §8, docs/06 §3 L3).
 *
 * **What this is for.** Our expansion and the service's `finalYaml` can be the same pipeline and
 * still differ as text: key order, quoting, and a handful of shapes the schema accepts in more
 * than one form. Every such difference that is *not* a semantic difference has to be erased here,
 * or the nightly parity job reports drift that isn't there and stops being read.
 *
 * **What this is not for.** It does not expand anything. The service wraps a `steps:`-only
 * document in `stages: __default` / `job: Job` (C-E00-022) and desugars step shortcuts into tasks
 * (C-E12-019) — those are *expansion* behaviours that E03-S01..S04 must reproduce, and doing them
 * here instead would let a broken expander pass the diff. The rule of thumb: a rule belongs here
 * only when both texts are legitimate spellings of one pipeline, not when one side is missing work.
 *
 * **Why the target shape is the service's.** Re-submitting a committed `finalYaml` as
 * `yamlOverride` returns it byte-for-byte — a fixpoint — for all ten corpus entries, once the one
 * output-only shape is undone (C-E03-001/002). So `finalYaml` is a canonical form of the service's
 * own making, and normalization maps our side onto it rather than inventing a third form.
 *
 * Every rule below cites the corpus sample that motivated it; the catalogue lives in
 * `research/E03-normalizer.md` and the evidence in `research/experiments/E03-normalizer/`.
 */
import { stringify } from 'yaml';

import { parsePipelineYaml, type PipelineNode } from '../frontend/parse.js';

/**
 * Canonical form: strings at the leaves, plus lists and mappings. `null` is kept **distinct from
 * the empty string** — a key present with no value and a key set to `''` are different documents,
 * and folding them would hide exactly the kind of drift this layer exists to catch.
 */
export type Canonical = string | null | Canonical[] | { [key: string]: Canonical };

export interface NormalizerRule {
  readonly id: string;
  readonly title: string;
  /** Claim backing the rule (BACKLOG §3) — no rule exists without one. */
  readonly claim: string;
}

/**
 * The rule table. Order is documentation, not execution order; `applied` in the result names the
 * rules a given document actually exercised, which is what the tests assert against.
 */
export const RULES: readonly NormalizerRule[] = [
  { id: 'N1', title: 'trigger/pr disable form: `none` → `{enabled: false}`', claim: 'C-E03-002' },
  { id: 'N2', title: 'mapping-form `variables:` → `- name:/value:` list form', claim: 'C-E12-021' },
  { id: 'N3', title: 'scalar `dependsOn` → one-element list', claim: 'C-E12-021' },
  { id: 'N4', title: 'scalar `environment:` → `{name}`', claim: 'C-E12-017' },
  { id: 'N5', title: 'scalar `container:`/`services.<k>` → `{alias}`', claim: 'C-E03-003' },
  { id: 'N6', title: 'task reference: known GUID ↔ name spellings unified', claim: 'C-E12-019' },
  { id: 'N7', title: 'scalar leaves compared as strings (null preserved)', claim: 'C-E01-020' },
  { id: 'N8', title: 'key order and insignificant whitespace/quoting erased', claim: 'C-E03-001' },
] as const;

/**
 * Task references the service emits as a GUID that also have a name spelling. Canonical form is
 * the **name**, because that is what a human wrote and what our emitter carries.
 *
 * Only one entry is grounded: `ecdc45f6…` resolves in the live task catalogue to
 * `PublishPipelineArtifact` (C-E12-019). The `checkout` (`6d15af64…`) and `download`
 * (`30f35852…`) GUIDs are deliberately **absent**: they are agent-internal, return 404 from
 * `GET _apis/distributedtask/tasks/{guid}`, and have no name spelling to unify with — inventing
 * one here would make the diff lie. Note also that `download:` and `DownloadPipelineArtifact@2`
 * are genuinely *different* tasks, so they must not be folded together.
 */
export const TASK_GUID_NAMES: Readonly<Record<string, string>> = {
  'ecdc45f6-832d-4ad9-b52b-ee49e94659be': 'PublishPipelineArtifact',
};

export interface NormalizedDocument {
  /** Canonical structure — path-addressable, for E03-S05-T02's semantic diff. */
  readonly value: Canonical;
  /** Canonical text — stable serialization of `value`, for text diffs and snapshots. */
  readonly text: string;
  /** Rule ids this document actually exercised, sorted. */
  readonly applied: readonly string[];
  /** Parse errors; when non-empty `value` is whatever could still be composed. */
  readonly errors: readonly { code: string; message: string }[];
}

/** DOM → plain structure, before any rule runs. Scalars become strings (N7). */
function plain(node: PipelineNode | undefined): Canonical {
  if (node === undefined) return '';
  switch (node.kind) {
    case 'scalar':
      // Pipeline values are strings: the schema accepts YAML booleans and numbers in value
      // positions and the service treats them as text (C-E01-020), so `fetchDepth: 1` and
      // `fetchDepth: '1'` are the same pipeline and must not diff. The rule is applied to *every*
      // leaf rather than to a list of known-numeric keys, which is deliberate but broad: it is
      // sound only while "pipeline values are strings" holds everywhere. Every numeric/boolean
      // leaf in the corpus goldens (`retryCountOnTaskFailure`, `timeoutInMinutes`, variable
      // `value:`, `readonly`, `condition: false`) sits in such a position. `null` is exempt.
      return node.value === null ? null : String(node.value);
    case 'sequence':
      return node.items.map(plain);
    case 'mapping': {
      const out: Record<string, Canonical> = {};
      for (const { key, value } of node.entries) out[String(key.value)] = plain(value);
      return out;
    }
  }
}

const isMap = (v: Canonical): v is Record<string, Canonical> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** `variables:` as a mapping → the list form the service always emits (N2). */
function variablesToList(value: Canonical): Canonical {
  if (!isMap(value)) return value;
  return Object.entries(value).map(([name, v]) => ({ name, value: v }));
}

/** `<name>@<version>` where `<name>` is a known GUID → the name spelling (N6). */
function canonicalTaskRef(ref: string): string {
  const at = ref.lastIndexOf('@');
  const id = (at === -1 ? ref : ref.slice(0, at)).toLowerCase();
  const name = TASK_GUID_NAMES[id];
  return name === undefined ? ref : at === -1 ? name : `${name}${ref.slice(at)}`;
}

/**
 * Apply the shape rules. `at` is the key that owns `value`, which is what makes the rules
 * position-sensitive rather than a blind rewrite of every `name`-ish scalar in the document.
 */
function applyRules(value: Canonical, at: string | undefined, applied: Set<string>): Canonical {
  // Items do **not** inherit `at`: the promotion rules below key off the owning mapping key, and
  // letting a list's items see it re-wraps a value that is already in canonical form
  // (`dependsOn: [a]` → `[[a]]`, and again on every pass). Idempotence over the corpus goldens is
  // what caught this.
  if (Array.isArray(value)) return value.map((item) => applyRules(item, undefined, applied));

  if (value === null) return value;

  if (!isMap(value)) {
    switch (at) {
      // `trigger: none` / `pr: none` is the authored spelling of what the service returns as
      // `{enabled: false}` — and the *only* shape it emits but refuses to read back (C-E03-002).
      case 'trigger':
      case 'pr':
        if (value === 'none') {
          applied.add('N1');
          return { enabled: 'false' };
        }
        return value;
      case 'dependsOn':
        applied.add('N3');
        return [value];
      case 'environment':
        applied.add('N4');
        return { name: value };
      case 'container':
        applied.add('N5');
        return { alias: value };
      case 'task':
        {
          const canonical = canonicalTaskRef(value);
          if (canonical !== value) {
            applied.add('N6');
            return canonical;
          }
        }
        return value;
      default:
        return value;
    }
  }

  const out: Record<string, Canonical> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'variables' && isMap(child)) {
      applied.add('N2');
      out[key] = applyRules(variablesToList(child), key, applied);
      continue;
    }
    if (key === 'services' && isMap(child)) {
      // `services: {redis: builder}` → `{redis: {alias: builder}}`: the same `{alias}` promotion
      // as `container:`, one level deeper (C-E03-003).
      const services: Record<string, Canonical> = {};
      for (const [alias, target] of Object.entries(child)) {
        if (typeof target === 'string') {
          applied.add('N5');
          services[alias] = { alias: target };
        } else services[alias] = applyRules(target, alias, applied);
      }
      out[key] = services;
      continue;
    }
    out[key] = applyRules(child, key, applied);
  }
  return out;
}

/** Sort mapping keys everywhere (N8). Sequence order is semantic and is never touched. */
function sortKeys(value: Canonical): Canonical {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isMap(value)) return value;
  const out: Record<string, Canonical> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key] as Canonical);
  return out;
}

/**
 * Normalize one expanded-YAML document. Idempotent by construction: the result is re-parseable
 * and normalizing it again is a no-op — asserted over every corpus golden.
 */
export function normalizeExpandedYaml(source: string, file = 'pipeline.yml'): NormalizedDocument {
  const parsed = parsePipelineYaml(source, file);
  const applied = new Set<string>(['N7', 'N8']); // both apply to every document, unconditionally
  const value = sortKeys(applyRules(plain(parsed.root), undefined, applied));
  return {
    value,
    text: canonicalText(value),
    applied: [...applied].sort(),
    errors: parsed.errors.map(({ code, message }) => ({ code, message })),
  };
}

/** Stable serialization: keys already sorted, no line wrapping, no reflowed block scalars. */
export function canonicalText(value: Canonical): string {
  return stringify(value, { lineWidth: 0, blockQuote: 'literal', nullStr: '' });
}
