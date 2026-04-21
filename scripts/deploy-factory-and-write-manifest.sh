#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
ENVIRONMENT="${DEPLOY_ENVIRONMENT:-local}"
CHAIN_ID="${CHAIN_ID:-84532}"
CHAIN_NAME="${CHAIN_NAME:-base-sepolia}"
DEFAULT_REVIEW_WINDOW_SECONDS="${DEFAULT_REVIEW_WINDOW_SECONDS:-432000}"
METADATA_VISIBILITY="${METADATA_VISIBILITY:-public}"

if [[ -z "${USDC_ADDRESS:-}" || -z "${FEE_RECIPIENT:-}" || -z "${PROTOCOL_FEE_BPS:-}" || -z "${PRIVATE_KEY:-}" ]]; then
  printf 'USDC_ADDRESS, FEE_RECIPIENT, PROTOCOL_FEE_BPS, and PRIVATE_KEY must be set\n' >&2
  exit 1
fi

mkdir -p "${ROOT_DIR}/deployments/${ENVIRONMENT}"

pushd "${CONTRACTS_DIR}" >/dev/null
forge script script/DeployEscrowFactory.s.sol:DeployEscrowFactory --private-key "$PRIVATE_KEY" --broadcast
popd >/dev/null

LATEST_RUN_DIR="$(ls -td "${CONTRACTS_DIR}/broadcast/DeployEscrowFactory.s.sol/${CHAIN_ID}"/* 2>/dev/null | head -n 1)"
if [[ -z "${LATEST_RUN_DIR}" ]]; then
  printf 'Could not find latest broadcast output for chain %s\n' "$CHAIN_ID" >&2
  exit 1
fi

LATEST_RUN_JSON="${LATEST_RUN_DIR}/run-latest.json"
if [[ ! -f "${LATEST_RUN_JSON}" ]]; then
  printf 'Missing run-latest.json in %s\n' "${LATEST_RUN_DIR}" >&2
  exit 1
fi

node --input-type=module <<'EOF' "$ROOT_DIR" "$LATEST_RUN_JSON" "$ENVIRONMENT" "$CHAIN_ID" "$CHAIN_NAME" "$DEFAULT_REVIEW_WINDOW_SECONDS" "$METADATA_VISIBILITY" "$USDC_ADDRESS" "$FEE_RECIPIENT" "$PROTOCOL_FEE_BPS"
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const [
  rootDir,
  runJsonPath,
  environment,
  chainId,
  chainName,
  defaultReviewWindowSeconds,
  metadataVisibility,
  usdc,
  feeRecipient,
  protocolFeeBps,
] = process.argv.slice(2);

const runJson = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));
const transactions = Array.isArray(runJson.transactions) ? runJson.transactions : [];
const deployment = transactions.find((item) => item.contractName === "EscrowFactory");

if (!deployment?.contractAddress) {
  throw new Error("EscrowFactory deployment not found in broadcast output.");
}

const manifest = {
  version: 1,
  environment,
  chain: {
    chainId: Number(chainId),
    name: chainName,
  },
  deployedAt: {
    blockNumber: 0,
    timestamp: new Date().toISOString(),
    txHash: deployment.hash,
  },
  contracts: {
    escrowFactory: {
      address: deployment.contractAddress,
      deploymentTxHash: deployment.hash,
      verified: false,
    },
  },
  config: {
    usdc,
    feeRecipient,
    protocolFeeBps: Number(protocolFeeBps),
    creationPauseSupported: true,
    defaultReviewWindowSeconds: Number(defaultReviewWindowSeconds),
    metadataVisibility,
  },
  artifacts: {
    commitSha: execSync("git rev-parse HEAD", { cwd: rootDir, encoding: "utf8" }).trim(),
    contractBuildId: path.basename(path.dirname(runJsonPath)),
  },
};

const manifestPath = path.join(rootDir, "deployments", environment, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Wrote manifest to ${manifestPath}`);
EOF
