#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"

curl --fail --silent --show-error -X POST "${BACKEND_URL}/sync"
