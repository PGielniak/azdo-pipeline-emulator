// E08-S02-T01 — what the *expansion* does with the two Azure-auth tasks.
//
// The emitter builds its model from `finalYaml`, so the only question the service can settle for
// this task is: **does the expansion resolve a task input alias to its declared name?**
// `AzureCLI@2` and `AzurePowerShell@5` both declare their connection input as
// `connectedServiceNameARM` / `ConnectedServiceNameARM` with the alias `azureSubscription` — and
// `azureSubscription:` is the spelling nearly every real pipeline writes. If the service rewrites
// it, the model sees the declared name and a collector can key on `task.json`; if it does not, the
// collector (and the task-lib host's `INPUT_*` construction) must resolve aliases itself.
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E08-azure-auth');

const PROBES: readonly Probe[] = [
  {
    name: 'azurecli-alias',
    asserts:
      'Does the expansion rewrite the alias `azureSubscription` to the declared input name ' +
      '`connectedServiceNameARM`? Also: is the input keyed by its declared *case*?',
    yaml:
      'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n' +
      '  - task: AzureCLI@2\n' +
      '    inputs:\n' +
      '      azureSubscription: my-azure-sub\n' +
      '      scriptType: bash\n' +
      '      scriptLocation: inlineScript\n' +
      '      inlineScript: az account show\n',
  },
  {
    name: 'azurecli-declared-name',
    asserts:
      'The same step written with the declared name, as the byte-for-byte comparison partner ' +
      'for `azurecli-alias`.',
    yaml:
      'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n' +
      '  - task: AzureCLI@2\n' +
      '    inputs:\n' +
      '      connectedServiceNameARM: my-azure-sub\n' +
      '      scriptType: bash\n' +
      '      scriptLocation: inlineScript\n' +
      '      inlineScript: az account show\n',
  },
  {
    name: 'azurepowershell-alias',
    asserts:
      '`AzurePowerShell@5` declares the same input in PascalCase (`ConnectedServiceNameARM`) with ' +
      'the same alias, plus `azurePowerShellVersion` → `TargetAzurePs`. Two aliases, one step.',
    yaml:
      'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n' +
      '  - task: AzurePowerShell@5\n' +
      '    inputs:\n' +
      '      azureSubscription: my-azure-sub\n' +
      '      azurePowerShellVersion: LatestVersion\n' +
      '      ScriptType: InlineScript\n' +
      '      Inline: Get-AzContext\n',
  },
  {
    name: 'azurecli-unknown-input',
    asserts:
      'Is an input the task does not declare rejected at expansion time, or passed through? ' +
      'Decides whether the emitter can ever see an undeclared input at all.',
    yaml:
      'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n' +
      '  - task: AzureCLI@2\n' +
      '    inputs:\n' +
      '      azureSubscription: my-azure-sub\n' +
      '      scriptType: bash\n' +
      '      scriptLocation: inlineScript\n' +
      '      inlineScript: az account show\n' +
      '      noSuchInput: whatever\n',
  },
  {
    name: 'azurecli-missing-connection',
    asserts:
      'The connection input is `required: true` in task.json. Is a missing required input an ' +
      'expansion-time error, or does it reach the agent? Decides whether the converter must ' +
      'check requiredness itself.',
    yaml:
      'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n' +
      '  - task: AzureCLI@2\n' +
      '    inputs:\n' +
      '      scriptType: bash\n' +
      '      scriptLocation: inlineScript\n' +
      '      inlineScript: az account show\n',
  },
];

await runProbes(PROBES, OUT_DIR);
