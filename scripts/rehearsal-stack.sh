#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-rehearsal-local}"
export DEPLOY_ENVIRONMENT

printf '[rehearsal-stack] environment=%s\n' "${DEPLOY_ENVIRONMENT}"

if [[ "${SKIP_FACTORY_DEPLOY:-0}" != "1" ]]; then
  printf '[rehearsal-stack] phase=deploy-manifest status=running\n'
  "${ROOT_DIR}/scripts/deploy-factory-and-write-manifest.sh"
  printf '[rehearsal-stack] phase=deploy-manifest status=complete\n'
else
  printf '[rehearsal-stack] phase=deploy-manifest status=skipped reason=SKIP_FACTORY_DEPLOY\n'
fi

printf '[rehearsal-stack] phase=seed-data status=running\n'
node "${ROOT_DIR}/scripts/bootstrap-rehearsal-data.ts"
printf '[rehearsal-stack] phase=seed-data status=complete\n'

printf '[rehearsal-stack] ready manifest=deployments/%s/manifest.json seeds=deployments/%s/seeded-journeys.json\n' "${DEPLOY_ENVIRONMENT}" "${DEPLOY_ENVIRONMENT}"
