/**
 * E03-S04-T04 — the normalization-time expansions the offline arm was missing.
 *
 * The directive passes and interpolation are not the whole of what the service does while producing
 * `finalYaml`. Three more rewrites happen, and without them an offline expansion is a different
 * document from the service's for the same input — which is exactly the drift the nightly parity
 * job exists to catch, reported as our bug rather than as a missing feature.
 *
 * All three are already measured; this module is their implementation, not their discovery:
 *
 *  1. **Implicit structure.** A `steps:`-only document becomes
 *     `stages: - stage: __default` → `jobs: - job: Job`, and a `jobs:`-only document gets the
 *     `__default` stage alone (C-E00-022). The asymmetry in where `pool:` lands is measured, not
 *     inferred: with a `steps:` root it moves **into the synthesized job**, and with a `jobs:` root
 *     it **stays at the root** (C-E03-259).
 *  2. **`trigger:`/`pr:` `none`.** The authored scalar becomes `{enabled: false}` — the one
 *     output-only shape, which the service then refuses as input (C-E03-002).
 *  3. **Step shorthands.** Every documented shorthand becomes `task: Name@version` with its value
 *     and its shorthand-specific siblings moved into `inputs:` (C-E04-030/032). `checkout`,
 *     `publish` and `download` become bare GUIDs, with the input renaming that comes with them
 *     (`publish`'s `artifact:` → `artifactName:`, `download`'s scalar → `alias:`), and
 *     `checkout: none` additionally acquires `condition: false` (C-E03-260).
 *
 * **Why here and not in the normalizer.** `normalize.ts`'s header states the rule: a canonicalizer
 * rule belongs there only when both texts are legitimate spellings of one pipeline, and doing
 * *expansion* work there "would let a broken expander pass the diff". These are expansions.
 *
 * Every synthesized node inherits the `pos` of the node it replaces, which is what keeps the
 * expansion map's coverage total (C-E03-253) and makes a diagnostic on a desugared step point at
 * the shorthand the author actually wrote.
 */
import type {
  MappingEntry,
  MappingNode,
  PipelineNode,
  Provenance,
  ScalarNode,
} from '../frontend/parse.js';

/** The step properties that survive desugaring; everything else moves into `inputs:`. */
const STEP_PROPERTIES: ReadonlySet<string> = new Set([
  'name',
  'displayName',
  'condition',
  'continueOnError',
  'enabled',
  'env',
  'timeoutInMinutes',
  'retryCountOnTaskFailure',
  'target',
]);

/** One shorthand's rewrite: the task it becomes, and what its own scalar is called in `inputs:`. */
interface Shorthand {
  readonly task: string;
  /** The `inputs:` key the shorthand's own value takes. */
  readonly valueInput: string;
  /** Fixed inputs the service adds, in the order it emits them. */
  readonly fixed?: readonly (readonly [string, string | boolean])[];
  /** Sibling keys the service renames on the way into `inputs:`. */
  readonly rename?: Readonly<Record<string, string>>;
}

/**
 * The desugaring table, transcribed from the probes (C-E04-030/032).
 *
 * `pwsh` and `powershell` are the same task and differ only by the `pwsh: true` input; `bash` and
 * both PowerShell forms carry `targetType: inline`, while `script` does not.
 */
export const SHORTHANDS: Readonly<Record<string, Shorthand>> = {
  script: { task: 'CmdLine@2', valueInput: 'script' },
  bash: { task: 'Bash@3', valueInput: 'script', fixed: [['targetType', 'inline']] },
  powershell: { task: 'PowerShell@2', valueInput: 'script', fixed: [['targetType', 'inline']] },
  pwsh: {
    task: 'PowerShell@2',
    valueInput: 'script',
    fixed: [['targetType', 'inline']],
  },
  checkout: { task: '6d15af64-176c-496d-b583-fd2ae21d4df4@1', valueInput: 'repository' },
  publish: {
    task: 'ecdc45f6-832d-4ad9-b52b-ee49e94659be@1',
    valueInput: 'path',
    rename: { artifact: 'artifactName' },
  },
  download: { task: '30f35852-3f7e-4c0c-9a88-e127b4f97211@1', valueInput: 'alias' },
};

const scalar = (value: string | boolean, pos: Provenance): ScalarNode => ({
  kind: 'scalar',
  value,
  style: 'plain',
  pos,
});

const entry = (key: string, value: PipelineNode, pos: Provenance): MappingEntry => ({
  key: scalar(key, pos),
  value,
});

const mapping = (entries: MappingEntry[], pos: Provenance): MappingNode => ({
  kind: 'mapping',
  entries,
  pos,
});

const keyOf = (item: MappingEntry): string => String(item.key.value);

const find = (node: MappingNode, key: string): MappingEntry | undefined =>
  node.entries.find((item) => keyOf(item) === key);

/**
 * Rewrite one step if it is a shorthand.
 *
 * Key order is the service's: `task:` first, then the surviving step properties in the order they
 * were authored, then any synthesized property, then `inputs:` last (measured on every corpus
 * entry that carries a shorthand).
 */
function desugarStep(step: PipelineNode): PipelineNode {
  if (step.kind !== 'mapping') return step;
  const first = step.entries[0];
  if (first === undefined) return step;
  const keyword = keyOf(first);
  const shorthand = SHORTHANDS[keyword];
  if (shorthand === undefined) return step;

  const pos = step.pos;
  const properties: MappingEntry[] = [];
  const inputs: MappingEntry[] = [];

  inputs.push(entry(shorthand.valueInput, first.value, first.value.pos));
  for (const [name, value] of shorthand.fixed ?? [])
    inputs.push(entry(name, scalar(value, pos), pos));
  // `pwsh:` and `powershell:` share a task; the flag is what tells them apart (C-E04-037).
  if (keyword === 'pwsh') inputs.push(entry('pwsh', scalar(true, pos), pos));

  for (const item of step.entries.slice(1)) {
    const name = keyOf(item);
    if (STEP_PROPERTIES.has(name)) {
      properties.push(item);
      continue;
    }
    const renamed = shorthand.rename?.[name];
    inputs.push(
      renamed === undefined ? item : { key: scalar(renamed, item.key.pos), value: item.value },
    );
  }

  // `checkout: none` is the one shorthand that synthesizes a step property (C-E03-260).
  if (keyword === 'checkout' && first.value.kind === 'scalar' && first.value.value === 'none')
    properties.push(entry('condition', scalar(false, pos), pos));

  return mapping(
    [
      entry('task', scalar(shorthand.task, first.key.pos), first.key.pos),
      ...properties,
      entry('inputs', mapping(inputs, pos), pos),
    ],
    pos,
  );
}

/** Rewrite every `steps:` sequence in the document, at any depth. */
function desugarSteps(node: PipelineNode): PipelineNode {
  switch (node.kind) {
    case 'scalar':
      return node;
    case 'sequence':
      return { ...node, items: node.items.map(desugarSteps) };
    case 'mapping':
      return {
        ...node,
        entries: node.entries.map((item) => {
          if (keyOf(item) === 'steps' && item.value.kind === 'sequence') {
            return {
              ...item,
              value: { ...item.value, items: item.value.items.map((step) => desugarStep(step)) },
            };
          }
          return { ...item, value: desugarSteps(item.value) };
        }),
      };
  }
}

/** `trigger: none` / `pr: none` → `{enabled: false}` (C-E00-022, C-E03-002). */
function expandTriggerNone(root: MappingNode): MappingNode {
  return {
    ...root,
    entries: root.entries.map((item) => {
      const name = keyOf(item);
      if (name !== 'trigger' && name !== 'pr') return item;
      if (item.value.kind !== 'scalar' || item.value.value !== 'none') return item;
      const pos = item.value.pos;
      return { ...item, value: mapping([entry('enabled', scalar(false, pos), pos)], pos) };
    }),
  };
}

/**
 * Wrap an implicit `steps:` or `jobs:` document in the structure the service synthesizes.
 *
 * The `pool:` asymmetry is the part that cannot be guessed: with a `steps:` root the service moves
 * `pool` into the job it invents, and with a `jobs:` root it leaves `pool` at the document root
 * (C-E03-259). Both are measured; nothing here generalizes beyond them.
 */
function wrapImplicitStructure(root: MappingNode): MappingNode {
  const stepsEntry = find(root, 'steps');
  const jobsEntry = find(root, 'jobs');
  if (find(root, 'stages') !== undefined) return root;
  if (stepsEntry === undefined && jobsEntry === undefined) return root;

  const pos = (stepsEntry ?? jobsEntry)!.value.pos;
  const moved = new Set<string>(['steps', 'jobs']);

  let jobsValue: PipelineNode;
  if (stepsEntry !== undefined) {
    const jobEntries: MappingEntry[] = [entry('job', scalar('Job', pos), pos)];
    const poolEntry = find(root, 'pool');
    if (poolEntry !== undefined) {
      jobEntries.push(poolEntry);
      moved.add('pool');
    }
    jobEntries.push(stepsEntry);
    jobsValue = { kind: 'sequence', items: [mapping(jobEntries, pos)], pos };
  } else {
    jobsValue = jobsEntry!.value;
  }

  const stage = mapping(
    [entry('stage', scalar('__default', pos), pos), entry('jobs', jobsValue, pos)],
    pos,
  );
  const stages = entry('stages', { kind: 'sequence', items: [stage], pos }, pos);

  const entries: MappingEntry[] = [];
  let placed = false;
  for (const item of root.entries) {
    const name = keyOf(item);
    if (!moved.has(name)) {
      entries.push(item);
      continue;
    }
    // `stages:` takes the position the `steps:`/`jobs:` key held, which is what keeps the emitted
    // key order the service's.
    if ((name === 'steps' || name === 'jobs') && !placed) {
      entries.push(stages);
      placed = true;
    }
  }
  if (!placed) entries.push(stages);
  return { ...root, entries };
}

/**
 * Apply the service's normalization-time expansions to an expanded DOM.
 *
 * Order matters: the wrapping runs first so the job it invents carries its steps through the
 * shorthand pass, and the trigger rewrite is independent of both.
 */
export function desugarExpansion(node: PipelineNode | undefined): PipelineNode | undefined {
  if (node === undefined) return undefined;
  if (node.kind !== 'mapping') return desugarSteps(node);
  return desugarSteps(expandTriggerNone(wrapImplicitStructure(node)));
}
