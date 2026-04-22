import {
  type BackendEscrowOverview,
  type BackendMilestone,
  type BackendReputation,
  fetchBackendJson,
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  getDealFallbackAddress,
  getHashContextAssessment,
  getMilestoneMetadataVerificationAssessment,
  getReputationTruthAssessment,
  getRoleTrustAssessment,
  parseBackendReputationRoleStats,
} from "@/lib/backend";
import {
  normalizeAddress,
  readEscrowMilestone,
  readEscrowOverview,
} from "@/lib/contracts/milestone-escrow";
import { configuredChain } from "@/lib/chains";
import { formatTimestamp, formatUsdc } from "@/lib/format";
import { getMilestoneStatusLabel } from "@/lib/status";
import { DisputeResolutionForm } from "@/components/dispute-resolution-form";
import {
  WorkflowCallout,
  WorkflowSectionHeader,
  WorkflowStatusRow,
  WorkflowSurfacePanel,
} from "@/components/workflow-surface";
import {
  deriveMilestoneActionSemantics,
  type MilestoneRole,
} from "@/lib/milestone-semantics";
import { deriveActionPanelGuidance, deriveDisputeResolutionGuidance } from "@/lib/workflow-guidance";
import {
  getActionAuthorityExplanationCopy,
  getArbiterTrustExplanationCopy,
  getDisputeAuthorityExplanationCopy,
  getDisputeFinalityExplanationCopy,
  getReviewDeadlineExplanationCopy,
} from "@/lib/workflow-explanations";

type DisputePageProps = {
  params: Promise<{
    address: string;
    milestoneId: string;
  }>;
};

export default async function DisputePage({ params }: DisputePageProps) {
  const { address, milestoneId } = await params;
  const normalizedRouteAddress = getDealFallbackAddress(address);
  const escrowAddress = (() => {
    try {
      return normalizeAddress(normalizedRouteAddress);
    } catch {
      return null;
    }
  })();
  const parsedMilestoneId = (() => {
    try {
      return BigInt(milestoneId);
    } catch {
      return null;
    }
  })();

  if (!escrowAddress || parsedMilestoneId === null) {
    return (
      <section className="stack-lg">
        <div className="page-header stack-sm">
          <div className="eyebrow">Dispute View</div>
          <h1>Invalid dispute route</h1>
          <p>Use a valid escrow address and milestone id to load a live dispute.</p>
        </div>
      </section>
    );
  }

  let overview:
    | Awaited<ReturnType<typeof readEscrowOverview>>
    | null = null;
  let backendOverview: BackendEscrowOverview | null = null;
  let milestone:
    | Awaited<ReturnType<typeof readEscrowMilestone>>
    | null = null;
  let backendMilestone: BackendMilestone | null = null;
  let backendReputation: BackendReputation | null = null;
  let readError: string | null = null;
  let freshnessAssessment = getBackendUnavailableAssessment("Backend freshness has not been loaded yet.");

  try {
    const overviewPromise = readEscrowOverview(escrowAddress);
    const reputationPromise = overviewPromise.then((liveOverview) =>
      fetchBackendJson<BackendReputation>(`/users/${liveOverview.arbiter}/reputation`)
    );

    [overview, milestone, backendOverview, backendMilestone, backendReputation] = await Promise.all([
      overviewPromise,
      readEscrowMilestone(escrowAddress, parsedMilestoneId),
      fetchBackendJson<BackendEscrowOverview>(`/escrows/${escrowAddress}`),
      fetchBackendJson<BackendMilestone>(`/escrows/${escrowAddress}/milestones/${parsedMilestoneId.toString()}`),
      reputationPromise,
    ]);

    freshnessAssessment = getBackendFreshnessAssessment(
      backendMilestone.freshness ?? backendOverview.freshness
    );
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown dispute read failure";
    freshnessAssessment = getBackendUnavailableAssessment(error);

    try {
      [overview, milestone] = await Promise.all([
        readEscrowOverview(escrowAddress),
        readEscrowMilestone(escrowAddress, parsedMilestoneId),
      ]);
    } catch {
      // Keep the original error state.
    }
  }

  if (!overview || !milestone) {
    return (
      <section className="stack-lg">
        <div className="page-header stack-sm">
          <div className="eyebrow">Dispute View</div>
          <h1>
            Deal {escrowAddress}, milestone {parsedMilestoneId.toString()}
          </h1>
          <p>
            The app could not load this dispute view on {configuredChain.name}. Check the escrow
            address, milestone id, and chain configuration.
          </p>
        </div>

        <article className="panel stack-md">
          <h2>Read failure</h2>
          <p>{readError}</p>
        </article>
      </section>
    );
  }

  const freshnessBanner = getBackendFreshnessBanner("milestone", freshnessAssessment);
  const metadataAssessment = getMilestoneMetadataVerificationAssessment(
    backendMilestone?.truth?.metadataVerification
  );
  const evidenceAssessment = getHashContextAssessment(backendMilestone?.truth?.evidence, "evidence");
  const disputeAssessment = getHashContextAssessment(
    backendMilestone?.truth?.disputeContext,
    "dispute"
  );

  const arbiterAddress = backendOverview?.arbiter_address ?? overview.arbiter;
  const arbiterStats = parseBackendReputationRoleStats(
    "arbiter",
    backendReputation?.arbiterStats,
    arbiterAddress
  );
  const reputationTruth = getReputationTruthAssessment(backendReputation?.truth);
  const arbiterTrustAssessment = getRoleTrustAssessment({
    roleLabel: "Arbiter",
    stats: arbiterStats,
    truth: reputationTruth,
    freshness: freshnessAssessment,
  });
  const arbiterTrustExplanation = getArbiterTrustExplanationCopy({
    freshnessAssessment,
    truthState: reputationTruth.state,
    trustAssessment: arbiterTrustAssessment,
    stats: arbiterStats,
  });

  const semantics = deriveMilestoneActionSemantics({
    role: "visitor" as MilestoneRole,
    status: milestone.status,
    milestoneId: Number(parsedMilestoneId),
    currentMilestoneIndex: Number(overview.currentMilestoneIndex),
    activeDisputeMilestoneId: overview.activeDisputeMilestoneId,
    derived: backendMilestone?.derived,
    reviewDeadline: backendMilestone?.review_deadline ?? milestone.reviewDeadline,
  });

  const disputeRouteHref = `/deals/${escrowAddress}/disputes/${parsedMilestoneId.toString()}`;
  const milestoneRouteHref = `/deals/${escrowAddress}/milestones/${parsedMilestoneId.toString()}`;

  const actionGuidance = deriveActionPanelGuidance({
    role: "visitor",
    isConnected: false,
    isWrongChain: false,
    hasCurrentMilestone: true,
    semantics,
    disputeRouteHref,
  });

  const arbiterGuidance = deriveDisputeResolutionGuidance({
    role: "arbiter",
    isConnected: false,
    isWrongChain: false,
    isBusy: false,
    milestoneStatus: milestone.status,
    milestoneId: parsedMilestoneId,
    activeDisputeMilestoneId: overview.activeDisputeMilestoneId,
    hasValidBuyerAward: false,
    hasValidSellerAward: false,
    isExactSplit: false,
  });

  const visitorGuidance = deriveDisputeResolutionGuidance({
    role: "visitor",
    isConnected: false,
    isWrongChain: false,
    isBusy: false,
    milestoneStatus: milestone.status,
    milestoneId: parsedMilestoneId,
    activeDisputeMilestoneId: overview.activeDisputeMilestoneId,
    hasValidBuyerAward: false,
    hasValidSellerAward: false,
    isExactSplit: false,
  });

  const routeGuidance = freshnessAssessment.state === "healthy"
    ? actionGuidance
    : {
        ...actionGuidance,
        nextStepMessage: `${actionGuidance.nextStepMessage} Backend freshness is ${freshnessAssessment.state}; keep dispute guidance conservative until backend truth recovers.`,
        blockedReason: actionGuidance.blockedReason
          ?? "Backend freshness is degraded; dispute actions remain blocked until truth reloads.",
      };

  const reviewDeadlineExplanation = getReviewDeadlineExplanationCopy({
    reviewDeadline: backendMilestone?.review_deadline ?? milestone.reviewDeadline,
    milestoneStatus: milestone.status,
    semantics,
  });

  const routeActionAuthorityExplanation = getActionAuthorityExplanationCopy({
    guidance: routeGuidance,
    semantics,
  });

  const disputeAuthorityExplanation = getDisputeAuthorityExplanationCopy({
    arbiterGuidance,
    visitorGuidance,
    freshnessAssessment,
  });

  const disputeFinalityExplanation = getDisputeFinalityExplanationCopy({
    disputeGuidance: arbiterGuidance,
    freshnessAssessment,
  });

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Dispute View</div>
        <h1>
          Deal {escrowAddress}, disputed milestone {parsedMilestoneId.toString()}
        </h1>
        <p>
          Primary dispute values are loaded live from the escrow contract on {configuredChain.name}.
          Evidence/dispute interpretation and metadata verification come from backend truth labels.
        </p>
      </div>

      {freshnessBanner ? (
        <article className="panel stack-sm" data-testid="backend-freshness-banner">
          <h2>{freshnessBanner.title}</h2>
          <p>{freshnessBanner.body}</p>
          {freshnessAssessment.error ? (
            <p className="status-text">Backend detail: {freshnessAssessment.error}</p>
          ) : null}
        </article>
      ) : null}

      <WorkflowSurfacePanel data-testid="dispute-workflow-guidance">
        <WorkflowSectionHeader
          eyebrow="Workflow guidance"
          title="Dispute route eligibility"
        />
        <WorkflowStatusRow
          label={routeGuidance.nextStepLabel}
          value={routeGuidance.nextStepMessage}
        />
        <ul className="plain-list stack-sm">
          <li>
            Milestone route: <a href={milestoneRouteHref}>{milestoneRouteHref}</a>
          </li>
          <li>
            Dispute route: <a href={disputeRouteHref}>{disputeRouteHref}</a>
          </li>
        </ul>
        <WorkflowStatusRow label="Arbiter wallet guidance" value={arbiterGuidance.blockedReason} />
        <WorkflowStatusRow label="Non-arbiter guidance" value={visitorGuidance.blockedReason} />
        <WorkflowStatusRow
          label="Review deadline meaning"
          value={reviewDeadlineExplanation}
          testId="dispute-review-deadline-explanation"
        />
        <WorkflowStatusRow
          label="Route authority"
          value={routeActionAuthorityExplanation}
          testId="dispute-route-authority-explanation"
        />
        {routeGuidance.blockedReason ? (
          <WorkflowCallout tone="degraded" title="Blocked" testId="dispute-workflow-blocked-reason">
            {routeGuidance.blockedReason}
          </WorkflowCallout>
        ) : null}
      </WorkflowSurfacePanel>

      <section className="grid-two" data-testid="dispute-truth-grid">
        <article className="panel stack-md" data-testid="dispute-arbiter-trust-panel">
          <h2>Arbiter trust context</h2>
          <p className="status-text" data-testid="dispute-arbiter-trust-state">
            Trust state: {arbiterTrustAssessment.state}
          </p>
          <p data-testid="dispute-arbiter-trust-explanation">{arbiterTrustExplanation}</p>
          {arbiterStats ? (
            <ul className="plain-list stack-sm" data-testid="dispute-arbiter-trust-stats">
              <li>Resolved disputes: {arbiterStats.resolvedDisputeCount}</li>
              <li>Unresolved disputes: {arbiterStats.unresolvedDisputeCount}</li>
              <li>Split outcomes: {arbiterStats.disputeSplitCount}</li>
              <li>Cancellations: {arbiterStats.cancellationCount}</li>
            </ul>
          ) : (
            <p className="status-text" data-testid="dispute-arbiter-trust-missing">
              Arbiter role stats are unavailable from backend reputation data.
            </p>
          )}
        </article>

        <article className="panel stack-md" data-testid="dispute-context-panel">
          <h2>Dispute context</h2>
          <ul className="plain-list stack-sm">
            <li>Status: {getMilestoneStatusLabel(backendMilestone?.status ?? milestone.status)}</li>
            <li>Locked amount: {formatUsdc(BigInt(backendMilestone?.amount ?? milestone.amount))}</li>
            <li>Submitted at: {formatTimestamp(BigInt(backendMilestone?.submitted_at ?? milestone.submittedAt))}</li>
            <li>Review deadline: {formatTimestamp(BigInt(backendMilestone?.review_deadline ?? milestone.reviewDeadline))}</li>
            <li>Evidence hash: {backendMilestone?.evidence_hash ?? milestone.evidenceHash}</li>
            <li>Dispute hash: {backendMilestone?.dispute_hash ?? milestone.disputeHash}</li>
            <li>Arbiter: {backendOverview?.arbiter_address ?? overview.arbiter}</li>
          </ul>
        </article>

        <article className="panel stack-md" data-testid="dispute-rules-panel">
          <h2>Resolution rules</h2>
          <p>
            Buyer and seller awards must sum exactly to the milestone amount. Fees apply only to
            the seller-side payout amount.
          </p>
          <p className="status-text" data-testid="dispute-authority-explanation">
            Authority boundary: {disputeAuthorityExplanation}
          </p>
          <p className="status-text" data-testid="dispute-finality-explanation">
            Finality boundary: {disputeFinalityExplanation}
          </p>
        </article>
      </section>

      <section className="grid-two" data-testid="dispute-verification-grid">
        <article className="panel stack-md" data-testid="dispute-metadata-panel">
          <div className="eyebrow">Metadata verification</div>
          <h2>Submission metadata truth</h2>
          <p className="status-text">Verification status: {metadataAssessment.state}</p>
          <p>{metadataAssessment.message}</p>
          {metadataAssessment.reason ? (
            <p className="status-text">Backend detail: {metadataAssessment.reason}</p>
          ) : null}
          <ul className="plain-list stack-sm">
            <li>Title verified: {String(metadataAssessment.titleVerified ?? "unknown")}</li>
            <li>Description verified: {String(metadataAssessment.descriptionVerified ?? "unknown")}</li>
          </ul>
        </article>

        <article className="panel stack-md" data-testid="dispute-hash-context-panel">
          <div className="eyebrow">Hash context truth</div>
          <h2>Evidence + dispute references</h2>
          <ul className="plain-list stack-sm">
            <li>
              Evidence: {evidenceAssessment.state} — {evidenceAssessment.message}
            </li>
            <li>
              Dispute: {disputeAssessment.state} — {disputeAssessment.message}
            </li>
            <li>Evidence hash: {evidenceAssessment.hash ?? "None"}</li>
            <li>Dispute hash: {disputeAssessment.hash ?? "None"}</li>
          </ul>
          {evidenceAssessment.reason ? (
            <p className="status-text">Evidence detail: {evidenceAssessment.reason}</p>
          ) : null}
          {disputeAssessment.reason ? (
            <p className="status-text">Dispute detail: {disputeAssessment.reason}</p>
          ) : null}
        </article>
      </section>

      <DisputeResolutionForm
        milestone={milestone}
        milestoneId={parsedMilestoneId}
        overview={overview}
      />
    </section>
  );
}
