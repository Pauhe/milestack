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

  function refreshAfterWrite() {
    router.refresh();
  }

  function handleResolve() {
    if (!isExactSplit || parsedBuyerAward === null || parsedSellerAward === null) return;

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
      <article className="panel stack-md">
        <div className="eyebrow">Connected role</div>
        <h2>{role === "visitor" ? "Read-only visitor" : role}</h2>
        <p>Only the designated arbiter can resolve this disputed milestone.</p>

        {!isConnected ? (
          <div className="stack-sm">
            <p>Connect a wallet to continue.</p>
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

        {isWrongChain ? <p className="status-text">Switch to {configuredChain.name} to resolve.</p> : null}
        {hash ? <p className="status-text">Last submitted tx: {hash}</p> : null}
        {error ? <p className="status-text">Resolution error: {error.message}</p> : null}
      </article>

      <article className="panel stack-md">
        <div className="eyebrow">Arbiter resolution</div>
        <h2>Resolve disputed milestone</h2>
        <p>
          Milestone amount: {milestoneAmountText} USDC. Dispute decisions are human, not
          algorithmic, and the resolution is final for this milestone.
        </p>

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
          <p className="status-text">
            Current split total: {formatUnits(totalAward, 6)} / {milestoneAmountText} USDC
          </p>

          {parsedBuyerAward === null || parsedSellerAward === null ? (
            <p className="status-text">Enter valid USDC amounts with up to 6 decimal places.</p>
          ) : isExactSplit ? (
            <p className="status-text">The split matches the milestone amount exactly.</p>
          ) : (
            <p className="status-text">Buyer and seller awards must sum exactly to the milestone amount.</p>
          )}
        </div>

        <button
          className="button button--primary"
          disabled={role !== "arbiter" || isWrongChain || isBusy || !isExactSplit}
          onClick={handleResolve}
          type="button"
        >
          Submit resolution
        </button>
      </article>
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
