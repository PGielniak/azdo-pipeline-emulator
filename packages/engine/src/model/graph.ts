// E04-S03-T02 — dependency graphs: the stage graph (default **sequential**) and the job graph
// (default **parallel**), with the service's exact validation phrasing.
//
// The two defaults are documented and are the asymmetry the whole module exists for: a stage without
// `dependsOn` runs after the stage before it (C-E04-123), while a job without `dependsOn` has no
// dependency at all (C-E04-124), and an explicit `dependsOn: []` is the opt-out that breaks the
// sequential stage default (C-E04-125). Everything about a *broken* graph is measured rather than
// guessed (C-E04-126..135), and the validation reproduces the service's sentences verbatim:
//
// - a missing target is `"Stage B depends on unknown stage NoSuchStage."` (C-E04-126/127);
// - a cycle is reported **edge-by-edge** as `"Stage B depends on stage C which creates a cycle in
//   the dependency graph."`, one sentence per participating edge, in source-declaration order
//   (C-E04-130/131/132);
// - a graph with no dependency-free node is a single sentence — `"The pipeline must contain at least
//   one stage with no dependencies."` — that **shadows** the other two checks (C-E04-128/129/133);
// - the fixed precedence is: no-dependency-free-node → cycle edges → missing targets (C-E04-133/134).
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { SourceRange } from '../frontend/parse.js';
import type { Stage } from './types.js';

export const GRAPH_NO_DEPENDENCY_FREE = 'graph-no-dependency-free-node';
export const GRAPH_UNKNOWN_TARGET = 'graph-unknown-dependency-target';
export const GRAPH_CYCLE = 'graph-dependency-cycle';

/** One node of the effective stage graph, ready for E05's topological sort. */
export interface StageGraphNode {
  readonly id: string;
  /** Effective targets: the sequential default is already applied (C-E04-123). */
  readonly dependsOn: readonly string[];
}

/** One node of the effective job graph, keyed by the `dependsOn`-reference name. */
export interface JobGraphNode {
  readonly id: string;
  /** Effective targets: parallel default, so authored (C-E04-124). */
  readonly dependsOn: readonly string[];
}

/**
 * Compute the effective stage dependencies (sequential default applied) and validate the graph.
 *
 * `dependsOn` may be `undefined` (absent → the previous stage, C-E04-123) or an authored list
 * (including `[]` → no dependency, C-E04-125). Validation reproduces the service's sentences and
 * precedence (C-E04-126..135) into `diagnostics`.
 */
export function resolveStageGraph(
  stages: readonly Stage[],
  file: string,
  diagnostics: Diagnostic[],
): readonly StageGraphNode[] {
  const ids = stages.map((stage) => stage.id);
  const deps = stages.map((stage, i) => stage.dependsOn ?? (i === 0 ? [] : [ids[i - 1] ?? '']));

  validateGraph(
    ids,
    deps,
    file,
    diagnostics,
    {
      noRoot: () => 'The pipeline must contain at least one stage with no dependencies.',
      cycle: (src, dst) =>
        `Stage ${src} depends on stage ${dst} which creates a cycle in the dependency graph.`,
      missing: (src, dst) => `Stage ${src} depends on unknown stage ${dst}.`,
    },
    stages.map((stage) => stage.provenance.range),
  );

  return deps.map((dependsOn, i) => ({ id: ids[i] ?? '', dependsOn }));
}

/**
 * Compute the effective job dependencies (parallel default) and validate the graph.
 *
 * The graph is keyed by `Job.referenceName` — the authored job name — rather than by `id`, because a
 * `dependsOn: Build` reference resolves to the whole matrix/parallel job, i.e. every leg, and never
 * to a single leg id like `Build Alpha` (C-E04-136). All legs of one strategy job share one
 * `dependsOn`, so the graph has one node per distinct reference name.
 */
export function resolveJobGraph(
  stage: Stage,
  file: string,
  diagnostics: Diagnostic[],
): readonly JobGraphNode[] {
  const names: string[] = [];
  const deps: (readonly string[])[] = [];
  const ranges: SourceRange[] = [];
  const seen = new Set<string>();
  for (const job of stage.jobs) {
    if (seen.has(job.referenceName)) continue;
    seen.add(job.referenceName);
    names.push(job.referenceName);
    deps.push(job.dependsOn);
    ranges.push(job.provenance.range);
  }

  validateGraph(
    names,
    deps,
    file,
    diagnostics,
    {
      noRoot: () => `Stage ${stage.id} must contain at least one job with no dependencies.`,
      cycle: (src, dst) =>
        `Stage ${stage.id} job ${src} depends on job ${dst} which creates a cycle in the dependency graph.`,
      missing: (src, dst) => `Stage ${stage.id} job ${src} depends on unknown job ${dst}.`,
    },
    ranges,
  );

  return names.map((id, i) => ({ id, dependsOn: deps[i] ?? [] }));
}

interface GraphMessages {
  noRoot(): string;
  cycle(src: string, dst: string): string;
  missing(src: string, dst: string): string;
}

/**
 * The shared validation: no-dependency-free-node → cycle edges → missing targets (C-E04-133/134).
 *
 * `deps[i]` is node `i`'s effective dependency list. The no-dependency-free-node check counts list
 * entries without regard to whether a target exists (C-E04-133's transcript proves it: a stage
 * `dependsOn: Z` with an unknown `Z` still "has a dependency" for that check), so it runs on the raw
 * lists before any target resolution.
 */
function validateGraph(
  names: readonly string[],
  deps: readonly (readonly string[])[],
  file: string,
  diagnostics: Diagnostic[],
  messages: GraphMessages,
  ranges: readonly SourceRange[],
): void {
  // An empty graph (a stage with no jobs) has nothing to validate: the "at least one node with no
  // dependencies" rule is about a non-empty graph, and firing it over zero jobs would reject a
  // vacuously valid stage.
  if (names.length === 0) return;

  // 1. At least one node with no dependencies, or a single sentence shadows everything (C-E04-128/133).
  if (!deps.some((d) => d.length === 0)) {
    diagnostics.push(error(GRAPH_NO_DEPENDENCY_FREE, messages.noRoot(), file, ranges[0]));
    return;
  }

  const index = new Map(names.map((name, i) => [name, i]));

  // Valid edges (target exists) drive cycle detection; a missing target cannot participate in a cycle.
  const adj: readonly (readonly number[])[] = deps.map((targets) =>
    targets.map((target) => index.get(target)).filter((j): j is number => j !== undefined),
  );

  // 2. Cycle edges, in source-declaration order then authored edge order (C-E04-130/132).
  //    An edge i→j is in a cycle iff j reaches i, which `reach[j].has(i)` answers directly.
  const reach = reachableSets(adj);
  for (let i = 0; i < deps.length; i += 1) {
    const source = names[i] ?? '';
    for (const target of deps[i] ?? []) {
      const j = index.get(target);
      if (j !== undefined && reach[j]?.has(i) === true) {
        diagnostics.push(error(GRAPH_CYCLE, messages.cycle(source, target), file, ranges[i]));
      }
    }
  }

  // 3. Missing targets, in declaration order (C-E04-126/127/134).
  for (let i = 0; i < deps.length; i += 1) {
    const source = names[i] ?? '';
    for (const target of deps[i] ?? []) {
      if (!index.has(target)) {
        diagnostics.push(
          error(GRAPH_UNKNOWN_TARGET, messages.missing(source, target), file, ranges[i]),
        );
      }
    }
  }
}

/**
 * For each node, the set of nodes reachable from it along valid edges, via a simple DFS.
 *
 * Reachability (not SCC) is enough here: edge i→j is a cycle edge iff j reaches i, which is exactly
 * the "u and v share an SCC" criterion for a single edge and is simpler to reason about. Graph sizes
 * are bounded (≤ 256 stages/jobs), so O(V·(V+E)) is immaterial.
 */
function reachableSets(adj: readonly (readonly number[])[]): readonly ReadonlySet<number>[] {
  const reach: Set<number>[] = [];
  for (let v = 0; v < adj.length; v += 1) {
    const seen = new Set<number>();
    const stack = [v];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj[cur] ?? []) stack.push(next);
    }
    reach.push(seen);
  }
  return reach;
}

function error(
  code: string,
  message: string,
  file: string,
  range: SourceRange | undefined,
): Diagnostic {
  return {
    severity: 'error',
    code,
    message,
    file,
    range: range ?? { line: 1, col: 1, endLine: 1, endCol: 1 },
  };
}
