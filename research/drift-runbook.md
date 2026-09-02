# Drift triage runbook (E11-S03-T02)

The `Oracle nightly` job (E11-S03-T01) re-expands every corpus entry against the live service and
byte-compares the answer with the committed `fixtures/oracle/<entry>.final.yml`. When it goes red,
this is what to do.

The job's own failure message points here, and the first instruction it gives is the important one:

> Classify it before changing any fixture — a service change and a bug in our request look
> identical from the report.

Re-fetching a pair is a one-line command, and it is the wrong first move. It overwrites the only
evidence that a difference existed, turns the job green, and leaves the actual change unrecorded.

---

## 0. What the report tells you, and what it does not

`.drift-report/report.md` (uploaded as a CI artifact on every run, pass or fail) has two sections.

| Section | Status | Meaning |
|---|---|---|
| Expansion byte-stability | `stable` | the service returned exactly the committed pair |
| | `drifted` | the answer differs — the diff excerpt is inline |
| | `rejected` | the service refused the request; **not** a drift |
| Convert smoke | `ok` | `convert` succeeded and `run.sh` exited 0 |
| | `run-failed` | recorded, does not fail the job (docs/06 §5 decision 75) |
| | `convert-failed` | our code refused a document the service accepted — **always a bug** |

Every line has been through `redact()`, so the organization reads as `{org}` and any token as
`{pat}`. That is deliberate and it means one thing for triage: **a diff that appears to be nothing
but `{org}` is impossible**, because redaction happens before the comparison. If you see it, the
harness is broken, not the service.

### `rejected` on every entry is a credential, not a change

The service answers a bad or expired PAT with **302** to a sign-in page, not 401 or 403
(C-E00-025) — with `curl -L` it even looks like a successful 200 full of HTML. Ten `rejected`
entries at once is that, until proven otherwise. Check the PAT expiry before reading any further;
rotation is in [`oracle-setup.md`](oracle-setup.md) ("Cleanup & rotation").

---

## 1. Reproduce

```bash
node scripts/drift.ts --expansion        # phase A only, no build needed
```

Two outcomes and they mean different things:

- **Reproduces.** Continue to step 2.
- **Does not reproduce.** Do not close it. A difference that appears and disappears is a
  *rollout*: Azure DevOps deploys by ring, so two requests minutes apart can hit different
  versions. Re-run a few times over a few hours and record both answers. An intermittent drift is
  still a service change, and it is the one most likely to be dismissed.

---

## 2. Classify: our bug or their change?

The question is not "did the answer change" — the report already established that. It is **"is our
request still the same request?"** These are checked in order, cheapest first, and the first `yes`
ends the classification.

1. **Did the input change?** `git log -1 --format=%h -- fixtures/corpus/<entry>/` against the
   pair's `fetchedAt` in `fixtures/oracle/MANIFEST.json`. If a fixture was edited and the pair was
   never re-fetched, this is not drift at all — it is a stale pair, and ordinary CI
   (`test/corpus.test.ts`) should already be red for the same reason. **Verdict: our bug.**

2. **Did the request change?** The harness sends `entry.rootYaml` as `yamlOverride` and nothing
   else. Check `git log` on `packages/fetch/src/oracle.ts` and `scripts/drift.ts` since the pair
   was fetched. A changed api-version is the classic one: the version is pinned on every request
   precisely because omitting it silently floats to a server-chosen version (C-E09-061/062).
   **Verdict: our bug.**

3. **Did the repository content change?** Entries with templates resolve them from the oracle
   repository, not from the request (C-E12-011). If someone pushed to `/corpus/<entry>/` there, the
   service is expanding different bytes than the committed fixture describes. `scripts/azdo-repo.ts`
   can list what is there. **Verdict: our bug** (or someone else's push).

4. **None of the above.** The same bytes, sent the same way, produced a different answer.
   **Verdict: service change.** Continue to step 3.

---

## 3. A service-change verdict must link the release notes it checked

This is a hard requirement of the task's Ground field, and it comes with a trap worth stating
plainly, because getting it wrong produces a *confidently wrong* verdict.

**Where to look.** `https://learn.microsoft.com/azure/devops/release-notes/` canonicalizes to
[`features-timeline`](https://learn.microsoft.com/en-us/azure/devops/release-notes/features-timeline)
— the **roadmap**. It is forward-looking: what Microsoft plans to ship and in which quarter. It is
not a changelog, and an entry there is not evidence that anything shipped (C-E12-025).

The record of what actually shipped is the per-sprint series,
`https://learn.microsoft.com/azure/devops/release-notes/<year>/sprint-<N>-update`, reachable from
[What's New](https://aka.ms/azuredevops/releasenotes). Each has an **Azure Pipelines** section
(C-E12-026). Read every sprint page published between the pair's `fetchedAt` and today.

**The trap: absence there does not refute the verdict.** The Pipelines section announces
*features*. Sprint 275's three Pipelines items were a finer-grained PR-validation comment policy, a
new Azure DevOps service connection type with `AzureCLI@3`, and Apple Silicon macOS agents
(C-E12-027) — user-visible capabilities. Nothing on that page describes how the preview endpoint
expands a template, orders keys, or normalizes a document. Those change without an announcement.

So the rule is: **link the sprint pages you read, and record what you found — including "nothing
relevant", which is the expected result.** A drift with no matching release note is still a service
change; it is just an unannounced one. What the link buys is that the next reader knows the check
was done and does not redo it.

Two further sources, worth checking and worth citing when they say something:

- the [DevOps blog](https://devblogs.microsoft.com/devops/), which sometimes carries a rollback or
  incident note the release notes never get (sprint 275 cites one for exactly that);
- [Developer Community](https://developercommunity.visualstudio.com/spaces/21/index.html), where a
  behaviour change usually surfaces as somebody else's bug report first.

---

## 4. Fixture-first: every drift becomes a permanent fixture

**Before** any pair is re-fetched and before any claim is edited.

The reasoning is that a drift is evidence that an area of behaviour is *live* — the service is
still changing it. The corpus entry that caught it is almost always broad (a matrix pipeline, an
artifact hand-off), so the next change in the same area will produce another large diff that has to
be read from scratch. A narrow entry that isolates the behaviour turns that into a one-line diff.

1. **Add a corpus entry** that exercises the drifted behaviour and as little else as possible:
   `fixtures/corpus/<NN>-<slug>/pipeline.yml` plus a `README.md` saying what it pins, which claims
   it belongs to, and which drift produced it.
2. **Fetch its pair** — `pnpm corpus-oracle <NN>-<slug>` — which pushes the entry into the oracle
   repository, previews it, redacts the answer and writes `fixtures/oracle/<NN>-<slug>.final.yml`
   plus the `MANIFEST.json` row. An entry without a pair is invalid by rule
   (`fixtures/corpus/README.md`) and `test/corpus.test.ts` enforces it.
3. **Regenerate the goldens** — `node scripts/golden.ts --update` — because the golden harness
   demands one row per corpus entry and will fail on a `missing` entry otherwise.
4. **Only now** re-fetch the drifted entry's own pair, in the same commit, so the diff a reviewer
   reads shows the change *and* the fixture that pins it side by side.

The order matters. Re-fetching first makes step 1 hypothetical — the evidence is gone and the new
fixture records what you remember rather than what you measured.

---

## 5. Claim updates

Claims are append-only in spirit: BACKLOG.md §3 says IDs are never reused, and the same applies to
what a claim asserts. A claim that was true when it was measured stays in the file.

- **The service changed its behaviour.** Add a **dated addendum** to the affected claim — do not
  rewrite it. The old text is a true statement about the old behaviour and the transcript that
  backs it still exists. The addendum names the date, the new behaviour, the drift report that
  found it, and the sprint pages checked in step 3 (including a "nothing relevant" result).
- **Our bug.** The claim was right and no addendum is due. Fix the code and add the regression
  test; cite the claim ID in the test the way E11-S02-T01's convention requires, so
  `scripts/claim-coverage.sh` counts it.
- **A behaviour nothing claimed.** Write a new claim with the next free ID in the epic's research
  file, citing the drift transcript as its evidence. This is the common case for an unannounced
  change: there was no claim because nobody had a reason to look.

Then update `research/REFERENCES.md` if a source's status changed, and append to
`CHANGELOG-BACKLOG.md` — a drift is a dated event, and the log is where it is dated.

---

## Worked example — the exercise this runbook was written against

E11-S03-T02's Done criterion is that the runbook be exercised once on a **synthetic** drift.

**The signal.** Simulated: "the nightly reports `04-variable-layers` drifted". No real drift has
occurred — every one of the ten entries has been `stable` on every run, including the first
scheduled one (2026-09-03).

**Step 1, reproduce.** `node scripts/drift.ts --expansion` reported all ten `stable`, so the
synthetic signal does not reproduce. Under a real drift this would mean "rolling deployment, keep
sampling"; here it simply confirms the signal was synthetic.

**Step 2, classify.** Walked anyway, to prove the checks are answerable rather than aspirational:
the fixture is unmodified since its pair was fetched, `oracle.ts` still pins `api-version=7.1`, and
`04-variable-layers` has no templates so nothing in the oracle repository can affect it. All three
`no` ⇒ the classification lands on **service change**, which is what a real reproducing drift would
have given.

**Step 3, release notes.** Checked and pinned: the roadmap
(`git_commit_id 467f8d6362cdfc5348b4a2e2846fbfeb4ba66f48`) and sprint 275
(`git_commit_id 598e4fec55f6de2a552fe94d6743888a6fdb16fd`). **Result: nothing relevant** — sprint
275's Pipelines section is three feature announcements and says nothing about expansion semantics.
This is the expected negative the section above warns about, recorded rather than treated as a
refutation.

**Step 4, fixture.** Produced `fixtures/corpus/11-implicit-wrapping/` with its oracle pair. It
isolates the implicit wrapping of a root-level `steps:` into `stage: __default` → `job: Job` →
`task: CmdLine@2` (C-E04-002) — a behaviour every scaffold path in the emitter depends on, asserted
by **no** corpus entry before this one (all ten declare their stages and jobs explicitly). It was
the honest choice of fixture: the point of the rule is that a drift leaves behind a narrow entry
watching a live area, and the implicit-wrapping rule is the load-bearing behaviour nearest the
variable-layer expansion the synthetic signal named.

**Step 5, claim update.** C-E04-002 carries a dated addendum recording the live re-verification and
that it is now pinned by a corpus entry, so the nightly watches it from here on. C-E04-003 (the
`jobs:`-rooted variant) is **not** pinned by a fixture and stays transcript-only — recorded as a
gap rather than quietly bundled in, because one drift produces one fixture.

**What the exercise showed about the runbook itself.** Step 2's four checks were each answerable
from the repository in one command, which is what makes the classification cheap enough to actually
perform. Step 3 was the step that needed writing down: the obvious URL is the roadmap, the sprint
pages are the real record, and a negative result there is expected rather than exonerating — a
reader who did not know that would have closed a real service change as "not in the release notes".
