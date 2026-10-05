# E09-S03-T08 — frozen-cache preflight

Checked 2026-10-05 against source commit `a86ac6207599f27241345006d9ed70e2bdb2840a`.
`pnpm build` succeeded under Node 22.23.3 / pnpm 11.18.0.

## Scope

This is a local reproduction with a fake HTTP transport returning the committed service expansion
for `02-artifact-handoff`. It exercises the built converter, its real cache, and the built CLI
parser/action. It makes no external request, uses no credentials, and does not claim a live oracle
or network-namespace CI pass. Temporary outputs are deleted after comparison.

The GitHub repository has `ORACLE_ENABLED=true` and all four expected secret names; only their
names were inspected. Credential validity was not tested because the local prerequisites already
contradict the requested whole-project byte equality.

## Observed

```json
{
  "fixture": "02-artifact-handoff",
  "fetchCalls": 1,
  "filesCompared": 30,
  "differences": ["README.md", "manifest.json"],
  "fromCache": [false, true],
  "cliFrozenExit": 1,
  "cliError": "ExpansionConfigMissingError"
}
```

The manifest differs only at `expansion.fromCache`. README's expansion line changes from
`fresh` to `from cache`. All other file bytes, including cached expansion/provenance files, match.
The CLI invocation uses the warm output directory and still fails before cache lookup.

Sources at the measured commit:

- [CLI action](https://github.com/PGielniak/azdo-pipeline-emulator/blob/a86ac6207599f27241345006d9ed70e2bdb2840a/packages/cli/src/program.ts): no third `convert` argument.
- [Expansion context and manifest](https://github.com/PGielniak/azdo-pipeline-emulator/blob/a86ac6207599f27241345006d9ed70e2bdb2840a/packages/fetch/src/expansion-source.ts): context guard before cache lookup; `fromCache` in manifest.
- [README](https://github.com/PGielniak/azdo-pipeline-emulator/blob/a86ac6207599f27241345006d9ed70e2bdb2840a/packages/emit/src/readme.ts): cache-dependent expansion description.

## Reproduce

Run `pnpm build` from the repository root. Save the following to a temporary `.mjs` file and
run `node /absolute/path/to/probe.mjs` from that same root. Its assertions deliberately describe
the blockers; once they are fixed this historical reproduction should stop passing.

```javascript
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const { convert, run } = await import(
  pathToFileURL(join(root, "packages/cli/dist/index.js"))
);
const temp = await mkdtemp(join(tmpdir(), "e09-frozen-"));
const out = join(temp, "out");
const file = join(root, "fixtures/corpus/02-artifact-handoff/pipeline.yml");
const finalYaml = await readFile(
  join(root, "fixtures/oracle/02-artifact-handoff.final.yml"),
  "utf8",
);
let calls = 0;
const deps = {
  oracle: {
    orgUrl: "https://dev.azure.com/example",
    project: "Example",
    pipelineId: 1,
    pat: "synthetic-not-a-credential",
    apiVersion: "7.1",
  },
  fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ finalYaml }), { status: 200 });
  },
};
async function snapshot() {
  const names = await readdir(out, { recursive: true, withFileTypes: true });
  return new Map(
    await Promise.all(
      names
        .filter((e) => e.isFile())
        .map(async (e) => {
          const absolute = join(e.parentPath, e.name);
          return [absolute.slice(out.length + 1), await readFile(absolute)];
        }),
    ),
  );
}
try {
  await convert(file, { out }, deps);
  const before = await snapshot();
  await convert(file, { out, frozen: true }, deps);
  const after = await snapshot();
  const differences = [...new Set([...before.keys(), ...after.keys()])].filter(
    (name) => !before.get(name)?.equals(after.get(name) ?? Buffer.alloc(0)),
  );
  assert.equal(calls, 1);
  assert.deepEqual(differences.sort(), ["README.md", "manifest.json"]);
  console.log(
    "README before:",
    before
      .get("README.md")
      .toString()
      .split("\n")
      .filter((line) => /cache|service/i.test(line)),
  );
  console.log(
    "README after:",
    after
      .get("README.md")
      .toString()
      .split("\n")
      .filter((line) => /cache|service/i.test(line)),
  );
  const a = JSON.parse(before.get("manifest.json"));
  const b = JSON.parse(after.get("manifest.json"));
  assert.equal(a.expansion.fromCache, false);
  assert.equal(b.expansion.fromCache, true);
  a.expansion.fromCache = true;
  assert.deepEqual(a, b);
  let stderr = "";
  const status = await run(["convert", file, "--out", out, "--frozen"], {
    out: () => {},
    err: (text) => {
      stderr += text;
    },
  });
  assert.notEqual(status, 0);
  assert.match(stderr, /ExpansionConfigMissingError/);
  console.log(
    JSON.stringify(
      {
        fixture: "02-artifact-handoff",
        fetchCalls: calls,
        filesCompared: before.size,
        differences,
        fromCache: [false, true],
        cliFrozenExit: status,
        cliError: "ExpansionConfigMissingError",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
```

## Automated characterization

`packages/cli/test/convert.test.ts` now reproduces both blockers under C-E09-095/096. These tests
assert the measured current behavior; the prerequisite tasks must replace those assertions with
whole-project equality and successful CLI replay when they fix it. A green characterization test
is not the requested green network-isolated CI conversion.

## Disposition

E09-S03-T08 stays `[!]`. E09-S03-T09 must make the generated metadata stable; E10-S02-T03 must
connect the shipped CLI to service context and permit credential-free frozen replay. Then resume
the oracle-gated CI task and measure the entire project without metadata exclusions. The existing
hosted-runner isolation command is `sudo unshare -n`, not the rejected unprivileged uid-map variant.
