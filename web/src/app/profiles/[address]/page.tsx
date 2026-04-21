import { getAddress } from "viem";

import { fetchBackendJson, getProfileFallbackAddress } from "@/lib/backend";

type ProfilePageProps = {
  params: Promise<{
    address: string;
  }>;
};

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { address } = await params;
  const requestedAddress = getProfileFallbackAddress(address);

  let profile:
    | {
        address: string;
        buyerStats: Record<string, unknown> | null;
        sellerStats: Record<string, unknown> | null;
        arbiterStats: Record<string, unknown> | null;
      }
    | null = null;
  let readError: string | null = null;

  try {
    profile = await fetchBackendJson(`/users/${getAddress(requestedAddress)}/reputation`);
  } catch (error) {
    readError = error instanceof Error ? error.message : "Unknown backend reputation failure";
  }

  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Reputation Profile</div>
        <h1>{requestedAddress}</h1>
        <p>
          This profile is now backed by the backend reputation view when indexed data is available.
        </p>
      </div>

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
