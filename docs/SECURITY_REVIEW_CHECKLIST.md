# Milestack Security Review Checklist

## 1. Purpose

This checklist is intended for:
- internal reviewers
- external auditors
- pre-mainnet reviewers

It is not a substitute for an audit. It is a structured way to verify that obvious and known high-risk areas have been checked before real money exposure.

## 2. Usage

Use this checklist in two stages:

1. pre-audit review
2. pre-mainnet release review

The same checklist can be reused, but pre-mainnet review should require stronger evidence and actual test artifacts.

## 3. Contract Review Checklist

### 3.1 State machine correctness

- [ ] Every milestone transition matches `docs/STATE_MACHINE.md`
- [ ] No invalid transitions are possible
- [ ] Terminal states cannot transition again
- [ ] Sequential milestone enforcement is implemented correctly
- [ ] Disputed milestones block later milestones as intended

### 3.2 Role and permission correctness

- [ ] Only buyer can fund milestones
- [ ] Only seller can submit milestones
- [ ] Only buyer can approve milestones
- [ ] Only buyer can open disputes
- [ ] Only seller can claim after timeout
- [ ] Only arbiter can resolve disputes
- [ ] Any factory admin authority is limited to creation pause only

### 3.3 Timing and deadline correctness

- [ ] `reviewDeadline` is derived correctly from submission time
- [ ] Dispute is allowed exactly when intended
- [ ] Claim is allowed exactly when intended
- [ ] No overlap exists between valid dispute and valid claim windows
- [ ] Boundary timestamp tests exist and pass

### 3.4 Accounting correctness

- [ ] Fund conservation holds across all payout paths
- [ ] Split resolutions sum exactly to milestone amount
- [ ] Fee is only charged on seller-side payout amount
- [ ] No fee is charged on buyer-only refund path
- [ ] Aggregate counters remain consistent with event history

### 3.5 Token safety

- [ ] Only configured USDC token is accepted
- [ ] `SafeERC20` or equivalent safe transfer handling is used
- [ ] External transfers happen after state updates
- [ ] Failed transfers revert the whole transaction

### 3.6 Emergency control safety

- [ ] If factory creation pause exists, it only affects new escrows
- [ ] Pause cannot freeze, alter, or seize existing escrow funds
- [ ] Pause/unpause behavior is tested
- [ ] Admin credentials and authority are clearly documented

## 4. Test Coverage Checklist

### 4.1 Unit and integration coverage

- [ ] Escrow creation validation tests exist
- [ ] Happy path approval tests exist
- [ ] Timeout claim tests exist
- [ ] Full refund dispute tests exist
- [ ] Full payout dispute tests exist
- [ ] Split dispute tests exist
- [ ] Unauthorized caller tests exist for every state-changing function
- [ ] Cancellation tests exist

### 4.2 Advanced testing

- [ ] Fuzz tests exist for amounts, windows, and split values
- [ ] Invariant tests exist for fund conservation
- [ ] Invariant tests exist for terminal-state immutability
- [ ] Invariant tests exist for sequencing enforcement
- [ ] Mainnet-fork tests exist and pass

### 4.3 End-to-end testing

- [ ] Staging happy-path E2E exists and passes
- [ ] Staging timeout-path E2E exists and passes
- [ ] Staging dispute-path E2E exists and passes
- [ ] Metadata verification failure scenario is tested
- [ ] Smoke tests run automatically in staging

## 5. Backend And Indexer Checklist

- [ ] Backend can rebuild state from chain events
- [ ] Event processing is idempotent
- [ ] Reorg handling strategy exists and has been tested
- [ ] Indexer lag is monitored
- [ ] Health endpoint exposes indexed block and chain lag
- [ ] Backend fails fast if manifest config is invalid
- [ ] Reputation is derived from reproducible event history

## 6. Frontend And UX Safety Checklist

- [ ] UI makes timeout consequences explicit
- [ ] UI makes arbiter role explicit
- [ ] UI makes public metadata visibility explicit
- [ ] UI prevents or clearly rejects actions by the wrong role
- [ ] Metadata hash verification failures are surfaced visibly
- [ ] Blocked milestone progression is explained clearly

## 7. Deployment And Environment Checklist

- [ ] Deployment manifests are generated automatically
- [ ] Environment-specific addresses are not handwritten ad hoc
- [ ] Staging environment is production-like enough for rehearsal
- [ ] Base mainnet-fork rehearsals have been run
- [ ] Canary mainnet plan exists and is approved
- [ ] Monitoring, alerts, and logs are live before mainnet
- [ ] Offchain rollback procedure is documented

## 8. Pre-Audit Checklist

Before external review or audit:

- [ ] Contract spec matches implementation
- [ ] State machine doc matches implementation
- [ ] Test suite is stable and reproducible
- [ ] Known issues are documented honestly
- [ ] Non-goals and trust assumptions are explicit

## 9. Pre-Mainnet Checklist

Before real-money rollout:

- [ ] All contract tests are green
- [ ] Fuzz and invariant tests are green
- [ ] Mainnet-fork tests are green
- [ ] Staging smoke tests pass repeatedly over time
- [ ] Closed testnet alpha has completed successfully
- [ ] Canary mainnet flow has completed successfully
- [ ] Incident runbooks are reviewed
- [ ] Deployment manifest has been validated against deployed contracts
- [ ] Monitoring and alerting are actively verified
- [ ] External review or audit has been completed for meaningful value exposure

## 10. Reviewer Output Expectations

Each review pass should produce:

1. findings ordered by severity
2. exact file/function or system references
3. concrete reproduction or failure scenario where possible
4. statement of any unresolved residual risks
