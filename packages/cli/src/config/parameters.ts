// E13-S01-T02 — `--parameter key=value` (repeatable), with `@file.json` for complex values
// (docs/06 §1). C-E13-013 fixes the resolution rules this file implements.
//
// Values leave here as the raw string a user typed, or the structure parsed from a JSON file. They
// are deliberately *not* coerced to the pipeline's declared parameter type — this layer never sees
// the pipeline, so `true`/`42` stay strings until the binder coerces them against the declared type
// (C-E13-009/010).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../exit.js';
import type { ParameterValue } from './types.js';

/** Marks a value as a reference to a JSON file; doubled (`@@`) it is an escaped literal `@`. */
const FILE_PREFIX = '@';

export interface ParseParameterOptions {
  /** Base for relative `@file.json` paths — the *process* working directory (C-E13-013). */
  readonly cwd?: string;
  /** Injectable for tests; defaults to reading the file system. */
  readonly readFile?: (file: string) => string;
}

/**
 * Parse one `--parameter` occurrence into a `[name, value]` pair.
 *
 * Only the first `=` separates: `--parameter connString=a=b` gives `a=b`, which is why a naive
 * `split('=')` is wrong here.
 */
export function parseParameterOption(
  raw: string,
  options: ParseParameterOptions = {},
): readonly [string, ParameterValue] {
  const separator = raw.indexOf('=');
  if (separator <= 0) {
    throw new CliError(`--parameter needs \`name=value\`, got ${JSON.stringify(raw)}`, {
      hint:
        separator === 0
          ? 'the name is empty'
          : 'for a complex value use `name=@file.json`; to include a literal `@`, double it (`@@`)',
    });
  }
  const name = raw.slice(0, separator);
  const rawValue = raw.slice(separator + 1);
  return [name, parseParameterValue(name, rawValue, options)];
}

/** Parse many occurrences, later ones winning — commander hands us them in command-line order. */
export function parseParameterOptions(
  raws: readonly string[],
  options: ParseParameterOptions = {},
): Record<string, ParameterValue> {
  const parameters: Record<string, ParameterValue> = {};
  for (const raw of raws) {
    const [name, value] = parseParameterOption(raw, options);
    parameters[name] = value;
  }
  return parameters;
}

function parseParameterValue(
  name: string,
  rawValue: string,
  options: ParseParameterOptions,
): ParameterValue {
  // `@@x` ⇒ the literal `@x`: an escape hatch, so a value that genuinely starts with `@` is
  // expressible rather than being silently read as a file name (C-E13-013).
  if (rawValue.startsWith(`${FILE_PREFIX}${FILE_PREFIX}`)) return rawValue.slice(1);
  if (!rawValue.startsWith(FILE_PREFIX)) return rawValue;

  const reference = rawValue.slice(FILE_PREFIX.length);
  if (reference.length === 0) {
    throw new CliError(`--parameter ${name}=@ is missing a file name`, {
      hint: 'use `name=@file.json`, or `name=@@literal` for a value starting with `@`',
    });
  }

  const file = path.resolve(options.cwd ?? process.cwd(), reference);
  const read = options.readFile ?? ((target: string) => readFileSync(target, 'utf8'));

  let source: string;
  try {
    source = read(file);
  } catch (error) {
    throw new CliError(`--parameter ${name}: cannot read ${file}`, {
      hint: (error as Error).message,
    });
  }

  try {
    return JSON.parse(source) as ParameterValue;
  } catch (error) {
    throw new CliError(`--parameter ${name}: ${file} is not valid JSON`, {
      hint: (error as Error).message,
    });
  }
}
