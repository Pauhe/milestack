# Milestack Data Model

## 1. Purpose

This document defines the MVP data model across:
- onchain contract state
- indexed backend storage
- API response shapes used by the frontend

The goal is to keep the smart contracts minimal while making the backend expressive enough for timelines, reputation, and deal pages.

## 2. Modeling Principles

1. Settlement truth lives onchain.
2. User-facing descriptions and attachments live offchain.
3. Backend data should be reproducible from chain events plus referenced metadata.
4. Derived fields are allowed in APIs, but raw underlying state should remain visible.

## 3. Onchain Data Model

### 3.1 `DealConfig`

Suggested fields:

| Field | Type | Notes |
|---|---|---|
| `buyer` | `address` | immutable after creation |
| `seller` | `address` | immutable after creation |
| `arbiter` | `address` | immutable after creation |
| `token` | `address` | USDC for MVP |
| `feeRecipient` | `address` | protocol fee recipient |
| `protocolFeeBps` | `uint16` | seller-side fee basis points |
| `metadataHash` | `bytes32` | canonical reference to deal metadata |

### 3.2 `DealRuntime`

Suggested fields:

| Field | Type | Notes |
|---|---|---|
| `dealStatus` | `uint8` enum | `Draft`, `Active`, `Completed`, `Cancelled` |
| `currentMilestoneIndex` | `uint32` | current sequential milestone |
| `activeDisputeMilestoneId` | `uint32` or sentinel | tracks blocking dispute |
| `totalFunded` | `uint256` | aggregate funded amount |
| `totalReleasedToSeller` | `uint256` | aggregate seller payouts |
| `totalRefundedToBuyer` | `uint256` | aggregate buyer refunds |
| `totalFeesCollected` | `uint256` | aggregate protocol fees |

### 3.3 `Milestone`

Suggested fields:

| Field | Type | Notes |
|---|---|---|
| `amount` | `uint256` | fixed at creation |
| `status` | `uint8` enum | current milestone state |
| `reviewWindowSeconds` | `uint32` | fixed at creation |
| `submittedAt` | `uint64` | zero until submitted |
| `reviewDeadline` | `uint64` | derived at submission time |
| `evidenceHash` | `bytes32` | canonical evidence reference |
| `disputeHash` | `bytes32` | canonical dispute reference |
| `buyerAward` | `uint256` | set on dispute resolution |
| `sellerAward` | `uint256` | set on dispute resolution |

## 4. Offchain Metadata Model

The contract should not store verbose descriptions or attachments. Those live in an offchain metadata document whose canonical content is represented by `metadataHash`.

### 4.1 Suggested deal metadata JSON

```json
{
  "version": 1,
  "title": "Website redesign for ExampleCo",
  "summary": "Design and implement a five-page marketing site",
  "buyer": {
    "address": "0x...",
    "displayName": "ExampleCo"
  },
  "seller": {
    "address": "0x...",
    "displayName": "Studio North"
  },
  "arbiter": {
    "address": "0x...",
    "displayName": "Neutral Arbiter LLC"
  },
  "termsUrl": "https://...",
  "milestones": [
    {
      "id": 0,
      "title": "Discovery and wireframes",
      "description": "Deliver wireframes for homepage, pricing, and contact pages",
      "deliverableChecklist": [
        "Figma wireframes",
        "Requirements summary",
        "Revision note"
      ]
    }
  ]
}
```

### 4.2 Submission metadata

The submission metadata can be stored separately, referenced by `evidenceHash`, or represented by a content-hash over a normalized payload.

Suggested shape:

```json
{
  "version": 1,
  "milestoneId": 0,
  "submittedBy": "0x...",
  "note": "Wireframes and scope notes delivered in Figma and Notion",
  "references": [
    {
      "type": "figma",
      "url": "https://figma.com/..."
    },
    {
      "type": "document",
      "url": "https://notion.so/..."
    }
  ]
}
```

### 4.3 Dispute metadata

Suggested shape:

```json
{
  "version": 1,
  "milestoneId": 0,
  "openedBy": "0x...",
  "reasonCode": "scope_mismatch",
  "note": "Delivered wireframes omitted the pricing page and did not match agreed copy structure",
  "references": [
    {
      "type": "document",
      "url": "https://..."
    }
  ]
}
```

## 5. Backend Storage Model

The backend should be able to fully rebuild state from chain events and metadata fetches.

### 5.1 `escrows`

Suggested columns:

| Column | Type | Notes |
|---|---|---|
| `address` | text PK | escrow address |
| `buyer_address` | text | checksum or normalized |
| `seller_address` | text | checksum or normalized |
| `arbiter_address` | text | checksum or normalized |
| `token_address` | text | USDC token address |
| `deal_status` | text | mirrored derived status |
| `metadata_hash` | text | bytes32 as hex |
| `metadata_url` | text nullable | fetched source if known |
| `milestone_count` | integer | total milestones |
| `current_milestone_index` | integer | derived current index |
| `active_dispute_milestone_id` | integer nullable | current blocker |
| `total_funded` | numeric | token precision-safe |
| `total_released_to_seller` | numeric | token precision-safe |
| `total_refunded_to_buyer` | numeric | token precision-safe |
| `total_fees_collected` | numeric | token precision-safe |
| `created_at_block` | bigint | creation block |
| `created_at_time` | timestamptz | block time |
| `updated_at_time` | timestamptz | last processed event time |

### 5.2 `milestones`

Suggested columns:

| Column | Type | Notes |
|---|---|---|
| `escrow_address` | text | FK to `escrows` |
| `milestone_id` | integer | composite PK with escrow |
| `amount` | numeric | token precision-safe |
| `status` | text | current milestone status |
| `review_window_seconds` | integer | fixed per milestone |
| `submitted_at` | timestamptz nullable | from event |
| `review_deadline` | timestamptz nullable | derived and indexed |
| `evidence_hash` | text nullable | bytes32 hex |
| `dispute_hash` | text nullable | bytes32 hex |
| `buyer_award` | numeric nullable | set on resolution |
| `seller_award` | numeric nullable | set on resolution |
| `metadata_title` | text nullable | denormalized from metadata |
| `metadata_description` | text nullable | denormalized from metadata |

### 5.3 `events`

Suggested columns:

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | internal identifier |
| `chain_id` | integer | chain source |
| `block_number` | bigint | ordering |
| `block_time` | timestamptz | ordering |
| `tx_hash` | text | unique with log index |
| `log_index` | integer | unique with tx hash |
| `escrow_address` | text | source escrow |
| `event_name` | text | normalized event type |
| `payload_json` | jsonb | raw decoded event payload |

### 5.4 `users`

Suggested columns:

| Column | Type | Notes |
|---|---|---|
| `address` | text PK | wallet address |
| `display_name` | text nullable | user-supplied or ENS-derived |
| `ens_name` | text nullable | optional enrichment |
| `first_seen_at` | timestamptz | first indexed activity |
| `last_seen_at` | timestamptz | latest indexed activity |

### 5.5 `user_role_stats`

Suggested columns:

| Column | Type | Notes |
|---|---|---|
| `address` | text | FK to users |
| `role` | text | `buyer`, `seller`, `arbiter` |
| `completed_deals_count` | integer | derived |
| `completed_milestones_count` | integer | derived |
| `dispute_count` | integer | derived |
| `dispute_wins_count` | integer | derived |
| `cancellation_count` | integer | derived |
| `total_volume` | numeric | role-specific volume |
| `updated_at_time` | timestamptz | snapshot time |

### 5.6 `milestone_timeline_entries`

Suggested columns:

| Column | Type | Notes |
|---|---|---|
| `escrow_address` | text | FK to escrows |
| `milestone_id` | integer | FK to milestones |
| `event_time` | timestamptz | timeline ordering |
| `entry_type` | text | e.g. `funded`, `submitted`, `disputed` |
| `actor_address` | text nullable | actor if derivable |
| `summary` | text | UI-ready plain summary |
| `payload_json` | jsonb | structured details |

## 6. API Response Model

The API should provide both raw and derived fields. The frontend should not need to compute contract semantics from scratch for routine rendering.

### 6.1 `GET /escrows/:address`

Example response:

```json
{
  "address": "0xEscrow",
  "chainId": 8453,
  "dealStatus": "Active",
  "buyer": {
    "address": "0xBuyer",
    "displayName": "ExampleCo"
  },
  "seller": {
    "address": "0xSeller",
    "displayName": "Studio North"
  },
  "arbiter": {
    "address": "0xArbiter",
    "displayName": "Neutral Arbiter LLC"
  },
  "token": {
    "symbol": "USDC",
    "address": "0xUSDC",
    "decimals": 6
  },
  "metadataHash": "0x...",
  "milestoneCount": 4,
  "currentMilestoneIndex": 1,
  "activeDisputeMilestoneId": null,
  "totals": {
    "funded": "8000.00",
    "releasedToSeller": "2000.00",
    "refundedToBuyer": "0.00",
    "feesCollected": "20.00"
  },
  "derived": {
    "isBlockedByDispute": false,
    "nextActionableMilestoneId": 1
  }
}
```

### 6.2 `GET /escrows/:address/milestones`

Example response:

```json
{
  "items": [
    {
      "milestoneId": 1,
      "title": "Homepage implementation",
      "description": "Implement homepage and pricing page from approved wireframes",
      "amount": "3000.00",
      "status": "Submitted",
      "reviewWindowSeconds": 432000,
      "submittedAt": "2026-04-20T10:30:00Z",
      "reviewDeadline": "2026-04-25T10:30:00Z",
      "evidenceHash": "0x...",
      "disputeHash": null,
      "buyerAward": null,
      "sellerAward": null,
      "derived": {
        "isCurrent": true,
        "isBlocked": false,
        "buyerCanApprove": true,
        "buyerCanDispute": true,
        "sellerCanClaim": false
      }
    }
  ]
}
```

### 6.3 `GET /escrows/:address/timeline`

Example response:

```json
{
  "items": [
    {
      "time": "2026-04-20T10:31:02Z",
      "type": "milestone_submitted",
      "milestoneId": 1,
      "summary": "Seller submitted milestone 1 with evidence",
      "actor": {
        "address": "0xSeller",
        "role": "seller"
      },
      "payload": {
        "evidenceHash": "0x...",
        "reviewDeadline": "2026-04-25T10:30:00Z"
      }
    }
  ]
}
```

### 6.4 `GET /users/:address/reputation`

Example response:

```json
{
  "address": "0xSeller",
  "buyerStats": {
    "completedDeals": 1,
    "completedMilestones": 2,
    "disputesOpened": 0,
    "disputeWins": 0,
    "cancellations": 0,
    "totalVolume": "0.00"
  },
  "sellerStats": {
    "completedDeals": 7,
    "completedMilestones": 19,
    "disputesOpenedAgainst": 2,
    "disputeWins": 1,
    "cancellations": 1,
    "totalVolume": "48250.00"
  },
  "arbiterStats": null
}
```

## 7. Derived Field Rules

Derived fields should follow explicit logic.

Examples:
- `isBlockedByDispute = activeDisputeMilestoneId != null`
- `buyerCanApprove = status == Submitted && now <= reviewDeadline`
- `buyerCanDispute = status == Submitted && now <= reviewDeadline`
- `sellerCanClaim = status == Claimable && now > reviewDeadline`

This keeps backend and frontend behavior aligned.

## 8. Rebuildability Requirement

The backend should be able to:
1. rebuild current escrow state from chain events
2. recompute reputation snapshots from event history
3. re-fetch and re-validate metadata by hash

If a backend-only field cannot be recreated from chain history and referenced metadata, it should be treated as convenience state rather than trusted state.
