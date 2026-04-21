import { type Address } from "viem";

import {
  type BackendEscrowOverview,
  type BackendItemsResponse,
  type BackendMilestone,
  type BackendTimelineEntry,
  fetchBackendJson,
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  getDealFallbackAddress,
  getMetadataTruthAssessment,
  getTimelineTruthNote,
} from "@/lib/backend";
import {
  getDefaultEscrowAddress,
  normalizeAddress,
  readEscrowOverview,
} from "@/lib/contracts/milestone-escrow";
import { configuredChain } from "@/lib/chains";
import { formatUsdc } from "@/lib/format";
import { getDealStatusLabel, getMilestoneStatusLabel } from "@/lib/status";
import { DealActions } from "@/components/deal-actions";
import {
  WorkflowCallout,
  WorkflowSectionHeader,
  WorkflowStatusRow,
  WorkflowSurfacePanel,
} from "@/components/workflow-surface";
import {
  deriveMilestoneActionSemantics,
  type MilestoneActionSemantics,
  type MilestoneRole,
} from "@/lib/milestone-semantics";
import {
  getActionAuthorityExplanationCopy,
  getDealOverviewTrustExplanationCopy,
  getTimelineTruthExplanationCopy,
} from "@/lib/workflow-explanations";
import { deriveActionPanelGuidance, type ActionPanelGuidance } from "@/lib/workflow-guidance";

type DealOverviewPageProps = {
  params: Promise<{
    address: string;
  }>;
};

type RouteWorkflowContext = {
  role: MilestoneRole;
  semantics: MilestoneActionSemantics | null;
  guidance: ActionPanelGuidance;
  authorityExplanation: string;
  milestoneHref: string;
  disputeHref: string | null;
};

function deriveRouteWorkflowContext(
  overview: Awaited<ReturnType<typeof readEscrowOverview>>,
  backendMilestone: BackendMilestone | undefined,
  freshnessAssessment: ReturnType<typeof getBackendFreshnessAssessment>
): RouteWorkflowContext {
  const milestoneId = Number(overview.currentMilestoneIndex);
  const milestoneHref = `/deals/${overview.address}/milestones/${milestoneId}`;
  const disputeHref = `/deals/${overview.address}/disputes/${milestoneId}`;

  const semantics = overview.currentMilestone
    ? deriveMilestoneActionSemantics({
        role: "visitor",
        status: overview.currentMilestone.status,
        milestoneId,
        currentMilestoneIndex: milestoneId,
        activeDisputeMilestoneId: overview.activeDisputeMilestoneId,
        derived: backendMilestone?.derived,
        reviewDeadline: backendMilestone?.review_deadline ?? overview.currentMilestone.reviewDeadline,
      })
    : null;

  const guidance = deriveActionPanelGuidance({
    role: "visitor",
    isConnected: false,
    isWrongChain: false,
    hasCurrentMilestone: Boolean(overview.currentMilestone),
    semantics,
    disputeRouteHref: semantics?.canResolveDispute ? disputeHref : null,
  });

  const guidanceWithFreshness =
    freshnessAssessment.state === "healthy"
      ? guidance
      : {
          ...guidance,
          nextStepMessage: `${guidance.nextStepMessage} Backend freshness is ${freshnessAssessment.state}; keep actions conservative until indexed eligibility recovers.`,
          blockedReason: guidance.blockedReason
            ?? "Backend freshness is degraded; keep role actions blocked until backend-derived eligibility is available.",
        };

  return {
    role: "visitor",
    semantics,
    guidance: guidanceWithFreshness,
    authorityExplanation: getActionAuthorityExplanationCopy({
      guidance: guidanceWithFreshness,
      semantics,
    }),
    milestoneHref,
    disputeHref,
  };
}

export default async function DealOverviewPage({ params }: DealOverviewPageProps) {
  const { address } = await params;

  const configuredDemoAddress = getDefaultEscrowAddress();
  const requestedAddress = (() => {
    const fallbackAddress = getDealFallbackAddress(address);
    if (fallbackAddress !== address) return configuredDemoAddress;

    try {
      return normalizeAddress(fallbackAddress);
    } catch {
      return null;
    }
  })();

  if (!requestedAddress) {
    return (
      <section className="stack-lg">
        <div className="page-header stack-sm">
          <div className="eyebrow">Deal Overview</div>
          <h1>Escrow address required</h1>
          <p>
            Pass a real escrow address in the route or set `NEXT_PUBLIC_DEFAULT_ESCROW_ADDRESS`
            for the demo route.
          </p>
        </div>
      </section>
    );
  }

  let overview:
    | Awaited<ReturnType<typeof readEscrowOverview>>
    | null = null;
  let backendOverview: BackendEscrowOverview | null = null;
  let backendMilestones: BackendMilestone[] = [];
  let backendTimeline: BackendTimelineEntry[] = [];
  let readError: string | null = null;
  let freshnessAssessment = getBackendUnavailableAssessment("Backend freshness has not been loaded yet.");

  try {
    const [chainOverview, overviewResponse, milestonesResponse, timelineResponse] = await Promise.all([
      readEscrowOverview(requestedAddress as Address),
      fetchBackendJson<BackendEscrowOverview>(`/escrows/${requestedAddress}`),
      fetchBackendJson<BackendItemsResponse<BackendMilestone>>(`/escrows/${requestedAddress}/milestones`),
      fetchBackendJson<BackendItemsResponse<BackendTimelineEntry>>(`/escrows/${requestedAddress}/timeline`),
    ]);

    overview = chainOverview;
    backendOverview = overviewResponse;
    backendMilestones = milestonesResponse.items;
    backendTimeline = timelineResponse.items;

    freshnessAssessment = getBackendFreshnessAssessment(
      overviewResponse.freshness ?? milestonesResponse.freshness ?? timelineResponse.freshness
    );
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown contract read failure";
    freshnessAssessment = getBackendUnavailableAssessment(error);

    try {
      overview = await readEscrowOverview(requestedAddress as Address);
    } catch {
      // The direct chain read already failed above or remains unavailable.
    }
  }

  if (!overview) {
    return (
      <section className="stack-lg">
        <div className="page-header stack-sm">
          <div className="eyebrow">Deal Overview</div>
          <h1>{requestedAddress}</h1>
          <p>
            The app could not read this escrow on {configuredChain.name}. Check the configured
            chain, deployment address, and RPC availability.
          </p>
        </div>

        <article className="panel stack-md">
          <h2>Read failure</h2>
          <p>{readError}</p>
        </article>
      </section>
    );
  }

  const freshnessBanner = getBackendFreshnessBanner("deal", freshnessAssessment);
  const metadataTruthAssessment = getMetadataTruthAssessment(backendOverview?.truth?.metadata);
  const workflowContext = deriveRouteWorkflowContext(
    overview,
    backendMilestones.find((item) => item.milestone_id === Number(overview.currentMilestoneIndex)),
    freshnessAssessment
  );

  const trustExplanation = getDealOverviewTrustExplanationCopy({
    freshnessAssessment,
    hasIndexedMilestones: backendMilestones.length > 0,
    hasIndexedTimeline: backendTimeline.length > 0,
  });

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Deal Overview</div>
        <h1>{overview.address}</h1>
        <p>{trustExplanation.liveContractSummary}</p>
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

      <WorkflowSurfacePanel data-testid="deal-workflow-guidance">
        <WorkflowSectionHeader
          eyebrow="Workflow guidance"
          title="Traverse the current workflow path"
        />
        <WorkflowStatusRow
          label={workflowContext.guidance.nextStepLabel}
          value={workflowContext.guidance.nextStepMessage}
        />
        <ul className="plain-list stack-sm">
          <li>
            Current milestone route: <a href={workflowContext.milestoneHref}>{workflowContext.milestoneHref}</a>
          </li>
          <li>
            Dispute route: {workflowContext.disputeHref ? (
              <a href={workflowContext.disputeHref}>{workflowContext.disputeHref}</a>
            ) : (
              "Not available"
            )}
          </li>
        </ul>
        {workflowContext.guidance.claimAfterTimeoutHint ? (
          <WorkflowCallout tone="trust" title="Timeout hint" testId="deal-timeout-hint">
            {workflowContext.guidance.claimAfterTimeoutHint}
          </WorkflowCallout>
        ) : null}
        <WorkflowStatusRow
          label="Action authority"
          value={workflowContext.authorityExplanation}
          testId="deal-action-authority-truth"
        />
        {workflowContext.guidance.blockedReason ? (
          <WorkflowCallout tone="degraded" title="Blocked" testId="deal-workflow-blocked-reason">
            {workflowContext.guidance.blockedReason}
          </WorkflowCallout>
        ) : null}
      </WorkflowSurfacePanel>

      <section className="grid-two" data-testid="deal-truth-grid">
        <article className="panel stack-md" data-testid="deal-live-state-panel">
          <h2>Live deal state</h2>
          <p className="status-text" data-testid="deal-live-contract-truth">
            {trustExplanation.liveContractSummary}
          </p>
          <ul className="plain-list stack-sm">
            <li>Buyer: {backendOverview?.buyer_address ?? overview.buyer}</li>
            <li>Seller: {backendOverview?.seller_address ?? overview.seller}</li>
            <li>Arbiter: {backendOverview?.arbiter_address ?? overview.arbiter}</li>
            <li>Token: {backendOverview?.token_address ?? overview.token}</li>
            <li>Deal status: {getDealStatusLabel(backendOverview?.deal_status ?? overview.dealStatus)}</li>
            <li>
              Current milestone index: {String(backendOverview?.current_milestone_index ?? overview.currentMilestoneIndex)}
            </li>
            <li>
              Active dispute milestone id: {String(backendOverview?.active_dispute_milestone_id ?? overview.activeDisputeMilestoneId)}
            </li>
            <li>Total funded: {formatUsdc(BigInt(backendOverview?.total_funded ?? overview.totalFunded))}</li>
            <li>
              Released to seller: {formatUsdc(BigInt(backendOverview?.total_released_to_seller ?? overview.totalReleasedToSeller))}
            </li>
            <li>
              Refunded to buyer: {formatUsdc(BigInt(backendOverview?.total_refunded_to_buyer ?? overview.totalRefundedToBuyer))}
            </li>
            <li>
              Fees collected: {formatUsdc(BigInt(backendOverview?.total_fees_collected ?? overview.totalFeesCollected))}
            </li>
          </ul>
        </article>

        <article className="panel stack-md" data-testid="deal-indexed-state-panel">
          <h2>Milestone list (backend indexed)</h2>
          <p className="status-text" data-testid="deal-indexed-truth">
            {trustExplanation.indexedDataSummary}
          </p>
          {backendMilestones.length > 0 ? (
            <ul className="plain-list stack-sm">
              {backendMilestones.map((milestone) => (
                <li key={milestone.milestone_id}>
                  #{milestone.milestone_id}: {milestone.metadata_title ?? "Untitled milestone"} ({getMilestoneStatusLabel(milestone.status)})
                </li>
              ))}
            </ul>
          ) : (
            <p>No milestone list is available from the backend yet.</p>
          )}
        </article>
      </section>

      <article className="panel stack-md" data-testid="deal-metadata-truth-panel">
        <div className="eyebrow">Metadata verification</div>
        <h2>Offchain terms</h2>
        <p className="status-text">Verification status: {metadataTruthAssessment.state}</p>
        <p>{metadataTruthAssessment.message}</p>
        {metadataTruthAssessment.detail ? (
          <p className="status-text">Backend detail: {metadataTruthAssessment.detail}</p>
        ) : null}
        <ul className="plain-list stack-sm">
          <li>Metadata URL: {metadataTruthAssessment.metadataUrl ?? "Not indexed"}</li>
          <li>Payload present: {String(metadataTruthAssessment.payloadPresent ?? "unknown")}</li>
          <li>Updated at block: {metadataTruthAssessment.updatedAtBlock ?? "Not available"}</li>
        </ul>
      </article>

      <article className="panel stack-md" data-testid="deal-timeline-panel">
        <div className="eyebrow">Timeline</div>
        <h2>Indexed event history (backend derived)</h2>
        <p className="status-text" data-testid="deal-timeline-truth">
          {trustExplanation.timelineSummary}
        </p>

        {backendTimeline.length > 0 ? (
          <ul className="plain-list stack-sm">
            {backendTimeline.map((entry, index) => {
              const timelineTruthCopy = getTimelineTruthExplanationCopy({
                truthNote: getTimelineTruthNote(entry.truth),
                eventType: entry.type,
              });

              return (
                <li key={`${entry.type}-${index}`}>
                  {entry.summary}
                  {entry.actor ? ` (${entry.actor.role}: ${entry.actor.address})` : ""}
                  {` — ${timelineTruthCopy}`}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No indexed timeline entries are available yet.</p>
        )}
      </article>

      <DealActions
        overview={overview}
        backendMilestoneDerived={backendMilestones.find((item) => item.milestone_id === Number(overview.currentMilestoneIndex))?.derived}
        backendReviewDeadline={backendMilestones.find((item) => item.milestone_id === Number(overview.currentMilestoneIndex))?.review_deadline}
      />
    </section>
  );
}
