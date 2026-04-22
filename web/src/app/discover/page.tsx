import Link from "next/link";

import {
  type BackendDiscoveryResponse,
  fetchBackendJson,
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  getDiscoveryCapabilityAssessment,
  getDiscoveryContractAssessment,
  getDiscoveryMetadataAssessment,
  getDiscoveryRoleStatsAssessment,
} from "@/lib/backend";
import {
  getDiscoverDegradedCardCalloutCopy,
  getDiscoverReadSurfaceCopy,
  isDiscoverCardSignalDegraded,
} from "@/lib/workflow-explanations";
import { formatUsdc } from "@/lib/format";
import { getDealStatusLabel, getMilestoneStatusLabel } from "@/lib/status";
import {
  WorkflowCallout,
  WorkflowFreshnessBanner,
  WorkflowSectionHeader,
  WorkflowStatusRow,
  WorkflowSurfacePanel,
} from "@/components/workflow-surface";

export default async function DiscoverPage() {
  let discovery: BackendDiscoveryResponse | null = null;
  let readError: string | null = null;
  let freshnessAssessment = getBackendUnavailableAssessment(
    "Backend freshness has not been loaded yet."
  );

  try {
    discovery = await fetchBackendJson<BackendDiscoveryResponse>("/discover");
    freshnessAssessment = getBackendFreshnessAssessment(discovery.freshness);
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown discovery read failure";
    freshnessAssessment = getBackendUnavailableAssessment(error);
  }

  const freshnessBanner = getBackendFreshnessBanner("deal", freshnessAssessment);
  const cards = discovery?.items ?? [];
  const discoveryContract = getDiscoveryContractAssessment(discovery?.truth, freshnessAssessment);
  const discoverCopy = getDiscoverReadSurfaceCopy({ readError });

  return (
    <section className="stack-lg" data-testid="discover-page">
      <div className="page-header stack-sm">
        <div className="eyebrow">Discover</div>
        <h1>Indexed discovery cards (informational only)</h1>
        <p>
          Discovery lists public, indexed deal context for navigation and diagnostics. It does not
          grant write permissions, settlement authority, or ranking rights.
        </p>
      </div>

      {freshnessBanner ? (
        <WorkflowFreshnessBanner
          title={freshnessBanner.title}
          body={freshnessBanner.body}
          detail={freshnessAssessment.error}
          testId="discover-freshness-banner"
        />
      ) : null}

      {readError ? (
        <article className="panel stack-sm" data-testid="discover-read-failure-panel">
          <h2>Discovery read failure</h2>
          <p>{readError}</p>
          <p className="status-text">{discoverCopy.readFailureDetail}</p>
        </article>
      ) : null}

      <WorkflowSurfacePanel data-testid="discover-truth-contract-panel">
        <WorkflowSectionHeader
          eyebrow="Truth contract"
          title="Conservative capability boundary"
          description="Discovery never overrides onchain escrow authority."
        />
        <WorkflowStatusRow label="Contract state" value={discoveryContract.state} />
        <WorkflowStatusRow label="Interpretation" value={discoveryContract.message} />
        <WorkflowCallout tone="trust" title="Authority boundary" testId="discover-authority-callout">
          {discoverCopy.authorityBoundary}
        </WorkflowCallout>
      </WorkflowSurfacePanel>

      {cards.length > 0 ? (
        <section className="stack-lg" data-testid="discover-card-grid">
          {cards.map((card) => {
            const capability = getDiscoveryCapabilityAssessment(card.capability);
            const metadata = getDiscoveryMetadataAssessment(card.metadata);
            const buyerTrust = getDiscoveryRoleStatsAssessment("Buyer", card.roleStats.buyer);
            const sellerTrust = getDiscoveryRoleStatsAssessment("Seller", card.roleStats.seller);
            const arbiterTrust = getDiscoveryRoleStatsAssessment("Arbiter", card.roleStats.arbiter);

            const dealHref = `/deals/${card.identity.address}`;
            const currentMilestoneId = card.milestones.current?.milestoneId ?? card.overview.currentMilestoneIndex;
            const milestoneHref = `/deals/${card.identity.address}/milestones/${currentMilestoneId}`;
            const disputeHref = card.overview.activeDisputeMilestoneId
              ? `/deals/${card.identity.address}/disputes/${card.overview.activeDisputeMilestoneId}`
              : null;

            return (
              <WorkflowSurfacePanel key={card.identity.key} data-testid={`discover-card-${card.identity.key}`}>
                <WorkflowSectionHeader
                  eyebrow={`Chain ${card.identity.chainId}`}
                  title={card.identity.address}
                  description={`Identity key: ${card.identity.key}`}
                />

                <WorkflowStatusRow
                  label="Deal status"
                  value={getDealStatusLabel(card.overview.dealStatus)}
                />
                <WorkflowStatusRow
                  label="Current milestone"
                  value={String(card.overview.currentMilestoneIndex)}
                />
                <WorkflowStatusRow
                  label="Milestones indexed"
                  value={`${card.milestones.totalCount} total / ${card.milestones.submittedCount} submitted / ${card.milestones.terminalCount} terminal`}
                />
                <WorkflowStatusRow
                  label="Funded volume"
                  value={formatUsdc(BigInt(card.overview.totalFunded))}
                />
                {card.milestones.current ? (
                  <WorkflowStatusRow
                    label="Current milestone status"
                    value={getMilestoneStatusLabel(card.milestones.current.status)}
                  />
                ) : null}

                <ul className="plain-list stack-sm" data-testid={`discover-links-${card.identity.key}`}>
                  <li>
                    <Link href={dealHref}>Open deal overview</Link>
                  </li>
                  <li>
                    <Link href={milestoneHref}>Open current milestone</Link>
                  </li>
                  <li>
                    {disputeHref ? <Link href={disputeHref}>Open active dispute</Link> : "No active dispute route"}
                  </li>
                </ul>

                <WorkflowStatusRow
                  label="Capability"
                  value={capability.message}
                  testId={`discover-capability-${card.identity.key}`}
                />
                <WorkflowStatusRow
                  label="Metadata truth"
                  value={metadata.message}
                  testId={`discover-metadata-${card.identity.key}`}
                />
                <WorkflowStatusRow
                  label="Buyer trust"
                  value={buyerTrust.message}
                  testId={`discover-buyer-trust-${card.identity.key}`}
                />
                <WorkflowStatusRow
                  label="Seller trust"
                  value={sellerTrust.message}
                  testId={`discover-seller-trust-${card.identity.key}`}
                />
                <WorkflowStatusRow
                  label="Arbiter trust"
                  value={arbiterTrust.message}
                  testId={`discover-arbiter-trust-${card.identity.key}`}
                />

                {isDiscoverCardSignalDegraded({
                  capability,
                  metadata,
                  buyerTrust,
                  sellerTrust,
                  arbiterTrust,
                }) ? (
                  <WorkflowCallout tone="degraded" title="Degraded discovery signal">
                    {getDiscoverDegradedCardCalloutCopy()}
                  </WorkflowCallout>
                ) : null}
              </WorkflowSurfacePanel>
            );
          })}
        </section>
      ) : (
        <article className="panel stack-sm" data-testid="discover-empty-state">
          <h2>No indexed discovery cards yet</h2>
          <p>
            No public discovery rows are currently indexed. This does not imply missing authority or
            settlement rights; it only means no discovery summaries are available yet.
          </p>
        </article>
      )}
    </section>
  );
}
