import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/create-deal-form", () => ({
  CreateDealForm: () => <div data-testid="create-deal-form-stub" />, 
}));

import CreateDealPage from "@/app/create/page";

describe("create deal route", () => {
  it("renders seller-led page copy and form marker", async () => {
    const element = await CreateDealPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Create Deal");
    expect(html).toContain("Seller-led deal setup");
    expect(html).toContain("multi-step create-deal flow");
    expect(html).toContain("create-deal-form-stub");
  });
});
