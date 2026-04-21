import {
  type BackendEscrowOverview,
  type BackendMilestone,
  fetchBackendJson,
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  getDealFallbackAddress,
  getHashContextAssessment,
  getMilestoneMetadataVerificationAssessment,
} from "@/lib/backend";
import { normalizeAddress, readEscrowMilestone, readEscrowOverview } from "@/lib/contracts/milestone-escrow";
import { configuredChain } from "@/lib/chains";
import { formatTimestamp, formatUsdc } from "@/lib/format";
import { getMilestoneStatusLabel } from "@/lib/status";
import { MilestoneActions } from "@/components/milestone-actions";
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
import { deriveActionPanelGuidance } from "@/lib/workflow-guidance";
import {
  getActionAuthorityExplanationCopy,
  getReviewDeadlineExplanationCopy,
} from "@/lib/workflow-explanations";

type MilestoneDetailPageProps = {
  params: Promise<{
    address: string;
    milestoneId: string;
  }>;
};

export default async function MilestoneDetailPage({ params }: MilestoneDetailPageProps) {
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
          <div className="eyebrow">Milestone Detail</div>
          <h1>Invalid milestone route</h1>
          <p>Use a valid escrow address and milestone id to load a live milestone view.</p>
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
  let readError: string | null = null;
  let freshnessAssessment = getBackendUnavailableAssessment("Backend freshness has not been loaded yet.");

  try {
    [overview, milestone, backendOverview, backendMilestone] = await Promise.all([
      readEscrowOverview(escrowAddress),
      readEscrowMilestone(escrowAddress, parsedMilestoneId),
      fetchBackendJson<BackendEscrowOverview>(`/escrows/${escrowAddress}`),
      fetchBackendJson<BackendMilestone>(`/escrows/${escrowAddress}/milestones/${parsedMilestoneId.toString()}`),
    ]);

    freshnessAssessment = getBackendFreshnessAssessment(
      backendMilestone.freshness ?? backendOverview.freshness
    );
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown milestone read failure";
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
          <div className="eyebrow">Milestone Detail</div>
          <h1>
            Deal {escrowAddress}, milestone {parsedMilestoneId.toString()}
          </h1>
          <p>
            The app could not load this milestone on {configuredChain.name}. Check the escrow
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
  const guidance = deriveActionPanelGuidance({
    role: "visitor",
    isConnected: false,
    isWrongChain: false,
    hasCurrentMilestone: true,
    semantics,
    disputeRouteHref,
  });

  const routeGuidance = freshnessAssessment.state === "healthy"
    ? guidance
    : {
        ...guidance,
        nextStepMessage: `${guidance.nextStepMessage} Backend freshness is ${freshnessAssessment.state}; treat indexed eligibility as conservative until refreshed.`,
        blockedReason: guidance.blockedReason
          ?? "Backend freshness is degraded; role actions stay conservative until eligibility truth reloads.",
      };

  const reviewDeadlineExplanation = getReviewDeadlineExplanationCopy({
    reviewDeadline: backendMilestone?.review_deadline ?? milestone.reviewDeadline,
    milestoneStatus: milestone.status,
    semantics,
  });

  const actionAuthorityExplanation = getActionAuthorityExplanationCopy({
    guidance: routeGuidance,
    semantics,
  });

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Milestone Detail</div>
        <h1>
          Deal {escrowAddress}, milestone {parsedMilestoneId.toString()}
        </h1>
        <p>
          Primary milestone values are loaded live from the escrow contract on {configuredChain.name}.
          Backend metadata and derived eligibility can be stale during indexing lag.
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

      <section className="grid-two">
        <article className="panel stack-md">
          <h2>Primary milestone data</h2>
          <ul className="plain-list stack-sm">
            <li>Amount: {formatUsdc(BigInt(backendMilestone?.amount ?? milestone.amount))}</li>
            <li>Status: {getMilestoneStatusLabel(backendMilestone?.status ?? milestone.status)}</li>
            <li>Review window: {backendMilestone?.review_window_seconds ?? milestone.reviewWindowSeconds} seconds</li>
            <li>Submitted at: {formatTimestamp(BigInt(backendMilestone?.submitted_at ?? milestone.submittedAt))}</li>
            <li>Review deadline: {formatTimestamp(BigInt(backendMilestone?.review_deadline ?? milestone.reviewDeadline))}</li>
            <li>Evidence hash: {backendMilestone?.evidence_hash ?? milestone.evidenceHash}</li>
            <li>Dispute hash: {backendMilestone?.dispute_hash ?? milestone.disputeHash}</li>
            <li>Buyer award: {formatUsdc(BigInt(backendMilestone?.buyer_award ?? milestone.buyerAward))}</li>
            <li>Seller award: {formatUsdc(BigInt(backendMilestone?.seller_award ?? milestone.sellerAward))}</li>
          </ul>
        </article>

        <article className="panel stack-md">
          <h2>Deal context</h2>
          <ul className="plain-list stack-sm">
            <li>Buyer: {backendOverview?.buyer_address ?? overview.buyer}</li>
            <li>Seller: {backendOverview?.seller_address ?? overview.seller}</li>
            <li>Arbiter: {backendOverview?.arbiter_address ?? overview.arbiter}</li>
            <li>Token: {backendOverview?.token_address ?? overview.token}</li>
            <li>Escrow: {backendOverview?.address ?? overview.address}</li>
          </ul>
        </article>
      </section>

      <WorkflowSurfacePanel data-testid="milestone-workflow-guidance">
        <WorkflowSectionHeader
          eyebrow="Workflow guidance"
          title="Route-to-route progression"
        />
        <WorkflowStatusRow
          label={routeGuidance.nextStepLabel}
          value={routeGuidance.nextStepMessage}
        />
        <ul className="plain-list stack-sm">
          <li>
            Milestone route: <a href={`/deals/${escrowAddress}/milestones/${parsedMilestoneId.toString()}`}>/deals/{escrowAddress}/milestones/{parsedMilestoneId.toString()}</a>
          </li>
          <li>
            Dispute route: <a href={disputeRouteHref}>{disputeRouteHref}</a>
          </li>
        </ul>
        {routeGuidance.claimAfterTimeoutHint ? (
          <WorkflowCallout tone="trust" title="Timeout hint" testId="milestone-timeout-hint">
            {routeGuidance.claimAfterTimeoutHint}
          </WorkflowCallout>
        ) : null}
        <WorkflowStatusRow
          label="Review deadline meaning"
          value={reviewDeadlineExplanation}
          testId="milestone-review-deadline-explanation"
        />
        <WorkflowStatusRow
          label="Action authority"
          value={actionAuthorityExplanation}
          testId="milestone-action-authority-explanation"
        />
        {routeGuidance.blockedReason ? (
          <WorkflowCallout tone="degraded" title="Blocked" testId="milestone-workflow-blocked-reason">
            {routeGuidance.blockedReason}
          </WorkflowCallout>
        ) : null}
      </WorkflowSurfacePanel>

      <article className="panel stack-md">
        <div className="eyebrow">Metadata verification</div>
        <h2>Milestone terms</h2>
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

      <section className="grid-two">
        <article className="panel stack-md">
          <h2>Evidence hash context</h2>
          <p className="status-text">State: {evidenceAssessment.state}</p>
          <p>{evidenceAssessment.message}</p>
          {evidenceAssessment.hash ? <p>Hash: {evidenceAssessment.hash}</p> : null}
          {evidenceAssessment.reason ? (
            <p className="status-text">Backend detail: {evidenceAssessment.reason}</p>
          ) : null}
        </article>

        <article className="panel stack-md">
          <h2>Dispute hash context</h2>
          <p className="status-text">State: {disputeAssessment.state}</p>
          <p>{disputeAssessment.message}</p>
          {disputeAssessment.hash ? <p>Hash: {disputeAssessment.hash}</p> : null}
          {disputeAssessment.reason ? (
            <p className="status-text">Backend detail: {disputeAssessment.reason}</p>
          ) : null}
        </article>
      </section>

      <MilestoneActions
        milestone={milestone}
        milestoneId={parsedMilestoneId}
        overview={overview}
        backendDerived={backendMilestone?.derived}
        backendReviewDeadline={backendMilestone?.review_deadline}
      />
    </section>
  );
}
