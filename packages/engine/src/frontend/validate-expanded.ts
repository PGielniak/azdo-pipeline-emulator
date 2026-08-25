/**
 * E03-S04-T03 — strict validation of the **expanded** pipeline.
 *
 * The document validated here is the service's `finalYaml` (E00-S04), not something we expanded.
 * That sounds like it should be the same job as validating an authored document, and it is not:
 * the expansion is a *different dialect*. The service emits shapes it will not accept back as
 * input, so running the authored-document validator over an expansion reports errors in a document
 * the authority itself produced.
 *
 * Measured, on all ten committed corpus expansions, the vendored schema rejects two families that
 * are output-only and must be accepted here:
 *
 *  - **`trigger:`/`pr:` `{enabled: false}`** — the service's rendering of `trigger: none`, and it
 *    rejects that same text as input (`Unexpected value 'enabled'`). C-E03-002 records the
 *    asymmetry; nine of the ten corpus entries carry it.
 *  - **The three desugared GUID tasks** — `checkout`, `publish` and `download` come back as
 *    `task: <guid>@1` with no name spelling (C-E04-030/031), and the vendored task catalogue is
 *    keyed by name, so every one of them reads as an unknown task.
 *
 * Nothing else is relaxed, and the families that remain were confirmed against the service rather
 * than assumed: an unknown key, a wrong-typed value and an unknown task were each injected into a
 * known-good expansion and submitted to `preview`, and all three came back HTTP 400
 * (C-E03-254..257, `research/experiments/E03-strict-validation/`). The check runs in one direction
 * only by design — a validator that rejects what the service accepts turns a working pipeline into
 * a conversion failure, which is the one failure mode a user cannot diagnose.
 *
 * One deliberate divergence survives that comparison: an **unknown task** stays a *warning* here
 * while the service rejects it (C-E03-257). The vendored catalogue holds in-box tasks only, so
 * erroring would fail every pipeline that uses a marketplace task; on the service the catalogue is
 * the organization's, which is what makes rejection right there and wrong here (C-E01-033). The
 * divergence is severity, not detection, and it closes when an org schema is available
 * (E01-S02-T03 / E09).
 *
 * **Provenance is a port, not an import.** A diagnostic here points into `pipeline.expanded.yml`;
 * pointing *also* at the original source needs the expansion map (E03-S04-T02), which lives above
 * this layer. Rather than invert the dependency, the caller passes an `originAt` lookup — the same
 * shape the offline expander's map already provides. On the default path there is no map at all
 * (docs/04 §1 marks it fallback-only) and diagnostics carry the expanded-document pointer alone.
 */
import type { Diagnostic } from './diagnostics.js';
import { parsePipelineYaml } from './parse.js';
import { SCHEMA_UNKNOWN_KEY, SCHEMA_UNKNOWN_TASK, validatePipeline } from './validate.js';
import type { ValidateOptions } from './validate.js';

/** The conventional name the expanded document is reported against. */
export const EXPANDED_FILE = 'pipeline.expanded.yml';

/**
 * The three shorthands the service desugars to a bare GUID (C-E04-031).
 *
 * Listed rather than pattern-matched on "looks like a GUID": an unknown task that *happens* to be
 * spelled as a GUID is still an unknown task, and a wildcard here would hide it.
 */
export const DESUGARED_TASK_GUIDS: Readonly<Record<string, string>> = {
  '6d15af64-176c-496d-b583-fd2ae21d4df4': 'checkout',
  'ecdc45f6-832d-4ad9-b52b-ee49e94659be': 'publish',
  '30f35852-3f7e-4c0c-9a88-e127b4f97211': 'download',
};

/** Where a node in the expanded document came from — the shape the expansion map's entries carry. */
export interface ExpandedOrigin {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly depth?: number;
  readonly repo?: string;
  readonly parameters?: string;
}

/** A diagnostic against the expanded document, with the original source attached when known. */
export interface ExpandedDiagnostic extends Diagnostic {
  readonly origin?: ExpandedOrigin;
}

export interface ValidateExpandedOptions extends ValidateOptions {
  /** Defaults to `pipeline.expanded.yml`. */
  readonly file?: string;
  /** Provenance port: the source a given line of the expanded document came from (E03-S04-T02). */
  readonly originAt?: (line: number) => ExpandedOrigin | undefined;
}

/** `$.trigger.enabled` and `$.pr.enabled` — output-only, and rejected as input (C-E03-002). */
const OUTPUT_ONLY_KEYS: ReadonlySet<string> = new Set(['$.trigger.enabled', '$.pr.enabled']);

/** Is this diagnostic one the expanded dialect is allowed to produce? */
function isOutputOnly(diagnostic: Diagnostic): boolean {
  if (diagnostic.code === SCHEMA_UNKNOWN_KEY)
    return diagnostic.jsonPath !== undefined && OUTPUT_ONLY_KEYS.has(diagnostic.jsonPath);
  if (diagnostic.code === SCHEMA_UNKNOWN_TASK) {
    const quoted = /"([^"@]+)@\d+"/.exec(diagnostic.message)?.[1];
    return quoted !== undefined && quoted in DESUGARED_TASK_GUIDS;
  }
  return false;
}

/**
 * Validate an expanded pipeline document.
 *
 * Parse errors come first and are reported as diagnostics rather than thrown: an expansion that
 * does not parse is a fact about the expansion, and `convert` wants to print it, not catch it.
 */
export function validateExpandedPipeline(
  yaml: string,
  options: ValidateExpandedOptions = {},
): ExpandedDiagnostic[] {
  const file = options.file ?? EXPANDED_FILE;
  const parsed = parsePipelineYaml(yaml, file);
  const attach = (diagnostic: Diagnostic): ExpandedDiagnostic => {
    const origin = options.originAt?.(diagnostic.range.line);
    return origin === undefined ? diagnostic : { ...diagnostic, origin };
  };

  if (parsed.errors.length > 0) {
    return parsed.errors.map((error) =>
      attach({
        severity: 'error',
        code: error.code,
        message: error.message,
        file,
        range: error.pos.range,
      }),
    );
  }

  const schemaOptions: ValidateOptions = {};
  if (options.schema !== undefined) schemaOptions.schema = options.schema;
  if (options.schemaSource !== undefined) schemaOptions.schemaSource = options.schemaSource;

  return validatePipeline(parsed, schemaOptions)
    .filter((diagnostic) => !isOutputOnly(diagnostic))
    .map(attach);
}

/**
 * One line of human-readable output: the expanded pointer, and the original one when known.
 *
 * `pipeline.expanded.yml:44:3: error SCHEMA_UNKNOWN_KEY: … (from pipeline.yml:12:3)`
 */
export function formatExpandedDiagnostic(diagnostic: ExpandedDiagnostic): string {
  const where = `${diagnostic.file}:${diagnostic.range.line}:${diagnostic.range.col}`;
  const origin =
    diagnostic.origin === undefined
      ? ''
      : ` (from ${diagnostic.origin.file}:${diagnostic.origin.line}:${diagnostic.origin.col})`;
  return `${where}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${origin}`;
}
