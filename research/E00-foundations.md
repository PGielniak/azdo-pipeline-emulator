# E00 — Foundations: grounding notes

Claim format per BACKLOG.md §3. IDs sequential, never reused.

## E00-S01-T01 — Monorepo scaffold (D1 / Node LTS verification)

Design rationale consumed: PLAN.md §5 D1 — converter is TypeScript/Node ≥ 22 (task-ecosystem synergy,
`yaml` CST, MSAL, npm distribution). D1 is an internal decision; the external fact to verify is that
"Node ≥ 22" is a *supported LTS* floor.

[C-E00-001] Node.js 22 ("Jod") is a supported LTS line as of 2026-07-30: LTS start 2024-10-29,
Maintenance LTS since 2025-10-21, end-of-life 2027-04-30 — so PLAN.md D1's "Node ≥ 22" floor is a
supported-LTS floor (not EOL) until 2027-04-30.
  — https://github.com/nodejs/Release/blob/e4bf922d83b877a116763e2f83d2d9b6701871f9/schedule.json (checked 2026-07-30)
  — `"v22": {"start": "2024-04-24", "lts": "2024-10-29", "maintenance": "2025-10-21", "end": "2027-04-30", "codename": "Jod"}`
  — corroborated by https://nodejs.org/en/about/previous-releases (v22 and v24 listed LTS, v26 Current; checked 2026-07-30)

[C-E00-002] Node.js 24 ("Krypton") is the current Active LTS (Maintenance from 2026-10-20, EOL
2028-04-30) and Node 20 is EOL since 2026-04-30 — CI (E00-S01-T02) should therefore test on Node 22
and 24, and the engines floor must not be raised above 22 without a decision-record entry.
  — https://github.com/nodejs/Release/blob/e4bf922d83b877a116763e2f83d2d9b6701871f9/schedule.json (checked 2026-07-30)
  — `"v24": {"start": "2025-05-06", "lts": "2025-10-28", "maintenance": "2026-10-20", "end": "2028-04-30", "codename": "Krypton"}` · `"v20": {…, "end": "2026-04-30"}`

### Toolchain versions pinned at scaffold time (2026-07-30)

- Local Node: v22.23.1 (maintenance-LTS line — satisfies engines `>=22`).
- pnpm: 11.18.0 (activated via corepack; recorded in root `package.json` `packageManager`).
- TypeScript pinned to the 5.x line (5.9.3 at scaffold): latest-resolved TS 7.0.2 (native compiler)
  breaks tsup dts emission (rollup-plugin-dts crash) and typescript-eslint 8.65 peer range is
  `>=4.8.4 <6.1.0`. Not a D1 change (D1 fixes the language, not the compiler major); revisit when
  tsup/typescript-eslint declare TS 7 support.
- bats 1.13.0 via the npm `bats` package (bats-core's official npm distribution) as a
  `packages/runtime` devDependency; formal bats-core doc grounding happens in E00-S01-T02.
- shellcheck v0.11.0 binary via the npm `shellcheck@4.1.0` wrapper (runtime devDependency;
  `allowBuilds` in pnpm-workspace.yaml lets its postinstall fetch the binary at install time) so
  `pnpm lint` works on machines without a system shellcheck.
