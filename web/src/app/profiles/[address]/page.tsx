import { getAddress } from "viem";

import {
  type BackendReputation,
  type BackendReputationRoleStats,
  fetchBackendJson,
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  getProfileFallbackAddress,
  getReputationTruthAssessment,
  getRoleTrustAssessment,
  parseBackendReputationRoleStats,
} from "@/lib/backend";

type ProfilePageProps = {
  params: Promise<{
    address: string;
  }>;
};

type TrustCardProps = {
  title: string;
  testId: string;
  stats: BackendReputationRoleStats | null;
  trustState: "healthy" | "degraded";
  trustMessage: string;
};

function TrustStatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <li>
      <span className="status-text">{label}:</span> {value}
    </li>
  );
}

function TrustCard({ title, testId, stats, trustState, trustMessage }: TrustCardProps) {
  return (
    <article className="panel stack-md" data-testid={testId}>
      <h2>{title}</h2>
      <p className="status-text">Trust state: {trustState}</p>
      <p>{trustMessage}</p>

      {stats ? (
        <ul className="plain-list stack-sm">
          <TrustStatRow label="Completed deals" value={stats.completedDealsCount} />
          <TrustStatRow label="Completed milestones" value={stats.completedMilestonesCount} />
          <TrustStatRow label="Disputes" value={stats.disputeCount} />
          <TrustStatRow label="Resolved disputes" value={stats.resolvedDisputeCount} />
          <TrustStatRow label="Unresolved disputes" value={stats.unresolvedDisputeCount} />
          <TrustStatRow label="Dispute wins" value={stats.disputeWinsCount} />
          <TrustStatRow label="Dispute losses" value={stats.disputeLossesCount} />
          <TrustStatRow label="Split outcomes" value={stats.disputeSplitCount} />
          <TrustStatRow label="Cancellations" value={stats.cancellationCount} />
          <TrustStatRow label="Role volume" value={stats.totalVolume} />
        </ul>
      ) : (
        <p>No role stats available yet.</p>
      )}
    </article>
  );
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { address } = await params;
  const requestedAddress = getProfileFallbackAddress(address);

  let profile: BackendReputation | null = null;
  let readError: string | null = null;
  let freshnessAssessment = getBackendUnavailableAssessment("Backend freshness has not been loaded yet.");

  try {
    profile = await fetchBackendJson<BackendReputation>(`/users/${getAddress(requestedAddress)}/reputation`);
    freshnessAssessment = getBackendFreshnessAssessment(profile.freshness);
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown backend reputation failure";
    freshnessAssessment = getBackendUnavailableAssessment(error);
  }

  const freshnessBanner = getBackendFreshnessBanner("profile", freshnessAssessment);
  const truthAssessment = getReputationTruthAssessment(profile?.truth);

  const buyerStats = parseBackendReputationRoleStats("buyer", profile?.buyerStats, requestedAddress);
  const sellerStats = parseBackendReputationRoleStats("seller", profile?.sellerStats, requestedAddress);
  const arbiterStats = parseBackendReputationRoleStats("arbiter", profile?.arbiterStats, requestedAddress);

  const buyerTrust = getRoleTrustAssessment({
    roleLabel: "Buyer",
    stats: buyerStats,
    truth: truthAssessment,
    freshness: freshnessAssessment,
  });
  const sellerTrust = getRoleTrustAssessment({
    roleLabel: "Seller",
    stats: sellerStats,
    truth: truthAssessment,
    freshness: freshnessAssessment,
  });
  const arbiterTrust = getRoleTrustAssessment({
    roleLabel: "Arbiter",
    stats: arbiterStats,
    truth: truthAssessment,
    freshness: freshnessAssessment,
  });

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Reputation Profile</div>
        <h1>{requestedAddress}</h1>
        <p>
          Reputation aggregates are backend-derived indexed views and informational signals only.
          They do not override onchain authority or dispute finality.
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

      <article className="panel stack-md" data-testid="profile-truth-panel">
        <div className="eyebrow">Reputation truth contract</div>
        <h2>Canonical interpretation</h2>
        <p className="status-text">State: {truthAssessment.state}</p>
        <p>{truthAssessment.message}</p>
      </article>

      <section className="grid-two" data-testid="profile-trust-grid">
        <TrustCard
          title="Buyer trust"
          testId="profile-buyer-trust-card"
          stats={buyerStats}
          trustState={buyerTrust.state}
          trustMessage={buyerTrust.message}
        />

        <TrustCard
          title="Seller trust"
          testId="profile-seller-trust-card"
          stats={sellerStats}
          trustState={sellerTrust.state}
          trustMessage={sellerTrust.message}
        />
      </section>

      <TrustCard
        title="Arbiter trust"
        testId="profile-arbiter-trust-card"
        stats={arbiterStats}
        trustState={arbiterTrust.state}
        trustMessage={arbiterTrust.message}
      />

      {readError ? (
        <article className="panel stack-md" data-testid="profile-read-failure-panel">
          <h2>Backend read failure</h2>
          <p>{readError}</p>
        </article>
      ) : null}
    </section>
  );
}
