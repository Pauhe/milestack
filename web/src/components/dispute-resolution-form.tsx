"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { configuredChain } from "@/lib/chains";
import { milestoneEscrowAbi } from "@/lib/contracts/milestone-escrow-abi";
import type { EscrowMilestone, EscrowOverview } from "@/lib/contracts/milestone-escrow";
import { deriveDisputeResolutionGuidance } from "@/lib/workflow-guidance";
import { ActionPanelWalletPanel, ActionPanelWorkflowPanel } from "@/components/action-panel-presenter";
import { WorkflowStatusRow } from "@/components/workflow-surface";

type DisputeResolutionFormProps = {
  overview: EscrowOverview;
  milestoneId: bigint;
  milestone: EscrowMilestone;
};

type Role = "buyer" | "seller" | "arbiter" | "visitor";

export function DisputeResolutionForm({ overview, milestoneId, milestone }: DisputeResolutionFormProps) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: hash, error, isPending, writeContract } = useWriteContract();
  const [buyerAwardInput, setBuyerAwardInput] = useState("");
  const [sellerAwardInput, setSellerAwardInput] = useState("");

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: Boolean(hash),
    },
  });

  const role = useMemo<Role>(() => {
    if (!address) return "visitor";
    if (address.toLowerCase() === overview.buyer.toLowerCase()) return "buyer";
    if (address.toLowerCase() === overview.seller.toLowerCase()) return "seller";
    if (address.toLowerCase() === overview.arbiter.toLowerCase()) return "arbiter";
    return "visitor";
  }, [address, overview.arbiter, overview.buyer, overview.seller]);

  const isWrongChain = isConnected && chainId !== configuredChain.id;
  const isBusy = isPending || isConfirming;
  const milestoneAmountText = formatUnits(milestone.amount, 6);
  const parsedBuyerAward = parseUsdc(buyerAwardInput);
  const parsedSellerAward = parseUsdc(sellerAwardInput);
  const totalAward = (parsedBuyerAward ?? 0n) + (parsedSellerAward ?? 0n);
  const isExactSplit = parsedBuyerAward !== null && parsedSellerAward !== null && totalAward === milestone.amount;

  const guidance = useMemo(
    () =>
      deriveDisputeResolutionGuidance({
        role,
        isConnected,
        isWrongChain,
        isBusy,
        milestoneStatus: milestone.status,
        milestoneId,
        activeDisputeMilestoneId: overview.activeDisputeMilestoneId,
        hasValidBuyerAward: parsedBuyerAward !== null,
        hasValidSellerAward: parsedSellerAward !== null,
        isExactSplit,
      }),
    [
      role,
      isConnected,
      isWrongChain,
      isBusy,
      milestone.status,
      milestoneId,
      overview.activeDisputeMilestoneId,
      parsedBuyerAward,
      parsedSellerAward,
      isExactSplit,
    ]
  );

  function refreshAfterWrite() {
    router.refresh();
  }

  function handleResolve() {
    if (!guidance.canSubmitResolution || parsedBuyerAward === null || parsedSellerAward === null) return;

    writeContract(
      {
        address: overview.address as Address,
        abi: milestoneEscrowAbi,
        functionName: "resolveDispute",
        args: [milestoneId, parsedBuyerAward, parsedSellerAward],
      },
      {
        onSuccess: () => {
          refreshAfterWrite();
        },
      }
    );
  }

  return (
    <section className="stack-lg">
      <ActionPanelWalletPanel
        roleTitle={role === "visitor" ? "Read-only visitor" : role}
        description="Only the designated arbiter can resolve this disputed milestone."
        isConnected={isConnected}
        walletAddress={address}
        chainLabel={chainId === configuredChain.id ? configuredChain.name : `Wrong network (${chainId})`}
        connectors={connectors.map((connector) => ({
          uid: connector.uid,
          name: connector.name,
          onConnect: () => connect({ connector }),
        }))}
        isConnectPending={isConnectPending}
        onDisconnect={() => disconnect()}
        wrongChainMessage={guidance.wrongChainMessage}
        txHash={hash ?? null}
        txHashLabel="Last submitted tx"
        errorMessage={error?.message ?? null}
        errorTitle="Resolution error"
      />

      <ActionPanelWorkflowPanel
        eyebrow="Arbiter resolution"
        title="Resolve disputed milestone"
        nextStepLabel="Resolution context"
        nextStepMessage={`Milestone amount: ${milestoneAmountText} USDC. Dispute decisions are human, not algorithmic, and resolution is final for this milestone.`}
        pendingMessage={isBusy ? "Resolution transaction submitted. Wait for confirmation before sending another split." : null}
        blockedReason={guidance.blockedReason}
      >
        <div className="stack-sm">
          <label className="field stack-sm">
            <span>Buyer award (USDC)</span>
            <input
              className="text-input"
              inputMode="decimal"
              onChange={(event) => setBuyerAwardInput(event.target.value)}
              placeholder="0.00"
              value={buyerAwardInput}
            />
          </label>

          <label className="field stack-sm">
            <span>Seller award (USDC)</span>
            <input
              className="text-input"
              inputMode="decimal"
              onChange={(event) => setSellerAwardInput(event.target.value)}
              placeholder="0.00"
              value={sellerAwardInput}
            />
          </label>
        </div>

        <div className="stack-sm">
          <WorkflowStatusRow
            label="Current split total"
            value={`${formatUnits(totalAward, 6)} / ${milestoneAmountText} USDC`}
            testId="dispute-split-total"
          />
          <WorkflowStatusRow
            label="Split validation"
            value={guidance.splitMessage}
            testId="dispute-split-validation"
          />
          <p className="status-text action-panel-dispute-finality">
            Resolution is final once submitted on-chain.
          </p>
        </div>

        <button
          className="button button--primary"
          disabled={!guidance.canSubmitResolution}
          onClick={handleResolve}
          type="button"
        >
          Submit resolution
        </button>
      </ActionPanelWorkflowPanel>
    </section>
  );
}

function parseUsdc(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  try {
    return parseUnits(trimmed, 6);
  } catch {
    return null;
  }
}
