# E02-S04-T03 — the `resources` context at run time

Probe sources: `resources-pipeline.yml`, `resources-repository.yml` (this directory).
Pipeline resource source: `oracle-dependencies-probe`, latest run 531.

## Probe 1 — pipeline resource

Run 537: succeeded

Jobs: Probe=succeeded, CondFlat=succeeded, Risky=succeeded

```text
C|condFlatRan|yes
C|condFlatRan|yes
P|resJson|{
"repositories": {
"self": {
"id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
"name": "oracle",
"ref": "refs/heads/main",
"type": "Git",
"url": "https://{org}@dev.azure.com/{org}/oracle/_git/oracle",
"version": "69d359c409b84e19d3ebdea1309fbb47b0935f54"
}
},
"containers": {}
}
P|bareResourcesPipeline|[null]
P|chainRunId|[]
P|chainRunName|[]
P|chainRunUri|[]
P|chainSourceBranch|[]
P|chainSourceCommit|[]
P|chainSourceProvider|[]
P|chainPipelineId|[]
P|chainPipelineName|[]
P|chainProjectId|[]
P|chainRequestedFor|[]
P|chainRequestedForId|[]
P|projName|[]
P|flatVar|[531]
P|flatVarProjectName|[]
P|aliasUpper|[]
P|fieldUpper|[]
P|pluralPath|[]
P|macro|[531]
P|env|RESOURCES_PIPELINE_PROBE_PIPELINEID=21
P|env|RESOURCES_PIPELINE_PROBE_PIPELINENAME=oracle-dependencies-probe
P|env|RESOURCES_PIPELINE_PROBE_PROJECTID=2f2cfc9d-71d5-48f9-a438-b27f90d2d343
P|env|RESOURCES_PIPELINE_PROBE_REQUESTEDFOR={user}
P|env|RESOURCES_PIPELINE_PROBE_REQUESTEDFORID=a49d6b5a-4d37-6a7d-bf78-48638a123f4f
P|env|RESOURCES_PIPELINE_PROBE_RUNID=531
P|env|RESOURCES_PIPELINE_PROBE_RUNNAME=20260812.3
P|env|RESOURCES_PIPELINE_PROBE_RUNURI=vstfs:///Build/Build/531
P|env|RESOURCES_PIPELINE_PROBE_SOURCEBRANCH=refs/heads/main
P|env|RESOURCES_PIPELINE_PROBE_SOURCECOMMIT=69d359c409b84e19d3ebdea1309fbb47b0935f54
P|env|RESOURCES_PIPELINE_PROBE_SOURCEPROVIDER=TfsGit
P|env|RESOURCES_TRIGGERINGALIAS=
P|env|RESOURCES_TRIGGERINGCATEGORY=
P|resJson|{
"repositories": {
"self": {
"id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
"name": "oracle",
"ref": "refs/heads/main",
"type": "Git",
"url": "https://{org}@dev.azure.com/{org}/oracle/_git/oracle",
"version": "69d359c409b84e19d3ebdea1309fbb47b0935f54"
}
},
"containers": {}
}
P|bareResourcesPipeline|[null]
P|chainRunId|[]
P|chainRunName|[]
P|chainRunUri|[]
P|chainSourceBranch|[]
P|chainSourceCommit|[]
P|chainSourceProvider|[]
P|chainPipelineId|[]
P|chainPipelineName|[]
P|chainProjectId|[]
P|chainRequestedFor|[]
P|chainRequestedForId|[]
P|projName|[]
P|flatVar|[531]
P|flatVarProjectName|[]
P|aliasUpper|[]
P|fieldUpper|[]
P|pluralPath|[]
P|macro|[531]
P|env|RESOURCES_PIPELINE_PROBE_PIPELINEID=21
P|env|RESOURCES_PIPELINE_PROBE_PIPELINENAME=oracle-dependencies-probe
P|env|RESOURCES_PIPELINE_PROBE_PROJECTID=2f2cfc9d-71d5-48f9-a438-b27f90d2d343
P|env|RESOURCES_PIPELINE_PROBE_REQUESTEDFOR={user}
P|env|RESOURCES_PIPELINE_PROBE_REQUESTEDFORID=a49d6b5a-4d37-6a7d-bf78-48638a123f4f
P|env|RESOURCES_PIPELINE_PROBE_RUNID=531
P|env|RESOURCES_PIPELINE_PROBE_RUNNAME=20260812.3
P|env|RESOURCES_PIPELINE_PROBE_RUNURI=vstfs:///Build/Build/531
P|env|RESOURCES_PIPELINE_PROBE_SOURCEBRANCH=refs/heads/main
P|env|RESOURCES_PIPELINE_PROBE_SOURCECOMMIT=69d359c409b84e19d3ebdea1309fbb47b0935f54
P|env|RESOURCES_PIPELINE_PROBE_SOURCEPROVIDER=TfsGit
P|env|RESOURCES_TRIGGERINGALIAS=
P|env|RESOURCES_TRIGGERINGCATEGORY=
R|missAlias|[]
R|missField|[]
R|missAlias|[]
R|missField|[]
```

## Probe 2 — repository & container resources

Run 538: succeeded

Jobs: Probe=succeeded, Risky=succeeded

```text
R|repoMissAlias|[]
R|repoMissField|[]
R|repoMissAlias|[]
R|repoMissField|[]
P|reposJson|{
"self": {
"id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
"name": "oracle",
"ref": "refs/heads/main",
"type": "Git",
"url": "https://{org}@dev.azure.com/{org}/oracle/_git/oracle",
"version": "69d359c409b84e19d3ebdea1309fbb47b0935f54"
},
"MixedAlias": {
"id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
"name": "oracle",
"ref": "refs/heads/main",
"type": "git",
"url": "https://{org}@dev.azure.com/{org}/oracle/_git/oracle",
"version": "69d359c409b84e19d3ebdea1309fbb47b0935f54"
}
}
P|containersJson|[{
"probeimg": {
"environment": null,
"mapDockerSocket": false,
"image": "alpine:3.20",
"options": null,
"volumes": null,
"ports": null
}
}]
P|selfRef|[refs/heads/main]
P|selfIndex|[refs/heads/main]
P|aliasUpper|[refs/heads/main]
P|fieldUpper|[refs/heads/main]
P|declaredAsWritten|[oracle]
P|declaredLowered|[oracle]
P|flatRepoVar|[]
P|containerImage|[alpine:3.20]
P|containerSingular|[null]
P|env|RESOURCES_TRIGGERINGALIAS=
P|env|RESOURCES_TRIGGERINGCATEGORY=
P|reposJson|{
"self": {
"id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
"name": "oracle",
"ref": "refs/heads/main",
"type": "Git",
"url": "https://{org}@dev.azure.com/{org}/oracle/_git/oracle",
"version": "69d359c409b84e19d3ebdea1309fbb47b0935f54"
},
"MixedAlias": {
"id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
"name": "oracle",
"ref": "refs/heads/main",
"type": "git",
"url": "https://{org}@dev.azure.com/{org}/oracle/_git/oracle",
"version": "69d359c409b84e19d3ebdea1309fbb47b0935f54"
}
}
P|containersJson|[{
"probeimg": {
"environment": null,
"mapDockerSocket": false,
"image": "alpine:3.20",
"options": null,
"volumes": null,
"ports": null
}
}]
P|selfRef|[refs/heads/main]
P|selfIndex|[refs/heads/main]
P|aliasUpper|[refs/heads/main]
P|fieldUpper|[refs/heads/main]
P|declaredAsWritten|[oracle]
P|declaredLowered|[oracle]
P|flatRepoVar|[]
P|containerImage|[alpine:3.20]
P|containerSingular|[null]
P|env|RESOURCES_TRIGGERINGALIAS=
P|env|RESOURCES_TRIGGERINGCATEGORY=
```

## Source run REST metadata (Pipelines `runs/{id}`)

```json
{
  "yamlDetails": {
    "rootYamlFile": {
      "ref": "refs/heads/main",
      "yamlFile": "experiments/dependencies.yml",
      "repoAlias": "self"
    },
    "expandedYamlUrl": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/builds/531/logs/1"
  },
  "_links": {
    "self": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/pipelines/21/runs/531"
    },
    "web": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_build/results?buildId=531"
    },
    "pipeline.web": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_build/definition?definitionId=21"
    },
    "pipeline": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/pipelines/21?revision=1"
    }
  },
  "templateParameters": {},
  "pipeline": {
    "url": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/pipelines/21?revision=1",
    "id": 21,
    "revision": 1,
    "name": "oracle-dependencies-probe",
    "folder": "\\"
  },
  "state": "completed",
  "result": "succeeded",
  "createdDate": "2026-08-12T08:26:45.6856429Z",
  "finishedDate": "2026-08-12T08:27:17.4479705Z",
  "url": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/pipelines/21/runs/531",
  "resources": {
    "repositories": {
      "self": {
        "repository": {
          "id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
          "fullName": "oracle/oracle",
          "type": "azureReposGit"
        },
        "refName": "refs/heads/main",
        "version": "69d359c409b84e19d3ebdea1309fbb47b0935f54"
      }
    }
  },
  "tags": [],
  "id": 531,
  "name": "20260812.3"
}
```

## Source run REST metadata (Build `builds/{id}`)

```json
{
  "_links": {
    "self": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/Builds/531"
    },
    "web": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_build/results?buildId=531"
    },
    "sourceVersionDisplayUri": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/builds/531/sources"
    },
    "timeline": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/builds/531/Timeline"
    },
    "badge": {
      "href": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/status/21"
    }
  },
  "properties": {},
  "tags": [],
  "validationResults": [],
  "plans": [
    {
      "planId": "b91e5bb3-3b65-4e5a-9a48-94f1c1daad21"
    }
  ],
  "triggerInfo": {
    "ci.sourceBranch": "refs/heads/main",
    "ci.sourceSha": "69d359c409b84e19d3ebdea1309fbb47b0935f54",
    "ci.message": "E02-S04-T03 resources context probes",
    "ci.triggerRepository": "1e61703d-aab2-473a-9608-75bfd95d46e9"
  },
  "id": 531,
  "buildNumber": "20260812.3",
  "status": "completed",
  "result": "succeeded",
  "queueTime": "2026-08-12T08:26:45.6856429Z",
  "startTime": "2026-08-12T08:26:52.4682831Z",
  "finishTime": "2026-08-12T08:27:17.4479705Z",
  "url": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/Builds/531",
  "definition": {
    "drafts": [],
    "id": 21,
    "name": "oracle-dependencies-probe",
    "url": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/Definitions/21?revision=1",
    "uri": "vstfs:///Build/Definition/21",
    "path": "\\",
    "type": "build",
    "queueStatus": "enabled",
    "revision": 1,
    "project": {
      "id": "2f2cfc9d-71d5-48f9-a438-b27f90d2d343",
      "name": "oracle",
      "description": "Parity oracle anchor for azdo-pipeline-emulator. Contains one pipeline definition that is never run; addressed only by the Pipelines preview endpoint.",
      "url": "https://dev.azure.com/{org}/_apis/projects/2f2cfc9d-71d5-48f9-a438-b27f90d2d343",
      "state": "wellFormed",
      "revision": 105,
      "visibility": "private",
      "lastUpdateTime": "2026-07-31T05:34:31.863Z"
    }
  },
  "buildNumberRevision": 3,
  "project": {
    "id": "2f2cfc9d-71d5-48f9-a438-b27f90d2d343",
    "name": "oracle",
    "description": "Parity oracle anchor for azdo-pipeline-emulator. Contains one pipeline definition that is never run; addressed only by the Pipelines preview endpoint.",
    "url": "https://dev.azure.com/{org}/_apis/projects/2f2cfc9d-71d5-48f9-a438-b27f90d2d343",
    "state": "wellFormed",
    "revision": 105,
    "visibility": "private",
    "lastUpdateTime": "2026-07-31T05:34:31.863Z"
  },
  "uri": "vstfs:///Build/Build/531",
  "sourceBranch": "refs/heads/main",
  "sourceVersion": "69d359c409b84e19d3ebdea1309fbb47b0935f54",
  "queue": {
    "id": 118,
    "name": "Azure Pipelines",
    "pool": {
      "id": 9,
      "name": "Azure Pipelines",
      "isHosted": true
    }
  },
  "priority": "normal",
  "reason": "individualCI",
  "requestedFor": {
    "displayName": "{user}",
    "url": "https://spsprodweu2.vssps.visualstudio.com/A6f7e9bf3-46c0-4564-848e-b7ba7e27a4bf/_apis/Identities/a49d6b5a-4d37-6a7d-bf78-48638a123f4f",
    "_links": {
      "avatar": {
        "href": "https://dev.azure.com/{org}/_apis/GraphProfile/MemberAvatars/msa.YTQ5ZDZiNWEtNGQzNy03YTdkLWJmNzgtNDg2MzhhMTIzZjRm"
      }
    },
    "id": "a49d6b5a-4d37-6a7d-bf78-48638a123f4f",
    "uniqueName": "{org}@gmail.com",
    "imageUrl": "https://dev.azure.com/{org}/_apis/GraphProfile/MemberAvatars/msa.YTQ5ZDZiNWEtNGQzNy03YTdkLWJmNzgtNDg2MzhhMTIzZjRm",
    "descriptor": "msa.YTQ5ZDZiNWEtNGQzNy03YTdkLWJmNzgtNDg2MzhhMTIzZjRm"
  },
  "requestedBy": {
    "displayName": "{user}",
    "url": "https://spsprodweu2.vssps.visualstudio.com/A6f7e9bf3-46c0-4564-848e-b7ba7e27a4bf/_apis/Identities/00000002-0000-8888-8000-000000000000",
    "_links": {
      "avatar": {
        "href": "https://dev.azure.com/{org}/_apis/GraphProfile/MemberAvatars/s2s.MDAwMDAwMDItMDAwMC04ODg4LTgwMDAtMDAwMDAwMDAwMDAwQDJjODk1OTA4LTA0ZTAtNDk1Mi04OWZkLTU0YjAwNDZkNjI4OA"
      }
    },
    "id": "00000002-0000-8888-8000-000000000000",
    "uniqueName": "{user}",
    "imageUrl": "https://dev.azure.com/{org}/_apis/GraphProfile/MemberAvatars/s2s.MDAwMDAwMDItMDAwMC04ODg4LTgwMDAtMDAwMDAwMDAwMDAwQDJjODk1OTA4LTA0ZTAtNDk1Mi04OWZkLTU0YjAwNDZkNjI4OA",
    "descriptor": "s2s.MDAwMDAwMDItMDAwMC04ODg4LTgwMDAtMDAwMDAwMDAwMDAwQDJjODk1OTA4LTA0ZTAtNDk1Mi04OWZkLTU0YjAwNDZkNjI4OA"
  },
  "lastChangedDate": "2026-08-12T08:27:17.567Z",
  "lastChangedBy": {
    "displayName": "{user}",
    "url": "https://spsprodweu2.vssps.visualstudio.com/A6f7e9bf3-46c0-4564-848e-b7ba7e27a4bf/_apis/Identities/00000002-0000-8888-8000-000000000000",
    "_links": {
      "avatar": {
        "href": "https://dev.azure.com/{org}/_apis/GraphProfile/MemberAvatars/s2s.MDAwMDAwMDItMDAwMC04ODg4LTgwMDAtMDAwMDAwMDAwMDAwQDJjODk1OTA4LTA0ZTAtNDk1Mi04OWZkLTU0YjAwNDZkNjI4OA"
      }
    },
    "id": "00000002-0000-8888-8000-000000000000",
    "uniqueName": "{user}",
    "imageUrl": "https://dev.azure.com/{org}/_apis/GraphProfile/MemberAvatars/s2s.MDAwMDAwMDItMDAwMC04ODg4LTgwMDAtMDAwMDAwMDAwMDAwQDJjODk1OTA4LTA0ZTAtNDk1Mi04OWZkLTU0YjAwNDZkNjI4OA",
    "descriptor": "s2s.MDAwMDAwMDItMDAwMC04ODg4LTgwMDAtMDAwMDAwMDAwMDAwQDJjODk1OTA4LTA0ZTAtNDk1Mi04OWZkLTU0YjAwNDZkNjI4OA"
  },
  "orchestrationPlan": {
    "planId": "b91e5bb3-3b65-4e5a-9a48-94f1c1daad21"
  },
  "logs": {
    "id": 0,
    "type": "Container",
    "url": "https://dev.azure.com/{org}/2f2cfc9d-71d5-48f9-a438-b27f90d2d343/_apis/build/builds/531/logs"
  },
  "repository": {
    "id": "1e61703d-aab2-473a-9608-75bfd95d46e9",
    "type": "TfsGit",
    "name": "oracle",
    "url": "https://dev.azure.com/{org}/oracle/_git/oracle",
    "clean": null,
    "checkoutSubmodules": false
  },
  "retainedByRelease": false,
  "triggeredByBuild": null,
  "appendCommitMessageToRunName": true
}
```
