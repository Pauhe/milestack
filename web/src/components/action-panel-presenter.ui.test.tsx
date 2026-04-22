import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ActionPanelWalletPanel, ActionPanelWorkflowPanel } from "@/components/action-panel-presenter";

describe("action panel presenter components", () => {
  it("renders disconnected wallet connector state", () => {
    const html = renderToStaticMarkup(
      <ActionPanelWalletPanel
        roleTitle="buyer"
        description="desc"
        isConnected={false}
        connectors={[{ uid: "c1", name: "Injected", onConnect: vi.fn() }]}
      />
    );

    expect(html).toContain("Connect Injected");
    expect(html).toContain("Connect a wallet to unlock role-specific milestone actions.");
  });

  it("renders connected wallet details, wrong chain, tx hash, and error", () => {
    const html = renderToStaticMarkup(
      <ActionPanelWalletPanel
        roleTitle="seller"
        description="desc"
        isConnected
        walletAddress="0xabc"
        chainLabel="Wrong network"
        onDisconnect={vi.fn()}
        wrongChainMessage="Switch chain"
        txHash="0xhash"
        errorMessage="boom"
      />
    );

    expect(html).toContain("Wallet: 0xabc");
    expect(html).toContain("Chain: Wrong network");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Switch chain");
    expect(html).toContain("0xhash");
    expect(html).toContain("boom");
  });

  it("renders workflow panel callouts and children branches", () => {
    const html = renderToStaticMarkup(
      <ActionPanelWorkflowPanel
        eyebrow="Current milestone actions"
        title="Available actions"
        nextStepLabel="Next"
        nextStepMessage="Do thing"
        pendingMessage="pending"
        blockedReason="blocked"
        trustHint="hint"
      >
        <button type="button">Action</button>
      </ActionPanelWorkflowPanel>
    );

    expect(html).toContain("Current milestone actions");
    expect(html).toContain("Do thing");
    expect(html).toContain("pending");
    expect(html).toContain("blocked");
    expect(html).toContain("hint");
    expect(html).toContain("Action");
  });

  it("omits optional workflow sections when input is minimal", () => {
    const html = renderToStaticMarkup(
      <ActionPanelWorkflowPanel eyebrow="x" title="y">
        <span>body</span>
      </ActionPanelWorkflowPanel>
    );

    expect(html).toContain("body");
    expect(html).not.toContain("Transaction pending");
    expect(html).not.toContain("Lifecycle hint");
  });
});
