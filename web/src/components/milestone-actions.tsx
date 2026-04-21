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
import { getDealStatusLabel, getMilestoneStatusLabel } from "@/lib/status";

type MilestoneActionsProps = {
  overview: EscrowOverview;
  milestoneId: bigint;
  milestone: EscrowMilestone;
};

type Role = "buyer" | "seller" | "arbiter" | "visitor";

export function MilestoneActions({ overview, milestoneId, milestone }: MilestoneActionsProps) {
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
      <article className="panel stack-md">
        <div className="eyebrow">Connected role</div>
        <h2>{role === "visitor" ? "Read-only visitor" : role}</h2>
        <p>
          Deal status: {getDealStatusLabel(overview.dealStatus)}. Milestone status: {" "}
          {getMilestoneStatusLabel(milestone.status)}.
        </p>

        {!isConnected ? (
          <div className="stack-sm">
            <p>Connect a wallet to unlock role-specific milestone actions.</p>
            <div className="action-row">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  className="button button--primary"
                  disabled={isConnectPending}
                  onClick={() => connect({ connector })}
                  type="button"
                >
                  Connect {connector.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="stack-sm">
            <p>Wallet: {address}</p>
            <p>Chain: {chainId === configuredChain.id ? configuredChain.name : `Wrong network (${chainId})`}</p>
            <button className="button button--ghost" onClick={() => disconnect()} type="button">
              Disconnect
            </button>
          </div>
        )}

        {isWrongChain ? <p className="status-text">Switch to {configuredChain.name} to perform contract actions.</p> : null}
        {hash ? <p className="status-text">Last submitted tx: {hash}</p> : null}
        {error ? <p className="status-text">Write error: {error.message}</p> : null}
      </article>

      <article className="panel stack-md">
        <div className="eyebrow">Milestone actions</div>
        <h2>Allowed next step</h2>

        <div className="stack-md">
          {role === "buyer" && milestone.status === 0 ? (
            <button
              className="button button--primary"
              disabled={isBusy || isWrongChain}
              onClick={() => runWrite("fundMilestone", [milestoneId])}
              type="button"
            >
              Fund milestone
            </button>
          ) : null}

          {role === "seller" && milestone.status === 1 ? (
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

          {role === "buyer" && milestone.status === 2 ? (
            <div className="stack-sm">
              <button
                className="button button--primary"
                disabled={isBusy || isWrongChain}
                onClick={() => runWrite("approveMilestone", [milestoneId])}
                type="button"
              >
                Approve milestone
              </button>

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
            </div>
          ) : null}

          {role === "seller" && milestone.status === 2 ? (
            <button
              className="button button--primary"
              disabled={isBusy || isWrongChain}
              onClick={() => runWrite("claimAfterReviewWindow", [milestoneId])}
              type="button"
            >
              Claim after timeout
            </button>
          ) : null}

          {role === "arbiter" && milestone.status === 5 ? (
            <a className="button button--ghost" href={`/deals/${overview.address}/disputes/${milestoneId.toString()}`}>
              Open dispute resolution
            </a>
          ) : null}

          {!([
            role === "buyer" && milestone.status === 0,
            role === "seller" && milestone.status === 1,
            role === "buyer" && milestone.status === 2,
            role === "seller" && milestone.status === 2,
            role === "arbiter" && milestone.status === 5,
          ].some(Boolean)) ? (
            <p className="status-text">No direct action is available for the connected role in this milestone state.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}

const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
