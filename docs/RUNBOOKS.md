# Milestack Runbooks

## 1. Purpose

This document defines operational runbooks for Milestack's MVP and early production period.

It focuses on incidents and degraded states that are realistic for a contracts-plus-backend product where real money may later be at risk.

The goal is not to automate every response. The goal is to ensure the team knows:
- what symptoms matter
- how to diagnose them
- what actions are safe
- what actions are unsafe

## 2. General Incident Principles

1. Do not guess about chain truth. Verify against onchain state first.
2. If offchain systems are unhealthy, prefer disabling new deal creation over risking inconsistent user actions.
3. Never take an action that changes live escrow outcomes outside documented contract permissions.
4. Preserve logs, block numbers, transaction hashes, and timestamps for every incident.
5. Communicate clearly to users when an issue is offchain-only versus contract-level.

## 3. Incident Severity Levels

### Severity 1

Examples:
- contract bug affecting custody or payout correctness
- inability to trust settlement outcomes
- widespread incorrect frontend actions that may cause financial harm

Immediate actions:
- pause new escrow creation if factory pause exists
- disable create-deal UI
- notify internal responders immediately
- stop rollout and begin incident review

### Severity 2

Examples:
- indexer or backend lag causing stale UI
- RPC instability affecting reads or transaction submission
- metadata verification failures on active deals

Immediate actions:
- disable or warn on affected UI actions if necessary
- verify whether onchain settlement is still safe
- begin diagnosis and communicate degraded service

### Severity 3

Examples:
- non-critical monitoring gaps
- delayed reputation updates
- minor staging-only issues

Immediate actions:
- log, triage, and fix in standard workflow

## 4. Incident Response Runbook

### Trigger conditions

- unexpected payout behavior reported
- monitoring alert on failed smoke journey
- large indexer lag
- repeated RPC failures
- discrepancy between UI state and onchain state

### Response steps

1. Identify incident severity.
2. Capture:
   - environment
   - contract address
   - milestone id if relevant
   - tx hashes
   - current indexed block
   - current chain head
3. Verify live onchain state directly.
4. Determine whether issue is:
   - contract-level
   - backend/indexer-level
   - frontend-only
   - RPC/provider-level
5. If user harm could increase through new deal creation, pause creation or disable create-deal UI.
6. Communicate internal status and user-facing status.
7. Apply fix or mitigation.
8. Verify resolution with smoke checks and targeted reproduction.
9. Write incident summary and follow-up actions.

### Unsafe actions during incident

- editing production data manually without a documented migration or replay path
- claiming that funds are safe without onchain verification
- modifying live escrow state outside contract permissions
- unpausing or reopening user access before smoke tests pass

## 5. Indexer Lag Runbook

### Symptoms

- UI timelines stale
- reputation pages outdated
- latest indexed block materially behind chain head
- smoke tests failing because expected events do not appear

### Diagnosis

1. Compare latest indexed block to chain head.
2. Check worker logs for:
   - RPC errors
   - decode failures
   - DB connection issues
   - stuck replay queues
3. Check whether lag is global or isolated to one contract or event type.
4. Confirm whether direct onchain reads still match expected state.

### Safe mitigation

1. Keep read-only pages available if onchain reads still work.
2. Show a stale-data warning if needed.
3. Disable or caution on actions that depend on backend-derived state if role safety is unclear.
4. Restart indexer worker if issue is transient and replay-safe.
5. Rebuild affected projections from source events if data corruption occurred.

### Recovery criteria

- indexed block catches up within acceptable lag threshold
- derived views and timelines match onchain state
- smoke journeys pass again

## 6. RPC Failover Runbook

### Symptoms

- elevated read call failures
- wallet transaction submission confusion due to stale app state
- backend cannot advance indexed block
- chain head unavailable from primary provider

### Diagnosis

1. Check primary RPC status and recent failure rate.
2. Verify fallback provider health.
3. Compare chain head values across providers.
4. Confirm whether issue is provider-specific or network-wide.

### Mitigation

1. Switch backend reads and indexing to fallback RPC if primary is degraded.
2. Confirm frontend read endpoints also fail over where applicable.
3. Increase UI warnings if chain reads are inconsistent.
4. If both providers are unreliable, disable create-deal flow until stable.

### Recovery criteria

- stable reads on at least one provider
- indexer resumes normal progress
- health checks and smoke journeys return to green

## 7. Metadata Verification Failure Runbook

### Symptoms

- metadata hash mismatch
- expected milestone text missing or altered
- dispute or evidence references fail verification

### Diagnosis

1. Compare fetched payload hash to onchain hash.
2. Verify whether wrong content source, encoding mismatch, or actual tampering caused failure.
3. Check whether the issue is isolated or systemic.

### Mitigation

1. Mark the metadata as unverified in UI.
2. Avoid presenting unverified metadata as canonical.
3. Keep direct onchain state visible.
4. If issue affects create-deal or active-deal clarity materially, disable affected views until fixed.

### Recovery criteria

- hash verification passes again
- canonical source is stable
- smoke checks involving metadata succeed

## 8. Canary Abort Criteria

The mainnet canary phase should stop immediately if any of these occur:

1. incorrect payout accounting
2. stale or incorrect deal state in UI that could mislead users materially
3. indexer cannot keep up reliably
4. smoke journeys fail more than the allowed threshold
5. RPC failover does not work cleanly
6. onchain and backend state disagree in a way that affects user decisions
7. incident response cannot clearly classify and mitigate the issue quickly

### Abort actions

1. pause creation of new escrows if supported
2. disable create-deal UI
3. stop canary expansion immediately
4. preserve logs and metrics
5. investigate root cause before any further mainnet activity

## 9. Deployment Rollback Runbook For Offchain Systems

### Scope

This runbook applies only to backend, frontend, and indexer systems.

Contract deployments are not “rolled back” in the traditional sense. New deployments or paused creation are the mitigation path there.

### Steps

1. Identify whether issue is frontend-only, backend-only, or both.
2. Roll back to last known-good backend/frontend artifact.
3. Verify environment variables and contract registry config.
4. Re-run health checks.
5. Re-run smoke journeys.
6. If indexer data is suspect, rebuild projections from source events.

## 10. Communications Template

For any user-visible incident, communicate:

1. what is affected
2. whether onchain funds are affected or only the app experience
3. whether users should avoid creating new deals temporarily
4. when the next update will be provided

## 11. Minimum Operational Readiness Before Mainnet

Do not enter canary or broader mainnet use until:

1. these runbooks exist and are reviewed
2. responders know who owns incident response
3. creation pause path is tested if implemented
4. smoke checks run automatically
5. logs, metrics, and alerts are operational
