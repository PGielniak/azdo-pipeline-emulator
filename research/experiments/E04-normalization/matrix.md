# E04-S01-T02 — which step shorthands the service desugars

Each row is one `steps:` document submitted to `preview`. "Step keys in the expansion" is
the discriminating first key of every step that came back, so a row that still shows its
own shorthand keyword is one **we** have to normalize.

| Shorthand | Outcome | Step keys in the expansion | Verdict |
|---|---|---|---|
| `script` | HTTP 200 · expanded | `task` | desugared → `CmdLine@2` |
| `bash` | HTTP 200 · expanded | `task` | desugared → `Bash@3` |
| `pwsh` | HTTP 200 · expanded | `task` | desugared → `PowerShell@2` |
| `powershell` | HTTP 200 · expanded | `task` | desugared → `PowerShell@2` |
| `publish` | HTTP 200 · expanded | `task` | desugared → `ecdc45f6-832d-4ad9-b52b-ee49e94659be@1` |
| `download` | HTTP 200 · expanded | `task` | desugared → `30f35852-3f7e-4c0c-9a88-e127b4f97211@1` |
| `checkout` | HTTP 200 · expanded | `task` | desugared → `6d15af64-176c-496d-b583-fd2ae21d4df4@1` |
| `getPackage` | HTTP 400 · rejected · typeKey=PipelineValidationException | `` | HTTP 400 · rejected · typeKey=PipelineValidationException |
| `task-explicit` | HTTP 200 · expanded | `task` | desugared → `CmdLine@2` |
