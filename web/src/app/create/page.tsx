import { CreateDealForm } from "@/components/create-deal-form";

export default function CreateDealPage() {
  return (
    <section className="stack-lg">
      <div className="page-header stack-sm">
        <div className="eyebrow">Create Deal</div>
        <h1>Seller-led deal setup</h1>
        <p>
          This screen will become the multi-step create-deal flow for counterparties, milestone
          amounts, review windows, and metadata-backed terms.
        </p>
      </div>

      <CreateDealForm />
    </section>
  );
}
