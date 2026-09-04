# E08-S02-T03 — the Kubernetes/Helm set under real-task mode, against a live cluster

The Done field asks for "live parity against a kind/AKS test cluster". This is that run: all five
tasks, their **real** packages fetched from the org, driven by the step scripts our own emitter
produces, against a local `kind` cluster.

Nothing here touches a cloud resource. The cluster is `kind` v0.30.0 (Kubernetes v1.34.0) on this
machine, created and destroyed by this experiment; no service connection, no Azure subscription.

## Setup

| Piece | Value |
|---|---|
| Cluster | `kind create cluster --name e08-parity` → Kubernetes v1.34.0, context `kind-e08-parity` |
| Task packages | fetched through E07-S01-T01's downloader: `Kubernetes@1.277.0` (16,770 files), `KubernetesManifest@1.276.0` (15,693), `HelmDeploy@0.276.0` (15,612), `KubectlInstaller@0.275.1` (2,127), `HelmInstaller@1.277.0` (2,126) |
| Step scripts | emitted by `emitStepScript` with the vendored declarations — **not** hand-written `INPUT_*`, so the run exercises input defaults, alias collapsing and the preflight |
| Local tools | kubectl v1.37.0, helm **v4.2.4** (the version that produces C-E08-069) |

Three of the five would not start at all when the run began. Each failure is recorded because each
is a claim.

## Failure 1 — `Agent.TempDirectory` is read at *require* time

`azure-arm-endpoint.js:20` does `path.join(getVariable('Agent.TempDirectory'), …)` at module scope,
so it fires even on the `connectionType: None` arm that never touches ARM. C-E08-042 already said
the runtime provides it; what this adds is that it is needed **unconditionally**, not only by the
Azure arms.

## Failure 2 — `System.HostType` is dereferenced at module load (C-E08-072)

```
TypeError: Cannot read properties of undefined (reading 'toLowerCase')
    at Object.<anonymous> (…/azure-pipelines-tasks-kubernetes-common/image-metadata-helper.js:15:51)
```

`const hostType = tl.getVariable("System.HostType").toLowerCase();` — top level, no guard, and all
three connection-consuming tasks import the module. The generated project now seeds it to `build`.

## Failure 3 — real-task mode was dropping every declared default (C-E08-073)

With the first two fixed, `Kubernetes@1` still died in `clusterconnection.js:54` on
`this.kubectlPath.toLowerCase()`. `getKubectl()` reads `versionOrLocation`, whose declared default is
`version`; the step did not write it, so it arrived unset, so neither branch matched and the
function returned `undefined`.

The agent builds `INPUT_*` from the *declaration*, so an omitted input still arrives with its
default — task-lib never reads `task.json` itself. `realTaskBody` was emitting only the authored
inputs. `resolveTaskInputs` had been built for exactly this in E07-S01-T02 and was called by
nothing. Wiring it in is the fix; the visible effect on any real-task step:

```
task: CopyFiles@2
  SourceFolder:
  Contents: **/*.txt            ← authored as `contents:`, collapsed to the declared name
  TargetFolder: $(Build.ArtifactStagingDirectory)
  CleanTargetFolder: false      ← all of these are declared defaults that used to be missing
  OverWrite: false
  flattenFolders: false
  preserveTimestamp: false
  retryCount: 0
  delayBetweenRetries: 1000
  ignoreMakeDirErrors: false
```

## Run 1 — `Kubernetes@1`, `connectionType: None` (C-E08-060)

`command: apply`, `useConfigurationFile: true`, `configuration: pod.yaml`.

```
##vso[task.complete result=Succeeded;]
$ kubectl get pod e08-parity → e08-parity Running
```

The ambient arm works: no endpoint read, no kubeconfig written, the developer's own context used.
This is the arm the collector used to demand credentials for.

## Run 2 — `KubernetesManifest@1`, `connectionType: None` (C-E08-061)

The value is **not in this task's picklist** — only `kubernetesServiceConnection` and
`azureResourceManager` are — but `open()` still tests for it, and the expansion does not enforce
picklists (C-E08-034). Written in YAML, it works:

```
Connection type: None
##vso[task.prependpath]/usr/bin
			Kubectl Client Version: v1.37.0
			Kubectl Server Version: v1.34.0
[command]…kubectl apply -f …/Deployment_e08-manifest_… --namespace default
deployment.apps/e08-manifest created
[command]…kubectl rollout status Deployment/e08-manifest --timeout 0s --namespace default
deployment "e08-manifest" successfully rolled out
```

**And then it annotated the live objects (C-E08-074).** Read back off the cluster:

```
azure-pipelines/jobName    = "undefined"
azure-pipelines/org        = undefined
azure-pipelines/pipeline   = "undefined"
azure-pipelines/pipelineId = "undefined"
azure-pipelines/project    = undefined
azure-pipelines/run        = undefined
azure-pipelines/runuri     = undefinedundefined/_build/results?buildId=undefined
```

Seven annotations, written with `--overwrite`, whose values are the literal string `undefined`.
Against a shared cluster this overwrites what the real pipeline recorded.

## Run 3 — `HelmDeploy@0 upgrade`, `connectionType: None` (C-E08-066 measured)

```
##vso[task.setvariable variable=KUBECONFIG;…]/home/pitoleo/.kube/config
[command]/usr/sbin/helm upgrade --install --wait e08helm chart
Release "e08helm" does not exist. Installing it now.
STATUS: deployed
```

The claim read from source is confirmed by observation: it points `KUBECONFIG` at the **real**
`$HOME/.kube/config` and deploys through the current context. Checked afterwards — the file is still
there (`-rw------- 5.5K`) and the context is unchanged, because `isKubConfigLogoutRequired` excludes
exactly this case.

## Run 4 — `HelmDeploy@0 save` against Helm 4 (C-E08-069 end to end)

```
[command]/usr/sbin/helm version --client --short
Error: unknown flag: --client
##vso[task.complete result=Failed;]Save chart to Azure Container Registry is only supported in Helms V3.
```

The probe flag Helm 4 removed makes `isHelmV3orHigher()` read an empty stdout and answer *false*, so
a Helm 4 CLI is told it is not Helm 3 or higher. Not patchable under PLAN D4; reported as a delta
with "install a Helm 3 CLI" as the remedy.

## Runs 5 and 6 — the installers, and the tool cache before/after (C-E08-067/068)

With `Agent.ToolsDirectory` unset — the state every generated project was in before this task:

```
##vso[task.complete result=Failed;]Error: Agent.ToolsDirectory is not set
```

With it seeded to `$AZDO_WORKSPACE_DIR/tools`:

```
Caching tool: helm 3.16.2 x64
##vso[task.prependpath]…/workspace/tools/helm/3.16.2/x64/linux-amd64
##vso[task.complete result=Succeeded;]

$ …/workspace/tools/kubectl/1.31.0/x64/kubectl version --client → Client Version: v1.31.0
```

Both installers cache correctly and emit `##vso[task.prependpath]`, which the runtime already
carries across steps.

## The warning every successful run carries (C-E08-075)

```
##vso[task.issue type=warning;…]publishToImageMetadataStore failed with error: TypeError: …
```

Seeding `System.HostType` opened the next unguarded read — `Build.Reason`, at
`image-metadata-helper.js:146`. It is inside a `catch`, so the task still succeeds. Deliberately not
seeded: `Build.Reason` participates in condition evaluation, so picking a value for the user would
silently change which steps run.

## Cleanup

`kind delete cluster --name e08-parity`; the helm release and both workloads went with it. Nothing
outside the kind cluster and the scratch directory was written.
