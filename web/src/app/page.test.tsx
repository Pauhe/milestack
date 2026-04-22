import { describe, expect, it } from "vitest";

import Home from "@/app/page";
import { renderToStaticMarkup } from "react-dom/server";

describe("home page", () => {
  it("renders primary hero and core route links", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("Base-only USDC escrow");
    expect(html).toContain("Start a deal");
    expect(html).toContain('href="/create"');
    expect(html).toContain('href="/discover"');
    expect(html).toContain('href="/deals/demo-deal"');
    expect(html).toContain('href="/deals/demo-deal/milestones/0"');
    expect(html).toContain('href="/deals/demo-deal/disputes/0"');
    expect(html).toContain('href="/profiles/0xA11CE"');
  });
});
