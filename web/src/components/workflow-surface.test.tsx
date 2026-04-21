import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  WorkflowActionGroup,
  WorkflowCallout,
  WorkflowSectionHeader,
  WorkflowStatusRow,
  WorkflowSurfacePanel,
} from "@/components/workflow-surface";

describe("workflow surface primitives", () => {
  it("renders heading and description with presentation-only wrapper classes", () => {
    const html = renderToStaticMarkup(
      <WorkflowSurfacePanel data-testid="surface-panel">
        <WorkflowSectionHeader
          eyebrow="Workflow guidance"
          title="Route-to-route progression"
          description="Keep lifecycle semantics in workflow guidance helpers."
        />
      </WorkflowSurfacePanel>
    );

    expect(html).toContain('data-testid="surface-panel"');
    expect(html).toContain("workflow-surface-panel");
    expect(html).toContain("Workflow guidance");
    expect(html).toContain("Route-to-route progression");
    expect(html).toContain("Keep lifecycle semantics in workflow guidance helpers.");
  });

  it("renders status treatments with explicit label/value separation", () => {
    const html = renderToStaticMarkup(
      <WorkflowStatusRow
        label="Action authority"
        value="Only the designated arbiter can resolve disputes."
        testId="authority-row"
      />
    );

    expect(html).toContain('data-testid="authority-row"');
    expect(html).toContain("workflow-surface-status-row");
    expect(html).toContain("workflow-surface-status-label");
    expect(html).toContain("Action authority:");
    expect(html).toContain("Only the designated arbiter can resolve disputes.");
  });

  it("keeps conservative trust and degraded callouts distinct", () => {
    const html = renderToStaticMarkup(
      <>
        <WorkflowCallout tone="trust" title="Timeout hint" testId="trust-callout">
          Seller timeout eligibility still depends on review-window semantics.
        </WorkflowCallout>
        <WorkflowCallout tone="degraded" title="Blocked" testId="degraded-callout">
          Backend freshness is degraded; keep actions blocked until eligibility truth reloads.
        </WorkflowCallout>
      </>
    );

    expect(html).toContain('data-testid="trust-callout"');
    expect(html).toContain('data-testid="degraded-callout"');
    expect(html).toContain("workflow-surface-callout--trust");
    expect(html).toContain("workflow-surface-callout--degraded");
    expect(html).toContain("Seller timeout eligibility still depends on review-window semantics.");
    expect(html).toContain("Backend freshness is degraded; keep actions blocked until eligibility truth reloads.");
  });

  it("groups action islands without introducing lifecycle copy", () => {
    const html = renderToStaticMarkup(
      <WorkflowActionGroup>
        <button type="button">Approve milestone</button>
        <button type="button">Open dispute</button>
      </WorkflowActionGroup>
    );

    expect(html).toContain("workflow-surface-action-group");
    expect(html).toContain("Approve milestone");
    expect(html).toContain("Open dispute");
  });
});
