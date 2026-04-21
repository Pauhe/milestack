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
import type { EscrowMilestone, EscrowOverview } from "@/lib/contracts/milestone-escrow";
import { deriveMilestoneActionSemantics, type MilestoneRole } from "@/lib/milestone-semantics";
import { deriveActionPanelGuidance } from "@/lib/workflow-guidance";
import { getDealStatusLabel } from "@/lib/status";
import { ActionPanelWalletPanel, ActionPanelWorkflowPanel } from "@/components/action-panel-presenter";
import { WorkflowActionGroup } from "@/components/workflow-surface";

type MilestoneActionsProps = {
  overview: EscrowOverview;
  milestoneId: bigint;
  milestone: EscrowMilestone;
  backendDerived?: {
    isCurrent: boolean;
    isBlocked: boolean;
    buyerCanApprove: boolean;
    buyerCanDispute: boolean;
    sellerCanClaim: boolean;
  };
  backendReviewDeadline?: string;
};

type Role = MilestoneRole;

export function MilestoneActions({
  overview,
  milestoneId,
  milestone,
  backendDerived,
  backendReviewDeadline,
}: MilestoneActionsProps) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: hash, error, isPending, writeContract } = useWriteContract();
  const [evidenceHash, setEvidenceHash] = useState(milestone.evidenceHash === zeroHash ? "" : milestone.evidenceHash);
  const [disputeHash, setDisputeHash] = useState(milestone.disputeHash === zeroHash ? "" : milestone.disputeHash);

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

  const semantics = useMemo(
    () =>
      deriveMilestoneActionSemantics({
        role,
        status: milestone.status,
        milestoneId: Number(milestoneId),
        currentMilestoneIndex: Number(overview.currentMilestoneIndex),
        activeDisputeMilestoneId: overview.activeDisputeMilestoneId,
        derived: backendDerived,
        reviewDeadline: backendReviewDeadline ?? milestone.reviewDeadline,
      }),
    [
      role,
      milestone.status,
      milestone.reviewDeadline,
      milestoneId,
      overview.activeDisputeMilestoneId,
      overview.currentMilestoneIndex,
      backendDerived,
      backendReviewDeadline,
    ]
  );

  const guidance = useMemo(
    () =>
      deriveActionPanelGuidance({
        role,
        isConnected,
        isWrongChain,
        hasCurrentMilestone: true,
        semantics,
        disputeRouteHref: `/deals/${overview.address}/disputes/${milestoneId.toString()}`,
      }),
    [isConnected, isWrongChain, milestoneId, overview.address, role, semantics]
  );

  function refreshAfterWrite() {
    router.refresh();
  }

  function runWrite(functionName: string, args: readonly unknown[]) {
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
        description={`Deal status: ${getDealStatusLabel(overview.dealStatus)}. Milestone status: ${semantics.statusLabel}.`}
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
        eyebrow="Milestone actions"
        title="Allowed next step"
        nextStepLabel={guidance.nextStepLabel}
        nextStepMessage={guidance.nextStepMessage}
        pendingMessage={isBusy ? "Transaction submitted. Waiting for confirmation before enabling new writes." : null}
        blockedReason={guidance.blockedReason}
        trustHint={guidance.claimAfterTimeoutHint}
      >
        <WorkflowActionGroup>
          {semantics.canFund ? (
            <button
              className="button button--primary"
              disabled={isBusy || isWrongChain}
              onClick={() => runWrite("fundMilestone", [milestoneId])}
              type="button"
            >
              Fund milestone
            </button>
          ) : null}

          {semantics.canSubmit ? (
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
                onClick={() => runWrite("submitMilestone", [milestoneId, evidenceHash])}
                type="button"
              >
                Submit milestone
              </button>
            </div>
          ) : null}

          {semantics.canApprove || semantics.canDispute ? (
            <div className="stack-sm">
              {semantics.canApprove ? (
                <button
                  className="button button--primary"
                  disabled={isBusy || isWrongChain}
                  onClick={() => runWrite("approveMilestone", [milestoneId])}
                  type="button"
                >
                  Approve milestone
                </button>
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
                    onClick={() => runWrite("openDispute", [milestoneId, disputeHash])}
                    type="button"
                  >
                    Open dispute
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {semantics.canClaimAfterTimeout ? (
            <button
              className="button button--primary"
              disabled={isBusy || isWrongChain}
              onClick={() => runWrite("claimAfterReviewWindow", [milestoneId])}
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
      </ActionPanelWorkflowPanel>
    </section>
  );
}

const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
