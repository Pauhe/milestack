// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CreateDealPage from "@/app/create/page";

vi.mock("@/components/create-deal-form", () => ({
  CreateDealForm: () => <div data-testid="create-deal-form">CreateDealForm</div>,
}));

describe("create deal route", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders seller-led page copy and form container", () => {
    const { container, getByTestId } = render(<CreateDealPage />);
    const html = container.innerHTML;

    expect(html).toContain("Create Deal");
    expect(html).toContain("Seller-led deal setup");
    expect(html).toContain("multi-step create-deal flow");
    expect(getByTestId("create-deal-form")).toBeTruthy();
  });
});
