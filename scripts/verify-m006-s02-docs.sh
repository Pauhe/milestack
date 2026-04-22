#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DOCS=(
  "README.md"
  "PRODUCT_SPEC.md"
  "docs/DELIVERY_PLAN.md"
  "docs/RUNBOOKS.md"
  "docs/LOCAL_STACK_RUNBOOK.md"
  "docs/TESTING_AND_DEPLOYMENT_STRATEGY.md"
)

for doc in "${DOCS[@]}"; do
  if [[ ! -f "${doc}" ]]; then
    echo "[verify-m006-s02-docs] missing required doc: ${doc}" >&2
    exit 1
  fi
done

# Fail closed on unresolved placeholders in closure set docs.
if rg -n "TODO|TBD" "${DOCS[@]}" >/dev/null; then
  echo "[verify-m006-s02-docs] unresolved TODO/TBD marker detected in closure docs" >&2
  exit 1
fi

# Commands and evidence artifacts must be referenced exactly.
REQUIRED_EXACT_PATTERNS=(
  "bash scripts/verify-s02-recovery.sh"
  "bash scripts/verify-s03-operability.sh"
  "deployments/rehearsal-local/rehearsal-recovery-verification.json"
  "deployments/rehearsal-local/operability-verification.json"
  "/health.sync.freshness"
  "/health.sync.degraded"
  "/health.sync.status"
  "/health.sync.phase"
  "/health.sync.lagBlocks"
  "/health.sync.lastError"
)

for pattern in "${REQUIRED_EXACT_PATTERNS[@]}"; do
  if ! rg -n --fixed-strings "${pattern}" "${DOCS[@]}" >/dev/null; then
    echo "[verify-m006-s02-docs] missing required reference: ${pattern}" >&2
    exit 1
  fi
done

# Boundary wording must stay fail-closed and explicit.
if ! rg -n "no-launch|no launch" "${DOCS[@]}" >/dev/null; then
  echo "[verify-m006-s02-docs] missing fail-closed no-launch wording" >&2
  exit 1
fi

if ! rg -n "canary abort" "${DOCS[@]}" >/dev/null; then
  echo "[verify-m006-s02-docs] missing canary abort wording" >&2
  exit 1
fi

if ! rg -n "offchain-only rollback|offchain only rollback" "${DOCS[@]}" >/dev/null; then
  echo "[verify-m006-s02-docs] missing offchain-only rollback wording" >&2
  exit 1
fi

# Fail if broad canary claims appear without explicit rehearsal-local boundary in same doc.
while IFS= read -r hit; do
  IFS=':' read -r doc_path line_number _ <<< "${hit}"

  if ! rg -n "rehearsal-local|rehearsal local" "${doc_path}" >/dev/null; then
    echo "[verify-m006-s02-docs] broad canary wording without rehearsal-local boundary in ${doc_path}:${line_number}" >&2
    exit 1
  fi
done < <(rg -n "mainnet canary|production canary|staging canary" "${DOCS[@]}" || true)

echo "[verify-m006-s02-docs] status=pass"