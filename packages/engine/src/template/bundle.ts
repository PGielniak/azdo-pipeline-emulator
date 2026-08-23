// E03-S06-T01 — find every `template:` reference in one parsed pipeline document.
//
// This is the first half of the **bundler**, the default path's only local template work (docs/02
// §5.1). The bundler exists because the service reads templates from the *committed* tree
// (C-E03-404), so an uncommitted edit to a template file is invisible to `preview` unless we inline
// it into the `yamlOverride` ourselves. This module does no expansion and no resolution: it locates
// references and says where each one sits. Resolution — path math, alias lookup, cycles — is
// `./reference.ts` (E03-S02-T01, C-E03-195..215) and is reused here rather than restated.
//
// The detection rule keys off the **container key name at any depth** rather than a fixed
// root-level path, because the same containers nest (a stage's `variables:`, a job's `steps:`, a
// deployment strategy's `steps:`) and every `$ref` to those definitions in the vendored schema sits
// under a property of the same name (C-E03-401/405).
import type { MappingNode, ParseResult, PipelineNode, SourceRange } from '../frontend/parse.js';
import { isSelfAlias, parseReference } from './reference.js';
import { parseDirectiveKey } from './walk.js';

/**
 * Container keys whose **sequence items** may be a `{template, parameters}` reference.
 *
 * `phases` is schema-derived only: the doc page does not mention it, but the vendored schema
 * carries a `phase` branch identical to `job`'s and marks the container deprecated rather than
 * removed (C-E03-405). Detecting it is the conservative direction — a missed reference expands
 * against the committed repo silently, which is the failure this story exists to prevent.
 */
export const TEMPLATE_CONTAINERS = ['stages', 'jobs', 'phases', 'steps', 'variables'] as const;

export type TemplateContainer = (typeof TEMPLATE_CONTAINERS)[number];

/**
 * Where a reference was written.
 *
 * `parameters` is not a container in the schema — it is the value subtree of an `extends` or of
 * another template reference. A `stepList`/`jobList` parameter value may itself contain
 * `- template: …`, and the service resolves it once the receiving template inserts the list. Such a
 * reference is reported with this site rather than dropped, so E03-S06-T02 makes the
 * include-or-diagnose call with the data in hand instead of expanding against the committed tree by
 * omission.
 */
export type ReferenceSite = 'extends' | TemplateContainer | 'parameters';

export interface TemplateReference {
  readonly site: ReferenceSite;
  /** The reference exactly as written, before any path math. */
  readonly text: string;
  /** Everything before the first `@` (C-E03-210); not trimmed. */
  readonly path: string;
  /** Everything after the first `@`, or `undefined` when there is no `@` (C-E03-212). */
  readonly alias: string | undefined;
  /**
   * Does this resolve to the pipeline's own repository — i.e. is it the bundler's to inline?
   * True for a bare path, for the empty alias `a.yml@` (C-E03-212), and for `@self` in any casing
   * (C-E03-213). A bare path is `self` only *relative to the file that wrote it*; for a template
   * pulled from another repository that is that repository, which is why E03-S06-T02 carries the
   * enclosing file's repository and this flag is not the whole answer on its own.
   */
  readonly self: boolean;
  /** The file the reference was written in (the `ParseResult`'s file). */
  readonly file: string;
  /** Position of the reference **scalar**, so a diagnostic points at the path, not the mapping. */
  readonly range: SourceRange;
  /** The sibling `parameters:` mapping, when the reference carries one (C-E03-405/406). */
  readonly parameters: MappingNode | undefined;
  /**
   * Enclosing `${{ if … }}` / `${{ each … }}` directive keys, outermost first — empty when the
   * reference is unconditional.
   *
   * Carried because it is free while walking and unreconstructable afterwards without a second
   * pass. A reference inside a pruned branch may not be resolved by the service at all, so an
   * inliner that insists the file exists could break a pipeline that runs today. Which way that
   * goes is measured by E03-S06-T02's oracle probe, not decided here.
   */
  readonly directives: readonly string[];
}

const TEMPLATE_KEY = 'template';
const PARAMETERS_KEY = 'parameters';
const EXTENDS_KEY = 'extends';

const CONTAINERS: ReadonlySet<string> = new Set(TEMPLATE_CONTAINERS);

/**
 * Every `template:` reference in `parsed`, in document order.
 *
 * Only this document: recursion into the files it names is E03-S06-T02's, which re-parses each
 * inlined file and calls back here.
 */
export function findTemplateReferences(parsed: ParseResult): readonly TemplateReference[] {
  const found: TemplateReference[] = [];
  if (parsed.root !== undefined) walkNode(parsed.root, parsed.file, [], found);
  return found;
}

function walkNode(
  node: PipelineNode,
  file: string,
  directives: readonly string[],
  found: TemplateReference[],
): void {
  if (node.kind === 'sequence') {
    for (const item of node.items) walkNode(item, file, directives, found);
    return;
  }
  if (node.kind !== 'mapping') return;

  for (const entry of node.entries) {
    const key = keyText(entry.key.value);

    // `extends` is a mapping property, not a sequence item, and carries no `firstProperty`
    // discriminator (C-E03-406).
    if (key === EXTENDS_KEY && entry.value.kind === 'mapping') {
      emitFrom(entry.value, 'extends', file, directives, found);
      walkParameters(entry.value, file, directives, found);
      continue;
    }

    if (CONTAINERS.has(key) && entry.value.kind === 'sequence') {
      walkContainer(entry.value, key as TemplateContainer, file, directives, found);
      continue;
    }

    walkNode(entry.value, file, nest(directives, entry.key.value), found);
  }
}

/**
 * Items of a `stages`/`jobs`/`phases`/`steps`/`variables` sequence.
 *
 * A directive-keyed item is unwrapped **into the same container context**: `- ${{ if … }}:` holds a
 * nested sequence whose items are container items, not a new structure. A directive is only ever a
 * mapping key (C-E03-108/112), so this is the only shape that needs unwrapping.
 */
function walkContainer(
  sequence: Extract<PipelineNode, { kind: 'sequence' }>,
  container: TemplateContainer,
  file: string,
  directives: readonly string[],
  found: TemplateReference[],
): void {
  for (const item of sequence.items) {
    if (item.kind !== 'mapping') continue;

    const directive = soleDirectiveEntry(item);
    if (directive !== undefined) {
      const inner = nest(directives, directive.key.value);
      if (directive.value.kind === 'sequence') {
        walkContainer(directive.value, container, file, inner, found);
      } else {
        walkNode(directive.value, file, inner, found);
      }
      continue;
    }

    emitFrom(item, container, file, directives, found);
    walkParameters(item, file, directives, found);

    // A container item is also a container: a stage holds `jobs`, a job holds `steps`, a
    // deployment strategy holds more `steps`. Descend for those, skipping the two keys this
    // function has already accounted for.
    for (const entry of item.entries) {
      const key = keyText(entry.key.value);
      if (key === TEMPLATE_KEY || key === PARAMETERS_KEY) continue;
      if (CONTAINERS.has(key) && entry.value.kind === 'sequence') {
        walkContainer(entry.value, key as TemplateContainer, file, directives, found);
        continue;
      }
      walkNode(entry.value, file, nest(directives, entry.key.value), found);
    }
  }
}

/**
 * References buried in a `parameters:` **value** — a `stepList`/`jobList`/`object` argument that
 * happens to contain `- template: …`. Reported as site `parameters`; see `ReferenceSite`.
 *
 * The container-key rule cannot find these: the key is the parameter's own name (`buildSteps`), not
 * `steps`. So the whole value subtree is scanned for the reference *shape* instead — a mapping with
 * a `template` scalar — which is why this is a separate pass rather than a wider container list.
 */
function walkParameters(
  owner: MappingNode,
  file: string,
  directives: readonly string[],
  found: TemplateReference[],
): void {
  const entry = owner.entries.find((candidate) => keyText(candidate.key.value) === PARAMETERS_KEY);
  if (entry === undefined) return;
  scanForReferences(entry.value, file, directives, found);
}

/**
 * Only a **sequence item** can be a reference here, and that is the whole rule.
 *
 * The mapping under `parameters:` is a map of parameter *names* to values, so
 * `parameters:\n  template: v` declares a parameter called `template` — emitting for it would
 * inline a file on the strength of a name collision. Every schema branch that carries a `template`
 * key is the `items` type of an array (C-E03-405), so requiring sequence-item position costs
 * nothing real and removes the ambiguity.
 */
function scanForReferences(
  node: PipelineNode,
  file: string,
  directives: readonly string[],
  found: TemplateReference[],
  isSequenceItem = false,
): void {
  if (node.kind === 'sequence') {
    for (const item of node.items) scanForReferences(item, file, directives, found, true);
    return;
  }
  if (node.kind !== 'mapping') return;

  if (isSequenceItem) emitFrom(node, 'parameters', file, directives, found);
  for (const entry of node.entries) {
    if (isSequenceItem && keyText(entry.key.value) === TEMPLATE_KEY) continue;
    scanForReferences(entry.value, file, nest(directives, entry.key.value), found);
  }
}

/**
 * Emit the reference `owner` carries, if it carries one.
 *
 * Presence, not first position: `firstProperty: ["template"]` names the discriminator, but the
 * validator enforces ordering only as a *warning* while the service's own tolerance is unverified
 * (C-E03-407), and a detector stricter than the validator would skip a reference the service
 * accepts. The key is matched case-sensitively for the same reason the validator does — no
 * `ignoreCase` on the property.
 */
function emitFrom(
  owner: MappingNode,
  site: ReferenceSite,
  file: string,
  directives: readonly string[],
  found: TemplateReference[],
): void {
  const entry = owner.entries.find((candidate) => keyText(candidate.key.value) === TEMPLATE_KEY);
  if (entry === undefined || entry.value.kind !== 'scalar') return;
  const text = entry.value.value;
  if (typeof text !== 'string') return;

  const { path, alias } = parseReference(text);
  const parameters = owner.entries.find(
    (candidate) => keyText(candidate.key.value) === PARAMETERS_KEY,
  )?.value;

  found.push({
    site,
    text,
    path,
    alias,
    self: alias === undefined || alias === '' || isSelfAlias(alias),
    file,
    range: entry.value.pos.range,
    parameters: parameters?.kind === 'mapping' ? parameters : undefined,
    directives,
  });
}

/** The one entry of `node`, when that entry's key is a directive. */
function soleDirectiveEntry(node: MappingNode): MappingNode['entries'][number] | undefined {
  if (node.entries.length !== 1) return undefined;
  const entry = node.entries[0];
  if (entry === undefined) return undefined;
  const key = entry.key.value;
  if (typeof key !== 'string') return undefined;
  return parseDirectiveKey(key).kind === 'directive' ? entry : undefined;
}

function nest(directives: readonly string[], key: unknown): readonly string[] {
  if (typeof key !== 'string') return directives;
  return parseDirectiveKey(key).kind === 'directive' ? [...directives, key] : directives;
}

/** A non-string key cannot be one of the keywords we match, so it folds to a never-matching text. */
function keyText(value: unknown): string {
  return typeof value === 'string' ? value : ' ';
}
