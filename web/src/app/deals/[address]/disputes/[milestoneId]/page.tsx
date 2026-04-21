import {
  type BackendEscrowOverview,
  type BackendMilestone,
  fetchBackendJson,
  getDealFallbackAddress,
} from "@/lib/backend";
import {
  normalizeAddress,
  readEscrowMilestone,
  readEscrowOverview,
} from "@/lib/contracts/milestone-escrow";
import { configuredChain } from "@/lib/chains";
import { formatTimestamp, formatUsdc } from "@/lib/format";
import { appEnv } from "@/lib/env";
import { getDealMetadataUrl, loadAndVerifyDealMetadata } from "@/lib/metadata";
import { getMilestoneStatusLabel } from "@/lib/status";
import { DisputeResolutionForm } from "@/components/dispute-resolution-form";

type DisputePageProps = {
  params: Promise<{
    address: string;
    milestoneId: string;
  }>;
  searchParams: Promise<{
    metadata?: string;
  }>;
};

export default async function DisputePage({ params, searchParams }: DisputePageProps) {
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
  let readError: string | null = null;

  try {
    [overview, milestone, backendOverview, backendMilestone] = await Promise.all([
      readEscrowOverview(escrowAddress),
      readEscrowMilestone(escrowAddress, parsedMilestoneId),
      fetchBackendJson<BackendEscrowOverview>(`/escrows/${escrowAddress}`),
      fetchBackendJson<BackendMilestone>(`/escrows/${escrowAddress}/milestones/${parsedMilestoneId.toString()}`),
    ]);
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown dispute read failure";

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

  const metadataUrl = getDealMetadataUrl(metadata ?? null, false) ?? appEnv.defaultDealMetadataPath ?? null;
  const verifiedMetadata = metadataUrl
    ? await loadAndVerifyDealMetadata(metadataUrl, overview.metadataHash)
    : null;

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Dispute View</div>
        <h1>
          Deal {escrowAddress}, disputed milestone {parsedMilestoneId.toString()}
        </h1>
        <p>
          Live dispute state is loading directly from the escrow contract on {configuredChain.name}.
        </p>
      </div>

      <section className="grid-two">
        <article className="panel stack-md">
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

        <article className="panel stack-md">
          <h2>Resolution rules</h2>
          <p>
            Buyer and seller awards must sum exactly to the milestone amount. Fees apply only to
            the seller-side payout amount. The arbiter decision is final for this milestone.
          </p>
        </article>
      </section>

      <article className="panel stack-md">
        <div className="eyebrow">Metadata verification</div>
        <h2>Submission and dispute references</h2>

        {verifiedMetadata ? (
          verifiedMetadata.payload ? (
            <div className="stack-sm">
              <p className="status-text">
                Verification status: {verifiedMetadata.verified ? "Verified" : "Hash mismatch"}
              </p>
              <p>Deal title: {String(verifiedMetadata.payload.title ?? "Not available")}</p>
              <p>Terms URL: {String(verifiedMetadata.payload.termsUrl ?? "Not available")}</p>
            </div>
          ) : (
            <p className="status-text">Metadata load failed: {verifiedMetadata.error}</p>
          )
        ) : (
          <p className="status-text">No metadata URL was provided for dispute verification.</p>
        )}
      </article>

      <DisputeResolutionForm
        milestone={milestone}
        milestoneId={parsedMilestoneId}
        overview={overview}
      />
    </section>
  );
}
