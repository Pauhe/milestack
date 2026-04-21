import { type Address } from "viem";

import {
  type BackendEscrowOverview,
  type BackendMilestone,
  type BackendTimelineEntry,
  fetchBackendJson,
  getDealFallbackAddress,
} from "@/lib/backend";
import {
  getDefaultEscrowAddress,
  normalizeAddress,
  readEscrowOverview,
} from "@/lib/contracts/milestone-escrow";
import { configuredChain } from "@/lib/chains";
import { formatUsdc } from "@/lib/format";
import { appEnv } from "@/lib/env";
import { getDealMetadataUrl, loadAndVerifyDealMetadata } from "@/lib/metadata";
import { getDealStatusLabel, getMilestoneStatusLabel } from "@/lib/status";
import { DealActions } from "@/components/deal-actions";

type DealOverviewPageProps = {
  params: Promise<{
    address: string;
  }>;
  searchParams: Promise<{
    metadata?: string;
  }>;
};

export default async function DealOverviewPage({ params, searchParams }: DealOverviewPageProps) {
  const { address } = await params;
  const { metadata } = await searchParams;

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

  try {
    [overview, backendOverview, { items: backendMilestones }, { items: backendTimeline }] = await Promise.all([
      readEscrowOverview(requestedAddress as Address),
      fetchBackendJson<BackendEscrowOverview>(`/escrows/${requestedAddress}`),
      fetchBackendJson<{ items: BackendMilestone[] }>(`/escrows/${requestedAddress}/milestones`),
      fetchBackendJson<{ items: BackendTimelineEntry[] }>(`/escrows/${requestedAddress}/timeline`),
    ]);
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown contract read failure";

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

  const metadataUrl = getDealMetadataUrl(metadata ?? null, address === "demo-deal") ?? appEnv.defaultDealMetadataPath ?? null;
  const verifiedMetadata = metadataUrl
    ? await loadAndVerifyDealMetadata(metadataUrl, overview.metadataHash)
    : null;

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Deal Overview</div>
        <h1>{overview.address}</h1>
        <p>
          Live escrow data is loading directly from the contract on {configuredChain.name}. This
          page is now ready for real contract-aware UI work.
        </p>
      </div>

      <section className="grid-two">
        <article className="panel stack-md">
          <h2>Live deal state</h2>
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

        <article className="panel stack-md">
          <h2>Milestone list</h2>
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

      <article className="panel stack-md">
        <div className="eyebrow">Metadata verification</div>
        <h2>Offchain terms</h2>

        {verifiedMetadata ? (
          verifiedMetadata.payload ? (
            <div className="stack-sm">
              <p className="status-text">
                Verification status: {verifiedMetadata.verified ? "Verified" : "Hash mismatch"}
              </p>
              <p>Title: {String(verifiedMetadata.payload.title ?? "Not available")}</p>
              <p>Summary: {String(verifiedMetadata.payload.summary ?? "Not available")}</p>
              <p>Terms URL: {String(verifiedMetadata.payload.termsUrl ?? "Not available")}</p>
            </div>
          ) : (
            <p className="status-text">Metadata load failed: {verifiedMetadata.error}</p>
          )
        ) : (
          <p className="status-text">
            Provide `?metadata=` in the URL or configure a default metadata path to verify offchain deal terms.
          </p>
        )}
      </article>

      <article className="panel stack-md">
        <div className="eyebrow">Timeline</div>
        <h2>Indexed event history</h2>

        {backendTimeline.length > 0 ? (
          <ul className="plain-list stack-sm">
            {backendTimeline.map((entry, index) => (
              <li key={`${entry.type}-${index}`}>
                {entry.summary}
                {entry.actor ? ` (${entry.actor.role}: ${entry.actor.address})` : ""}
              </li>
            ))}
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
