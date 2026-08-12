# 02-artifact-handoff

Artifacts crossing a stage boundary — the single most load-bearing piece of cross-job state a
local emulation has to reproduce, because nothing about it is visible in the step scripts.

## Exercises

- Both spellings of publish/download: the **shortcut steps** (`publish:` / `download:`) and the
  **tasks they desugar to** (`PublishPipelineArtifact@1` / `DownloadPipelineArtifact@2`), in one
  pipeline, so the emitter's handler for each can be compared against the other.
- `download: current` with a `patterns:` filter — a partial download, so "copy the whole artifact
  directory" is not a valid local shortcut.
- The implicit destination rule: a `download` lands under `$(Pipeline.Workspace)/<artifact>`
  unless `targetPath` says otherwise, and the last step asserts both layouts.
- `CopyFiles@2` with a **multi-line `Contents:` minimatch** including a negation — the pattern
  dialect the runtime has to implement rather than hand to `cp`.
- `checkout: self` with `fetchDepth`, and `checkout: none` in the consuming job (no sources at
  all) — the two ends of the checkout spectrum.
- Directory variables that differ per job: `Build.ArtifactStagingDirectory`,
  `Build.SourcesDirectory`, `Pipeline.Workspace`.
- Stage-to-stage `dependsOn` with `condition: succeeded()`.

## Consumed by

E06 (artifact store, checkout, directory variables), E09 (`CopyFiles@2`, the publish/download
handlers), E05 (stage ordering and workspace layout).
