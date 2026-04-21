import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ActionPanelWalletPanel, ActionPanelWorkflowPanel } from "@/components/action-panel-presenter";

describe("action panel presenter", () => {
  it("renders disconnected wallet panel with connector CTA and without tx surfaces", () => {
    const html = renderToStaticMarkup(
      <ActionPanelWalletPanel
        roleTitle="Read-only visitor"
        description="Connect to reveal role-specific writes."
        isConnected={false}
        connectors={[{ uid: "injected", name: "Injected", onConnect: vi.fn() }]}
      />
    );

    expect(html).toContain("Read-only visitor");
    expect(html).toContain("Connect Injected");
    expect(html).not.toContain("action-panel-last-tx");
    expect(html).not.toContain("action-panel-write-error");
  });

  it("renders connected wallet telemetry including wrong-chain and write-error callouts", () => {
    const html = renderToStaticMarkup(
      <ActionPanelWalletPanel
        roleTitle="buyer"
        description="Buyer can approve or dispute based on backend-derived eligibility."
        isConnected
        walletAddress="0xabc"
        chainLabel="Wrong network (84531)"
        onDisconnect={vi.fn()}
        wrongChainMessage="Switch to Base Sepolia to perform contract actions."
        txHash="0x123"
        errorMessage="execution reverted"
        errorTitle="Write error"
      />
    );

    expect(html).toContain("Wallet: 0xabc");
    expect(html).toContain("Wrong chain");
    expect(html).toContain("Switch to Base Sepolia to perform contract actions.");
    expect(html).toContain("Last submitted tx:");
    expect(html).toContain("0x123");
    expect(html).toContain("Write error");
    expect(html).toContain("execution reverted");
  });

  it("renders next-step, pending, blocked, and trust-hint messaging under workflow panel", () => {
    const html = renderToStaticMarkup(
      <ActionPanelWorkflowPanel
        eyebrow="Milestone actions"
        title="Allowed next step"
        nextStepLabel="Buyer action"
        nextStepMessage="Approve or dispute during the active review window."
        pendingMessage="Transaction submitted. Waiting for confirmation."
        blockedReason="Resolution is blocked until exact split validity is restored."
        trustHint="Seller can claim only after timeout semantics are satisfied."
      >
        <button type="button">Approve milestone</button>
      </ActionPanelWorkflowPanel>
    );

    expect(html).toContain("Buyer action:");
    expect(html).toContain("Transaction pending");
    expect(html).toContain("Blocked");
    expect(html).toContain("Lifecycle hint");
    expect(html).toContain("Approve milestone");
  });
});
