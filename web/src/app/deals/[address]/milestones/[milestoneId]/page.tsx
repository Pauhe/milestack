import {
  type BackendEscrowOverview,
  type BackendMilestone,
  fetchBackendJson,
  getDealFallbackAddress,
} from "@/lib/backend";
import { normalizeAddress, readEscrowMilestone, readEscrowOverview } from "@/lib/contracts/milestone-escrow";
import { configuredChain } from "@/lib/chains";
import { formatTimestamp, formatUsdc } from "@/lib/format";
import { appEnv } from "@/lib/env";
import { getDealMetadataUrl, loadAndVerifyDealMetadata } from "@/lib/metadata";
import { getMilestoneStatusLabel } from "@/lib/status";
import { MilestoneActions } from "@/components/milestone-actions";

type MilestoneDetailPageProps = {
  params: Promise<{
    address: string;
    milestoneId: string;
  }>;
  searchParams: Promise<{
    metadata?: string;
  }>;
};

export default async function MilestoneDetailPage({ params, searchParams }: MilestoneDetailPageProps) {
  const { address, milestoneId } = await params;
  const { metadata } = await searchParams;
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

  try {
    [overview, milestone, backendOverview, backendMilestone] = await Promise.all([
      readEscrowOverview(escrowAddress),
      readEscrowMilestone(escrowAddress, parsedMilestoneId),
      fetchBackendJson<BackendEscrowOverview>(`/escrows/${escrowAddress}`),
      fetchBackendJson<BackendMilestone>(`/escrows/${escrowAddress}/milestones/${parsedMilestoneId.toString()}`),
    ]);
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown milestone read failure";

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

  const metadataUrl = getDealMetadataUrl(metadata ?? null, false) ?? appEnv.defaultDealMetadataPath ?? null;
  const verifiedMetadata = metadataUrl
    ? await loadAndVerifyDealMetadata(metadataUrl, overview.metadataHash)
    : null;
  const milestoneMetadata = Array.isArray(verifiedMetadata?.payload?.milestones)
    ? verifiedMetadata.payload.milestones.find(
        (item) => typeof item === "object" && item !== null && "id" in item && item.id === Number(parsedMilestoneId)
      )
    : null;

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Milestone Detail</div>
        <h1>
          Deal {escrowAddress}, milestone {parsedMilestoneId.toString()}
        </h1>
        <p>
          Live milestone state is loading directly from the escrow contract on {configuredChain.name}.
        </p>
      </div>

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

      <article className="panel stack-md">
        <div className="eyebrow">Metadata verification</div>
        <h2>Milestone terms</h2>

        {verifiedMetadata ? (
          verifiedMetadata.payload ? (
            <div className="stack-sm">
              <p className="status-text">
                Verification status: {verifiedMetadata.verified ? "Verified" : "Hash mismatch"}
              </p>
              <p>Title: {String(backendMilestone?.metadata_title ?? (milestoneMetadata as { title?: string } | null)?.title ?? "Not available")}</p>
              <p>
                Description: {String(backendMilestone?.metadata_description ?? (milestoneMetadata as { description?: string } | null)?.description ?? "Not available")}
              </p>
            </div>
          ) : (
            <p className="status-text">Metadata load failed: {verifiedMetadata.error}</p>
          )
        ) : (
          <p className="status-text">No metadata URL was provided for milestone verification.</p>
        )}
      </article>

      <MilestoneActions milestone={milestone} milestoneId={parsedMilestoneId} overview={overview} />
    </section>
  );
}
