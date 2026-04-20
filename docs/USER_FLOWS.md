# Milestack User Flows

## 1. Purpose

This document defines MVP user flows and screen states for the Milestack web app.

It focuses on:
- primary user journeys
- required screen states
- empty states
- loading states
- error states

The goal is to make the frontend implementable without inventing product behavior ad hoc.

## 2. Primary Roles

- Buyer
- Seller
- Arbiter
- Visitor or unauthenticated user

## 3. Core Screens

1. Landing page
2. Create Deal
3. Deal Overview
4. Milestone Detail
5. Dispute View
6. Reputation Profile

## 4. Landing Page

### Purpose

Explain the product clearly and convert the right users into trying a deal.

### Must communicate

- Milestack is non-custodial escrow for digital work
- sellers submit, buyers approve or dispute
- silence after the review window allows seller claim
- disputes are handled by a pre-selected arbiter in MVP

### States

Normal:
- headline, explanation, high-level flow, CTA to create or view a deal

Loading:
- minimal skeleton only if dynamic wallet data is shown

Empty:
- not applicable

Error:
- if network status or chain config fails to load, show a non-blocking banner

## 5. Create Deal Flow

### Purpose

Allow the seller to create a new milestone-based escrow agreement.

### Recommended steps

1. Counterparties and arbiter
2. Milestones and amounts
3. Review windows and terms reference
4. Review and deploy

### Inputs

- buyer wallet address
- arbiter wallet address
- deal title or summary
- milestone titles and descriptions
- milestone amounts
- review window per milestone
- external terms URL or uploaded metadata reference

### Validations

- wallet addresses must be syntactically valid
- buyer, seller, and arbiter should be distinct in MVP
- at least one milestone is required
- milestone amounts must be positive
- sum of milestone amounts must equal displayed total
- review windows must be within allowed bounds

### States

Normal:
- editable step form with progress indicator

Loading:
- wallet/network check
- deployment transaction pending

Empty:
- zero milestones added yet
  - copy should explain how milestones should be written

Error:
- invalid address
- wallet not connected
- wrong network
- deployment rejected by wallet
- deployment reverted

### Success outcome

- show deployed escrow address
- deep-link to deal overview page

## 6. Deal Overview Page

### Purpose

Provide the single source of truth for the deal's current state and next actions.

### Must show

- participants: buyer, seller, arbiter
- network and token
- deal status
- milestone list with statuses
- current actionable milestone
- funded, released, refunded, and claimable totals
- timeline of events

### Role-based actions

Buyer may see:
- fund current milestone
- fund all milestones if supported
- approve current submitted milestone
- open dispute on current submitted milestone

Seller may see:
- submit current funded milestone
- claim current claimable milestone

Arbiter may see:
- link to open dispute needing resolution

Visitor may see:
- read-only state and metadata only if deal privacy model allows it

### States

Normal:
- milestones list and CTA for current role

Loading:
- fetch escrow state
- fetch metadata
- fetch timeline

Empty:
- no milestones funded yet
  - explain that buyer funding starts the deal

Blocked:
- dispute on earlier milestone blocks further progress
  - must show exact blocking milestone and current resolver

Error:
- escrow not found
- metadata failed hash verification
- backend timeline unavailable
- onchain read failure

## 7. Milestone Detail Page

### Purpose

Show full context for one milestone and the allowed next actions.

### Must show

- milestone title and description
- amount
- current status
- review window
- submittedAt and reviewDeadline when applicable
- evidence references
- dispute references if any
- payout outcome if finalized

### Role-based actions by state

`PendingFunding`
- Buyer: fund milestone if current and allowed

`Funded`
- Seller: submit milestone

`Submitted`
- Buyer: approve or dispute before deadline
- Seller: read-only

`Claimable`
- Seller: claim payout

`Disputed`
- Arbiter: resolve dispute
- Buyer/Seller: read-only plus evidence visibility

Terminal states
- all roles: read-only

### States

Normal:
- milestone context plus role-specific action card

Loading:
- fetch onchain milestone and metadata

Empty:
- evidence absent before submission

Error:
- milestone id invalid
- metadata missing
- evidence metadata missing or unverifiable

## 8. Dispute View

### Purpose

Give buyer, seller, and arbiter a clear view of a disputed milestone and its resolution state.

### Must show

- milestone summary
- original submission evidence
- dispute reason and references
- locked amount
- arbiter identity
- resolution rules summary

### Arbiter interaction

If connected wallet is arbiter:
- input buyer award amount
- input seller award amount
- live validation that total matches milestone amount
- submit resolution transaction

### States

Normal:
- dispute record and evidence side by side

Loading:
- dispute metadata load
- resolution status refresh

Empty:
- not applicable if route is only for existing disputes

Error:
- dispute not found
- invalid dispute metadata
- resolution transaction rejected or reverted

### Important copy

- dispute decisions are human, not algorithmic
- resolution is final for that milestone

## 9. Reputation Profile Page

### Purpose

Show historical trust signals for a wallet address.

### Must show

- address and optional display name
- buyer stats
- seller stats
- later arbiter stats if implemented
- recent deal activity

### MVP display rule

Show raw stats, not a single opaque score.

### States

Normal:
- stats cards and recent activity list

Loading:
- fetch role stats and activity

Empty:
- no prior activity
  - explain that reputation is earned from completed deals and disputes

Error:
- address not found in indexer yet
- backend unavailable

## 10. Cross-Cutting UI Rules

### 10.1 Network and wallet state

Every actionable screen should handle:
- wallet disconnected
- wrong network
- wallet connected as non-participant

Expected behavior:
- read-only content remains visible where possible
- action buttons are disabled with explanation

### 10.2 Loading behavior

Use skeleton states for:
- milestone lists
- timeline sections
- reputation summaries

Avoid hiding the entire screen during secondary loading if basic contract state is already known.

### 10.3 Error behavior

Prefer specific errors over generic failures:
- wallet rejected transaction
- insufficient token allowance
- insufficient balance
- deadline already passed
- milestone blocked by dispute
- metadata verification failed

### 10.4 Empty states

Empty states should teach the user:
- no milestones funded yet
- no evidence submitted yet
- no disputes exist
- no reputation history yet

Each empty state should explain what action creates data there.

## 11. Primary End-to-End User Journeys

### 11.1 Happy path

1. Seller creates deal
2. Buyer funds first milestone
3. Seller submits work
4. Buyer approves
5. Funds release to seller
6. Next milestone becomes actionable

### 11.2 Silent buyer path

1. Seller submits work
2. Buyer does nothing
3. Review deadline passes
4. Seller claims payout
5. Milestone closes as paid out

### 11.3 Dispute path

1. Seller submits work
2. Buyer disputes before deadline
3. Later milestones show blocked state
4. Arbiter reviews evidence and resolves
5. Funds split, refunded, or released
6. Deal continues or ends depending on remaining milestones

### 11.4 Early cancelled project path

1. Deal is created
2. Some milestones remain unfunded
3. Remaining unfunded milestones are cancelled once funded work is fully settled
4. Deal shows cancelled final state

## 12. Frontend Acceptance Checklist

Before the MVP frontend is considered usable, verify:

1. every milestone state has a distinct user-facing rendering
2. every role sees only the actions available to that role
3. silence-to-claim behavior is explained clearly
4. dispute blocking is visible on overview and milestone pages
5. arbiter resolution UI prevents invalid split amounts
6. metadata hash verification failures are surfaced clearly
