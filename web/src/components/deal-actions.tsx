"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { type Address } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { configuredChain } from "@/lib/chains";
import { milestoneEscrowAbi } from "@/lib/contracts/milestone-escrow-abi";
import type { EscrowOverview } from "@/lib/contracts/milestone-escrow";
import { deriveMilestoneActionSemantics, type MilestoneRole } from "@/lib/milestone-semantics";
import { deriveActionPanelGuidance } from "@/lib/workflow-guidance";
import { getDealStatusLabel } from "@/lib/status";
import { ActionPanelWalletPanel, ActionPanelWorkflowPanel } from "@/components/action-panel-presenter";
import { WorkflowActionGroup } from "@/components/workflow-surface";

type DealActionsProps = {
  overview: EscrowOverview;
  backendMilestoneDerived?: {
    isCurrent: boolean;
    isBlocked: boolean;
    buyerCanApprove: boolean;
    buyerCanDispute: boolean;
    sellerCanClaim: boolean;
  };
  backendReviewDeadline?: string;
};

type Role = MilestoneRole;

export function DealActions({ overview, backendMilestoneDerived, backendReviewDeadline }: DealActionsProps) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: hash, error, isPending, writeContract } = useWriteContract();
  const [evidenceHash, setEvidenceHash] = useState(overview.currentMilestone?.evidenceHash ?? "");
  const [disputeHash, setDisputeHash] = useState(overview.currentMilestone?.disputeHash ?? "");

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

  const currentMilestoneId = Number(overview.currentMilestoneIndex);
  const currentMilestoneStatus = overview.currentMilestone?.status;
  const isWrongChain = isConnected && chainId !== configuredChain.id;
  const isBusy = isPending || isConfirming;

  const semantics = useMemo(
    () =>
      currentMilestoneStatus === undefined
        ? null
        : deriveMilestoneActionSemantics({
            role,
            status: currentMilestoneStatus,
            milestoneId: currentMilestoneId,
            currentMilestoneIndex: Number(overview.currentMilestoneIndex),
            activeDisputeMilestoneId: overview.activeDisputeMilestoneId,
            derived: backendMilestoneDerived,
            reviewDeadline: backendReviewDeadline ?? overview.currentMilestone?.reviewDeadline,
          }),
    [
      backendMilestoneDerived,
      backendReviewDeadline,
      currentMilestoneId,
      currentMilestoneStatus,
      overview.activeDisputeMilestoneId,
      overview.currentMilestone?.reviewDeadline,
      overview.currentMilestoneIndex,
      role,
    ]
  );

  const disputeRouteHref = useMemo(() => {
    if (!semantics?.canResolveDispute) return null;

    const disputeMilestone = Number(overview.currentMilestoneIndex);
    if (!Number.isInteger(disputeMilestone) || disputeMilestone < 0) return null;

    return `/deals/${overview.address}/disputes/${disputeMilestone}`;
  }, [overview.address, overview.currentMilestoneIndex, semantics?.canResolveDispute]);

  const guidance = useMemo(
    () =>
      deriveActionPanelGuidance({
        role,
        isConnected,
        isWrongChain,
        hasCurrentMilestone: Boolean(overview.currentMilestone),
        semantics,
        disputeRouteHref,
      }),
    [disputeRouteHref, isConnected, isWrongChain, overview.currentMilestone, role, semantics]
  );

  function refreshAfterWrite() {
    router.refresh();
  }

  async function runWrite(functionName: string, args: readonly unknown[]) {
    writeContract(
      {
        address: overview.address as Address,
        abi: milestoneEscrowAbi,
        functionName,
        args,
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
        description={`Deal status: ${getDealStatusLabel(overview.dealStatus)}. Current milestone status: ${semantics ? semantics.statusLabel : "Not available"}.`}
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
        errorTitle="Write error"
      />

      <ActionPanelWorkflowPanel
        eyebrow="Current milestone actions"
        title="Available actions"
        nextStepLabel={guidance.nextStepLabel}
        nextStepMessage={guidance.nextStepMessage}
        pendingMessage={isBusy ? "Transaction submitted. Waiting for confirmation before enabling new writes." : null}
        blockedReason={overview.currentMilestone ? guidance.blockedReason : guidance.blockedReason ?? "No current milestone data is available for this escrow."}
        trustHint={guidance.claimAfterTimeoutHint}
      >
        {overview.currentMilestone ? (
          <WorkflowActionGroup>
            {semantics?.canFund ? (
              <button
                className="button button--primary"
                disabled={isBusy || isWrongChain}
                onClick={() => runWrite("fundMilestone", [BigInt(currentMilestoneId)])}
                type="button"
              >
                Fund milestone
              </button>
            ) : null}

            {semantics?.canSubmit ? (
              <div className="stack-sm">
                <label className="field stack-sm">
                  <span>Evidence hash</span>
                  <input
                    className="text-input"
                    onChange={(event) => setEvidenceHash(event.target.value)}
                    placeholder="0x..."
                    value={evidenceHash}
                  />
                </label>
                <button
                  className="button button--primary"
                  disabled={isBusy || isWrongChain || evidenceHash.length === 0}
                  onClick={() => runWrite("submitMilestone", [BigInt(currentMilestoneId), evidenceHash])}
                  type="button"
                >
                  Submit milestone
                </button>
              </div>
            ) : null}

            {semantics && (semantics.canApprove || semantics.canDispute) ? (
              <div className="stack-sm">
                {semantics.canApprove ? (
                  <div className="action-row">
                    <button
                      className="button button--primary"
                      disabled={isBusy || isWrongChain}
                      onClick={() => runWrite("approveMilestone", [BigInt(currentMilestoneId)])}
                      type="button"
                    >
                      Approve milestone
                    </button>
                  </div>
                ) : null}

                {semantics.canDispute ? (
                  <>
                    <label className="field stack-sm">
                      <span>Dispute hash</span>
                      <input
                        className="text-input"
                        onChange={(event) => setDisputeHash(event.target.value)}
                        placeholder="0x..."
                        value={disputeHash}
                      />
                    </label>
                    <button
                      className="button button--ghost"
                      disabled={isBusy || isWrongChain || disputeHash.length === 0}
                      onClick={() => runWrite("openDispute", [BigInt(currentMilestoneId), disputeHash])}
                      type="button"
                    >
                      Open dispute
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {semantics?.canClaimAfterTimeout ? (
              <button
                className="button button--primary"
                disabled={isBusy || isWrongChain}
                onClick={() => runWrite("claimAfterReviewWindow", [BigInt(currentMilestoneId)])}
                type="button"
              >
                Claim after timeout
              </button>
            ) : null}

            {guidance.disputeRoute ? (
              <a className="button button--ghost" href={guidance.disputeRoute.href}>
                {guidance.disputeRoute.label}
              </a>
            ) : null}
          </WorkflowActionGroup>
        ) : null}
      </ActionPanelWorkflowPanel>
    </section>
  );
}
