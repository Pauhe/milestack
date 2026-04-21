import { getAddress } from "viem";

import {
  type BackendReputation,
  fetchBackendJson,
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  getProfileFallbackAddress,
} from "@/lib/backend";

type ProfilePageProps = {
  params: Promise<{
    address: string;
  }>;
};

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

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Reputation Profile</div>
        <h1>{requestedAddress}</h1>
        <p>
          Reputation aggregates are backend-derived indexed views. They are not direct live contract reads.
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
          <h2>Buyer stats</h2>
          {profile?.buyerStats ? <pre>{JSON.stringify(profile.buyerStats, null, 2)}</pre> : <p>No buyer stats yet.</p>}
        </article>

        <article className="panel stack-md">
          <h2>Seller stats</h2>
          {profile?.sellerStats ? <pre>{JSON.stringify(profile.sellerStats, null, 2)}</pre> : <p>No seller stats yet.</p>}
        </article>
      </section>

      {readError ? (
        <article className="panel stack-md">
          <h2>Backend read failure</h2>
          <p>{readError}</p>
        </article>
      ) : null}
    </section>
  );
}
