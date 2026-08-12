import { describe, expect, it } from 'vitest';
import {
  ExprKeyNotFoundError,
  accessIndex,
  accessProperty,
  parseExpression,
  pipelineResourceVariables,
  registryForSlot,
  resolveContext,
  resourceVariableEnvName,
  resourcesContext,
  stringValue,
  variablesContext,
  type ExprSlot,
  type ExprValue,
} from '../../src/index.js';

/** Walk a dotted property chain the way an expression would, i.e. through `accessProperty`. */
const chain = (root: ExprValue, path: string): ExprValue =>
  path.split('.').reduce<ExprValue>((value, name) => accessProperty(value, name), root);

const text = (value: ExprValue): string | undefined =>
  value.kind === 'string' ? value.value : undefined;

/** The pin as `azdo-emu.lock.json` records it, with the values run 531 actually reported. */
const PROBE_PIN = {
  projectId: '2f2cfc9d-71d5-48f9-a438-b27f90d2d343',
  pipelineName: 'oracle-dependencies-probe',
  pipelineId: 21,
  runName: '20260812.3',
  runId: 531,
  runUri: 'vstfs:///Build/Build/531',
  sourceBranch: 'refs/heads/main',
  sourceCommit: '69d359c409b84e19d3ebdea1309fbb47b0935f54',
  sourceProvider: 'TfsGit',
  requestedFor: '{user}',
  requestedForId: 'a49d6b5a-4d37-6a7d-bf78-48638a123f4f',
  artifacts: ['drop'],
} as const;

/** `convertToJson(resources.repositories)` from probe 2, verbatim. */
const REPOSITORY_PINS = {
  self: {
    id: '1e61703d-aab2-473a-9608-75bfd95d46e9',
    name: 'oracle',
    ref: 'refs/heads/main',
    type: 'Git',
    url: 'https://{org}@dev.azure.com/{org}/oracle/_git/oracle',
    version: '69d359c409b84e19d3ebdea1309fbb47b0935f54',
  },
  MixedAlias: {
    id: '1e61703d-aab2-473a-9608-75bfd95d46e9',
    name: 'oracle',
    ref: 'refs/heads/main',
    type: 'git',
    url: 'https://{org}@dev.azure.com/{org}/oracle/_git/oracle',
    version: '69d359c409b84e19d3ebdea1309fbb47b0935f54',
  },
} as const;

/**
 * The finding this whole task turns on (C-E02-121): with the metadata demonstrably present in the
 * run, the three access paths disagree. Anyone who later "fixes" this module by adding a `pipeline`
 * key to the context fails here.
 */
describe('pipeline resource metadata is variables, not the resources context (C-E02-120/121)', () => {
  const variables = pipelineResourceVariables({ probe: PROBE_PIN });

  it('resolves to Null through the resources context chain, as the service does', () => {
    const context = {
      slot: 'runtime-variable' as ExprSlot,
      values: { resources: resourcesContext({ repositories: REPOSITORY_PINS }) },
    };
    const resources = resolveContext(context, 'resources');
    // Probe 1: `convertToJson(resources.pipeline)` printed `null`, and every documented field read
    // this way printed empty.
    expect(chain(resources, 'pipeline').kind).toBe('null');
    expect(chain(resources, 'pipeline.probe.runID').kind).toBe('null');
  });

  it('resolves the same dotted name through the flat variables table', () => {
    const context = {
      slot: 'runtime-variable' as ExprSlot,
      values: { variables: variablesContext(variables) },
    };
    const value = accessIndex(
      resolveContext(context, 'variables'),
      stringValue('resources.pipeline.probe.runID'),
    );
    expect(text(value)).toBe('531');
  });

  it('reaches a job condition, where the resources context itself is rejected (C-E02-082)', () => {
    // The parser refuses `resources` in this slot…
    expect(
      parseExpression('resources.pipeline.probe.runID', {
        registry: registryForSlot('job-condition'),
      }).ok,
    ).toBe(false);
    // …so `variables['…']` is the only path an author has, and it is the one the live job used:
    // job `CondFlat` (condition true) ran, `CondFlatControl` (condition false) did not.
    const context = {
      slot: 'job-condition' as ExprSlot,
      values: { variables: variablesContext(variables) },
    };
    const value = accessIndex(
      resolveContext(context, 'variables'),
      stringValue('resources.pipeline.probe.runID'),
    );
    expect(text(value)).toBe('531');
  });
});

describe('pipeline resource variables from a lockfile pin (C-E02-120/122)', () => {
  it('emits every documented field under the service spelling, singular `pipeline` segment', () => {
    const variables = pipelineResourceVariables({ probe: { ...PROBE_PIN, projectName: 'oracle' } });
    expect(Object.keys(variables).sort()).toEqual(
      [
        'resources.pipeline.probe.pipelineID',
        'resources.pipeline.probe.pipelineName',
        'resources.pipeline.probe.projectID',
        'resources.pipeline.probe.projectName',
        'resources.pipeline.probe.requestedFor',
        'resources.pipeline.probe.requestedForID',
        'resources.pipeline.probe.runID',
        'resources.pipeline.probe.runName',
        'resources.pipeline.probe.runURI',
        'resources.pipeline.probe.sourceBranch',
        'resources.pipeline.probe.sourceCommit',
        'resources.pipeline.probe.sourceProvider',
      ].sort(),
    );
    // Lockfile `pipelineId`/`runId`/`runUri` are numbers or differently-cased; the service names
    // and string values are what a run sees.
    expect(variables['resources.pipeline.probe.pipelineID']).toBe('21');
    expect(variables['resources.pipeline.probe.runURI']).toBe('vstfs:///Build/Build/531');
  });

  it('omits projectName entirely when the pin has none — absence, not an empty string', () => {
    const variables = pipelineResourceVariables({ probe: PROBE_PIN });
    // Probe 1's `printenv` listed 11 of the 12 names; `RESOURCES_PIPELINE_PROBE_PROJECTNAME` was
    // not among them. Through an expression the two are indistinguishable (both null-propagate to
    // empty), so the assertion has to be about the key.
    expect(variables).not.toHaveProperty('resources.pipeline.probe.projectName');
    expect(Object.keys(variables)).toHaveLength(11);
  });

  it('keys each alias separately', () => {
    const variables = pipelineResourceVariables({ a: { runId: 1 }, b: { runId: 2 } });
    expect(variables['resources.pipeline.a.runID']).toBe('1');
    expect(variables['resources.pipeline.b.runID']).toBe('2');
  });
});

describe('resource variable environment names (C-E02-127)', () => {
  it('upper-cases and turns dots into underscores', () => {
    expect(resourceVariableEnvName('resources.pipeline.probe.runID')).toBe(
      'RESOURCES_PIPELINE_PROBE_RUNID',
    );
  });

  it('keeps hyphens, which the alias charset allows and the agent preserves', () => {
    // The doc's own printenv sample: RESOURCES_PIPELINE_OTHER-PROJECT-PIPELINE_PROJECTNAME.
    expect(resourceVariableEnvName('resources.pipeline.other-project-pipeline.projectName')).toBe(
      'RESOURCES_PIPELINE_OTHER-PROJECT-PIPELINE_PROJECTNAME',
    );
  });
});

describe('the resources context: repositories and containers (C-E02-123/125)', () => {
  const resources = resourcesContext({
    repositories: REPOSITORY_PINS,
    containers: { probeimg: { image: 'alpine:3.20' } },
  });

  it('carries repositories and containers and nothing else', () => {
    expect(Object.keys(resources.value).sort()).toEqual(['containers', 'repositories']);
  });

  it('resolves a repository field, by property and by index alike', () => {
    expect(text(chain(resources, 'repositories.self.ref'))).toBe('refs/heads/main');
    expect(
      text(
        accessIndex(
          accessIndex(accessProperty(resources, 'repositories'), stringValue('self')),
          stringValue('ref'),
        ),
      ),
    ).toBe('refs/heads/main');
  });

  it('folds case on both the alias and the field name', () => {
    expect(text(chain(resources, 'repositories.SELF.ref'))).toBe('refs/heads/main');
    expect(text(chain(resources, 'repositories.self.REF'))).toBe('refs/heads/main');
    expect(text(chain(resources, 'repositories.mixedalias.name'))).toBe('oracle');
  });

  it('null-propagates a miss instead of raising the way parameters does (C-E02-087)', () => {
    expect(chain(resources, 'repositories.nosuchalias.ref').kind).toBe('null');
    expect(chain(resources, 'repositories.self.noSuchField').kind).toBe('null');
    expect(() => chain(resources, 'repositories.nosuchalias.ref')).not.toThrow(
      ExprKeyNotFoundError,
    );
  });

  it('passes `type` through verbatim — self says Git, a declared repo says what its YAML said', () => {
    expect(text(chain(resources, 'repositories.self.type'))).toBe('Git');
    expect(text(chain(resources, 'repositories.MixedAlias.type'))).toBe('git');
  });

  it('keeps containers under the plural key the context uses, not the singular the macro uses', () => {
    expect(text(chain(resources, 'containers.probeimg.image'))).toBe('alpine:3.20');
    // `convertToJson(resources.container)` printed `null` in probe 2 (C-E02-126).
    expect(chain(resources, 'container').kind).toBe('null');
  });

  it('presents both families as empty objects when the run declares no resources', () => {
    const empty = resourcesContext({});
    expect(chain(empty, 'repositories').kind).toBe('object');
    expect(chain(empty, 'containers').kind).toBe('object');
    expect(chain(empty, 'repositories.self').kind).toBe('null');
  });
});
