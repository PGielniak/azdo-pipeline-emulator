#!/usr/bin/env bash
# Encoded-secret guard (E09-S03-T02, C-E09-094).
#
# `redact()` and the runbook's `grep` for the organization name both match **literal**
# text. On 2026-09-22 an Azure `signedContent.url` put the organization name into a
# research transcript inside a **base64** path segment — the blob decodes to
# `pipelineartifact://<org>/projectId/<guid>/buildId/<n>/artifactName/<name>` — and both
# checks came back clean. This gate is the one that would not have.
#
# It decodes every base64-looking run in tracked (or staged) text and looks for Azure
# DevOps identifiers in the **decoded** bytes. The indicators are structural, not a secret
# list, so the gate is meaningful in CI with no credential available; when `AZDO_ORG_URL`
# is set (or `.env.oracle` is present locally) the org slug is checked too, raw and encoded.
#
#   --all          (default) scan tracked files — used by CI
#   --staged       scan staged content — used by .githooks/pre-commit
#   --file <path>  scan one file, tracked or not — for checking a capture before it lands
#   --self-test    prove the detector fires; a scan that cannot fail is not a gate
#
# **It never prints what it found.** A scanner that echoes the secret into a CI log has
# moved the leak rather than caught it, so a finding names the file and the *class*.
#
# Works on bash 3.2 (macOS system bash). No pipes into functions: fail state must not be
# set in a subshell.
set -euo pipefail

# Identifiers that have no business being encoded inside committed evidence. `vstfs:///`
# and `pipelineartifact://` are ADO-internal URI schemes; the two hosts cover both the
# current and legacy service domains.
indicators='pipelineartifact://|vstfs:///|dev\.azure\.com|\.visualstudio\.com'

mode="${1:---all}"
fail=0

org_slug=""
if [[ -n "${AZDO_ORG_URL:-}" ]]; then
  org_slug="${AZDO_ORG_URL##*/}"
elif [[ -f .env.oracle ]]; then
  # The org *URL* only — never a variable-group value (CLAUDE.md rule 4).
  org_slug="$(sed -n 's|^AZDO_ORG_URL=.*/||p' .env.oracle | tr -d '\r' | head -1)"
fi

# macOS's base64 spells the decode flag `-D`; GNU coreutils spells it `-d`. Probe once.
b64_flag='-d'
printf 'aGk=' | base64 -d >/dev/null 2>&1 || b64_flag='-D'

# Decodes each base64-looking run on stdin and prints its printable text, one per line.
# Both alphabets: standard (`+/`) and URL-safe (`-_`), which is what appears in a signed
# URL's path. Undecodable runs — GUIDs, sha256s, ordinary long words — drop out silently.
decode_blobs() {
  local blob padded runs
  # Two passes, because `/` is **both** a base64 character and a path separator: a greedy
  # run swallows whole `a/b/c` paths into something that decodes to nothing, which is
  # exactly how the 2026-09-22 blob would have slipped past a single-pass scan. Pass one
  # keeps runs that genuinely contain `/`; pass two splits on it for the segment case.
  # `|| true`: grep exits 1 on a file with no candidate run at all, which is most of them,
  # and under `set -e` that ends the scan silently on the first such file.
  runs="$(grep -ohaE '[A-Za-z0-9+/_-]{24,}={0,2}' || true)"
  { printf '%s\n' "$runs"; printf '%s\n' "$runs" | tr '/' '\n'; } |
    grep -aE '^[A-Za-z0-9+/_-]{24,}={0,2}$' | sort -u | while IFS= read -r blob; do
    padded="${blob%%=*}"
    while ((${#padded} % 4 != 0)); do padded="${padded}="; done
    printf '%s' "$padded" | tr '_-' '/+' | base64 "$b64_flag" 2>/dev/null | tr -dc '\40-\176\n'
    printf '\n'
    # `|| true`: under `pipefail` a filter that matches nothing fails the whole pipeline,
    # and a file with no candidate run is the common case, not an error.
  done || true
}

report() {
  printf 'error: %s — %s\n' "$1" "$2" >&2
  fail=1
}

# $1 = label to report, $2 = path holding the content to scan.
check_file() {
  local label="$1" path="$2" decoded
  grep -Iq . -- "$path" 2>/dev/null || return 0 # binary: nothing text-shaped to decode

  if [[ -n "$org_slug" ]] && grep -qiF -- "$org_slug" "$path"; then
    report "$label" 'organization name in plain text'
  fi

  decoded="$(decode_blobs <"$path")"
  if printf '%s\n' "$decoded" | grep -qE "$indicators"; then
    report "$label" 'an Azure DevOps identifier inside base64 content'
  fi
  if [[ -n "$org_slug" ]] && printf '%s\n' "$decoded" | grep -qiF -- "$org_slug"; then
    report "$label" 'organization name inside base64 content'
  fi
}

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

case "$mode" in
  --all)
    while IFS= read -r f; do
      check_file "$f" "$f"
    done < <(git ls-files)
    ;;
  --staged)
    while IFS= read -r f; do
      git show ":$f" >"$tmp" 2>/dev/null || continue
      check_file "$f" "$tmp"
    done < <(git diff --cached --name-only --diff-filter=ACMR)
    ;;
  --file)
    [[ -n "${2:-}" && -f "$2" ]] || {
      echo "usage: $0 --file <path>" >&2
      exit 2
    }
    check_file "$2" "$2"
    ;;
  --self-test)
    # The exact shape that got through on 2026-09-22, with a placeholder org.
    printf 'GET https://x.example/_apis/public/artifact/%s/content\n' \
      "$(printf 'pipelineartifact://example-org/projectId/0/artifactName/drop' | base64 | tr -d '\n')" >"$tmp"
    check_file 'self-test' "$tmp" 2>/dev/null
    if [[ "$fail" -eq 0 ]]; then
      echo 'error: self-test — the detector did not fire on a known-bad sample' >&2
      exit 1
    fi
    fail=0
    if [[ -n "$org_slug" ]]; then
      printf 'blob %s\n' "$(printf 'pipelineartifact://%s/x' "$org_slug" | base64 | tr -d '\n')" >"$tmp"
      check_file 'self-test' "$tmp" 2>/dev/null
      if [[ "$fail" -eq 0 ]]; then
        echo 'error: self-test — the org-slug check did not fire' >&2
        exit 1
      fi
      echo 'self-test ok (indicators + org slug)'
    else
      echo 'self-test ok (indicators; no AZDO_ORG_URL, so the org-slug half is inactive)'
    fi
    exit 0
    ;;
  *)
    echo "usage: $0 [--all|--staged|--file <path>|--self-test]" >&2
    exit 2
    ;;
esac

if [[ "$fail" -ne 0 ]]; then
  echo 'error: encoded secret material found — redact before committing (research/oracle-setup.md §hygiene)' >&2
  exit 1
fi
