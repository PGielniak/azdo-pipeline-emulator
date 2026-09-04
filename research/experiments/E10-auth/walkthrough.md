# E10-S03-T01 — `auth status` / `auth login` manual walkthrough

The Done field asks for a recorded manual walkthrough. This is it: the shipped commands run through
`run()` against the **live test organization**, with the real `az` session and the real `AZDO_PAT`
that `.env.oracle` carries.

**Redacted before writing, not before committing.** The organization is the owner's personal Azure
DevOps org and the identity is a real person: the org URL is replaced with
`https://dev.azure.com/REDACTED` and the display name and e-mail with `REDACTED` throughout. No
token appears in any of these outputs — `authStatus` returns no token field, and the report never
prints `credential.token`.

## Run 1 — no flags: the auto chain, and the trap it walks into

```
--- exit 1 ---
https://dev.azure.com/REDACTED
  mode        az
  identity    the organization rejected this credential (HTTP 302)
  expires     2026-09-04T12:36:53.000Z
  interactive unavailable — the device-code flow is not built yet (E09-S01-T01); no stored interactive credential was consulted
  works       --mode pat authenticates against this organization
ERR azdo-emu: signed in as az, but https://dev.azure.com/REDACTED did not accept the credential
ERR   run with `--mode pat`; the automatic chain tries az first and this organization refuses it (C-E09-023)
```

This is C-E09-022/023 reproduced end to end, and it is why the command probes past the first
refusal (C-E10-032). `AUTH_MODE_ORDER` is `interactive → az → pat`; the `az` session wins selection,
mints a token, and every organization endpoint answers **302** because the org is
Microsoft-account-backed. A `PAT` sitting in the same shell authenticates on the same URL.

Two things the output does **not** say are as deliberate as what it does:

- It does not say "run `az login`". That is the loop C-E09-023 exists to prevent: the sign-in
  succeeds every time and the organization refuses the result every time.
- It does not silently switch to `pat` and report success. `convert` uses `selectAzureCredential`'s
  answer, so a status command that reported a *different* mode would disagree with the tool it
  exists to explain. The working mode is offered as an instruction.

## Run 2 — `--mode pat`: the arm that works

```
--- exit 0 ---
https://dev.azure.com/REDACTED
  mode        pat (from AZDO_PAT)
  identity    REDACTED
  expires     not known locally
```

`expires not known locally` is exact rather than comforting: a PAT's lifetime lives in Azure DevOps
and is not derivable from the value. Claiming "never" would hold right up to the morning it stops.

## Run 3 — `--json`

```json
{
  "version": 1,
  "lines": [
    "https://dev.azure.com/REDACTED",
    "  mode        pat (from AZDO_PAT)",
    "  identity    REDACTED",
    "  expires     not known locally"
  ],
  "failure": null
}
```

The document carries the **verdict** (`failure`), not only the table, so a tool never has to scrape
prose to learn whether authentication worked.

## Non-TTY

Nothing above changes off a terminal, because nothing in this command is terminal-dependent
(C-E10-034). The Do field asks for a spinner; the only operation that would justify one is polling
the device-code endpoint, and that flow does not exist. Asserted rather than asserted-by-eye: the
suite checks that neither stream contains an escape byte.

## What this walkthrough could not exercise

- **The device-code display** (`--mode interactive`) — E09-S01-T01 is unbuilt and needs a person at
  a browser. The command refuses with that pointer instead of rendering a code nothing will mint.
- **`auth login --github`** — refused by design (C-E10-033): there is no GitHub sign-in flow.
- **A successful `az` arm** — it needs an Entra-backed organization, which this one is not
  (C-E09-022). The `az` arm is exercised here only in its rejected form, which is the case the
  remediation exists for.
