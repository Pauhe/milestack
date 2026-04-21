import Link from "next/link";

export default function Home() {
  return (
    <section className="stack-xl">
      <section className="hero-card stack-lg">
        <div className="eyebrow">Base-only USDC escrow</div>
        <h1 className="hero-title">Milestone escrow for digital work without platform custody.</h1>
        <p className="hero-copy">
          Sellers submit evidence. Buyers approve or dispute within the review window. If the
          buyer stays silent, the seller can claim after timeout. Disputes are resolved by a
          pre-selected arbiter.
        </p>

        <div className="action-row">
          <Link className="button button--primary" href="/create">
            Start a deal
          </Link>
          <Link className="button button--ghost" href="/deals/demo-deal">
            Open demo deal
          </Link>
        </div>
      </section>

      <section className="grid-two">
        <article className="panel stack-md">
          <h2>Normal flow</h2>
          <ol className="ordered-list">
            <li>Seller creates the deal and milestone terms offchain.</li>
            <li>Buyer funds the current milestone in USDC.</li>
            <li>Seller submits milestone evidence.</li>
            <li>Buyer approves or disputes before the deadline.</li>
            <li>Silent buyer means seller can claim after timeout.</li>
          </ol>
        </article>

        <article className="panel stack-md">
          <h2>Core screens</h2>
          <ul className="plain-list stack-sm">
            <li>
              <Link href="/create">Create Deal</Link>
            </li>
            <li>
              <Link href="/deals/demo-deal">Deal Overview</Link>
            </li>
            <li>
              <Link href="/deals/demo-deal/milestones/0">Milestone Detail</Link>
            </li>
            <li>
              <Link href="/deals/demo-deal/disputes/0">Dispute View</Link>
            </li>
            <li>
              <Link href="/profiles/0xA11CE">Reputation Profile</Link>
            </li>
          </ul>
        </article>
      </section>
    </section>
  );
}
