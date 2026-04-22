#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DOCS=(
  "docs/RUNBOOKS.md"
  "docs/LOCAL_STACK_RUNBOOK.md"
  "docs/TESTING_AND_DEPLOYMENT_STRATEGY.md"
)

rg -n "verify-s03-operability.sh|verify-s02-recovery.sh|rehearsal-recovery-verification.json|canary abort|rollback|/health" "${DOCS[@]}" >/dev/null
! rg -n "TODO|TBD" "${DOCS[@]}" >/dev/null

echo "[verify-m006-s01-docs] status=pass"
