# Milestack Deployment Manifest Spec

## 1. Purpose

This document defines how Milestack deployment artifacts and environment-specific contract configuration should be recorded.

The goal is to avoid ambiguous or manual production configuration by making every deployment produce a structured manifest that can be consumed by:
- backend services
- frontend apps
- indexers
- operational tooling
- reviewers and auditors

## 2. Principles

1. Every deployment produces a manifest.
2. Manifests are environment-specific and immutable once published.
3. Frontend and backend configuration should be derived from manifests rather than handwritten values.
4. Historical manifests must be retained for auditability.

## 3. Environments

Milestack should maintain manifests for at least:

1. local
2. ci-ephemeral where applicable
3. staging on Base Sepolia
4. production on Base mainnet

## 4. Manifest File Layout

Recommended repository layout:

```text
deployments/
  local/
    manifest.json
  staging-base-sepolia/
    manifest.json
  production-base/
    manifest.json
```

Optional additions:
- per-deployment timestamped snapshots
- deployment receipts
- ABI snapshots if needed

## 5. Required Manifest Fields

Suggested top-level JSON shape:

```json
{
  "version": 1,
  "environment": "staging-base-sepolia",
  "chain": {
    "chainId": 84532,
    "name": "base-sepolia"
  },
  "deployedAt": {
    "blockNumber": 123456,
    "timestamp": "2026-04-20T12:00:00Z",
    "txHash": "0x..."
  },
  "contracts": {
    "escrowFactory": {
      "address": "0x...",
      "deploymentTxHash": "0x...",
      "verified": false
    }
  },
  "config": {
    "usdc": "0x...",
    "feeRecipient": "0x...",
    "protocolFeeBps": 100,
    "creationPauseSupported": true
  },
  "artifacts": {
    "commitSha": "abc123",
    "contractBuildId": "build-001"
  }
}
```

## 6. Field Definitions

### 6.1 Top-level

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | integer | yes | manifest schema version |
| `environment` | string | yes | environment identifier |
| `chain` | object | yes | deployed chain info |
| `deployedAt` | object | yes | deployment anchor data |
| `contracts` | object | yes | deployed contract addresses |
| `config` | object | yes | runtime config for environment |
| `artifacts` | object | yes | build provenance |

### 6.2 `chain`

| Field | Type | Required | Notes |
|---|---|---|---|
| `chainId` | integer | yes | chain id |
| `name` | string | yes | canonical environment name |

### 6.3 `deployedAt`

| Field | Type | Required | Notes |
|---|---|---|---|
| `blockNumber` | integer | yes | first deployment block |
| `timestamp` | string | yes | ISO8601 |
| `txHash` | string | yes | deployment anchor tx |

### 6.4 `contracts`

At minimum:

```json
{
  "escrowFactory": {
    "address": "0x...",
    "deploymentTxHash": "0x...",
    "verified": true
  }
}
```

If later versions add other protocol contracts, they should be added here without changing the overall structure.

### 6.5 `config`

Required config fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `usdc` | string | yes | token address |
| `feeRecipient` | string | yes | fee recipient address |
| `protocolFeeBps` | integer | yes | seller-side fee bps |
| `creationPauseSupported` | boolean | yes | whether factory pause exists |

Recommended additional config fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `defaultReviewWindowSeconds` | integer | recommended | should be `432000` for MVP |
| `metadataVisibility` | string | recommended | `public` for MVP |

### 6.6 `artifacts`

Required fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `commitSha` | string | yes | git commit used for deployment |
| `contractBuildId` | string | yes | build artifact identifier |

Recommended additional fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `frontendBuildId` | string | no | if frontend tied to deployment |
| `backendBuildId` | string | no | if backend tied to deployment |

## 7. Per-Environment Contract Registry

In addition to manifests, Milestack should maintain a human-readable registry table in docs or ops tooling.

Recommended registry fields:

| Environment | Chain | EscrowFactory | USDC | Fee Recipient | Fee Bps | Status |
|---|---|---|---|---|---|---|
| local | local-anvil | `0x...` | `0x...` | `0x...` | 100 | active |
| staging-base-sepolia | Base Sepolia | `0x...` | `0x...` | `0x...` | 100 | active |
| production-base | Base | `0x...` | `0x...` | `0x...` | 100 | active |

The manifest remains the source of machine-readable truth. The registry is an operator convenience layer.

## 8. Consumer Rules

### 8.1 Backend

The backend should:

1. load the correct manifest for its environment
2. validate chain id and contract addresses at boot
3. fail fast if required fields are missing
4. expose manifest version and key config in health endpoints

### 8.2 Frontend

The frontend should:

1. load environment-appropriate manifest data at build or runtime
2. validate chain id before enabling actions
3. use manifest-derived contract addresses only

### 8.3 Deployment scripts

Deployment scripts should:

1. write the manifest automatically after successful deployment
2. refuse to overwrite an existing production manifest without explicit operator intent
3. record transaction hashes and block numbers

## 9. Validation Rules

Before a manifest is accepted:

1. addresses must be valid checksummed or normalized addresses
2. chain id must match the target environment
3. fee bps must match the intended deployment config
4. referenced deployment transaction must exist
5. contract read checks should confirm the deployed config matches manifest contents

## 10. Production Requirements

For production manifests specifically:

1. manifest must include exact commit SHA
2. manifest must be reviewed before frontend/backend cutover
3. manifest must be retained permanently
4. any manifest change must be auditable

## 11. Example Production Manifest

```json
{
  "version": 1,
  "environment": "production-base",
  "chain": {
    "chainId": 8453,
    "name": "base"
  },
  "deployedAt": {
    "blockNumber": 9876543,
    "timestamp": "2026-05-02T16:10:00Z",
    "txHash": "0xdeployment"
  },
  "contracts": {
    "escrowFactory": {
      "address": "0xFactory",
      "deploymentTxHash": "0xdeployment",
      "verified": true
    }
  },
  "config": {
    "usdc": "0xUSDC",
    "feeRecipient": "0xFee",
    "protocolFeeBps": 100,
    "creationPauseSupported": true,
    "defaultReviewWindowSeconds": 432000,
    "metadataVisibility": "public"
  },
  "artifacts": {
    "commitSha": "05c1a34",
    "contractBuildId": "foundry-build-2026-05-02"
  }
}
```

## 12. Non-Goals

This spec does not define:

1. secret storage format
2. private key management
3. vendor-specific deployment tooling

It only defines what deployment outputs must exist and how they should be consumed.
