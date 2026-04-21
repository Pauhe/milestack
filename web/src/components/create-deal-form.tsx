"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEventLogs, type Address, type Log } from "viem";
import { useAccount, useConnect, useDisconnect, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { configuredChain } from "@/lib/chains";
import { appEnv } from "@/lib/env";
import { escrowFactoryAbi } from "@/lib/contracts/escrow-factory-abi";
import {
  defaultCreateDealState,
  validateCreateDeal,
  type CreateDealFormState,
  type CreateDealMilestoneInput,
} from "@/lib/create-deal";
import { normalizeAddress } from "@/lib/contracts/milestone-escrow";

export function CreateDealForm() {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: hash, error, isPending, writeContract } = useWriteContract();
  const [state, setState] = useState<CreateDealFormState>(defaultCreateDealState);

  const validation = useMemo(() => validateCreateDeal(address, state), [address, state]);

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: Boolean(hash),
    },
  });

  useEffect(() => {
    if (!receipt) return;

    const escrowAddress = extractEscrowAddressFromReceipt(receipt.logs);
    if (!escrowAddress) return;

    router.push(`/deals/${escrowAddress}`);
    router.refresh();
  }, [receipt, router]);

  const isWrongChain = isConnected && chainId !== configuredChain.id;
  const isBusy = isPending || isConfirming;
  const factoryAddress = appEnv.factoryAddress;

  function updateField<K extends keyof CreateDealFormState>(key: K, value: CreateDealFormState[K]) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function updateMilestone(index: number, patch: Partial<CreateDealMilestoneInput>) {
    setState((current) => ({
      ...current,
      milestones: current.milestones.map((milestone, milestoneIndex) =>
        milestoneIndex === index ? { ...milestone, ...patch } : milestone
      ),
    }));
  }

  function addMilestone() {
    setState((current) => ({
      ...current,
      milestones: [
        ...current.milestones,
        {
          title: "",
          description: "",
          amount: "",
          reviewWindowDays: "5",
        },
      ],
    }));
  }

  function removeMilestone(index: number) {
    setState((current) => ({
      ...current,
      milestones: current.milestones.filter((_, milestoneIndex) => milestoneIndex !== index),
    }));
  }

  function submit() {
    if (!factoryAddress || !validation.metadataHash || validation.errors.length > 0 || isWrongChain || !address) {
      return;
    }

    const normalizedFactoryAddress = normalizeAddress(factoryAddress);
    const normalizedBuyerAddress = normalizeAddress(state.buyer);
    const normalizedSellerAddress = normalizeAddress(address);
    const normalizedArbiterAddress = normalizeAddress(state.arbiter);

    writeContract(
      {
        address: normalizedFactoryAddress as Address,
        abi: escrowFactoryAbi,
        functionName: "createEscrow",
        args: [
          normalizedBuyerAddress,
          normalizedSellerAddress,
          normalizedArbiterAddress,
          validation.metadataHash,
          validation.milestoneConfigs,
        ],
      }
    );
  }

  return (
    <section className="stack-lg">
      <article className="panel stack-md">
        <div className="eyebrow">Seller wallet</div>
        <h2>Connected account</h2>

        {!isConnected ? (
          <div className="stack-sm">
            <p>Connect the seller wallet to create and deploy a deal.</p>
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

        {isWrongChain ? <p className="status-text">Switch to {configuredChain.name} before deploying.</p> : null}
        {!factoryAddress ? (
          <p className="status-text">Set `NEXT_PUBLIC_FACTORY_ADDRESS` to enable live escrow deployment.</p>
        ) : null}
        {hash ? <p className="status-text">Deployment tx: {hash}</p> : null}
        {error ? <p className="status-text">Deployment error: {error.message}</p> : null}
      </article>

      <article className="panel stack-md">
        <div className="eyebrow">Deal setup</div>
        <h2>Create a milestone escrow</h2>

        <div className="grid-two">
          <label className="field stack-sm">
            <span>Buyer address</span>
            <input
              className="text-input"
              onChange={(event) => updateField("buyer", event.target.value)}
              placeholder="0x..."
              value={state.buyer}
            />
          </label>

          <label className="field stack-sm">
            <span>Arbiter address</span>
            <input
              className="text-input"
              onChange={(event) => updateField("arbiter", event.target.value)}
              placeholder="0x..."
              value={state.arbiter}
            />
          </label>
        </div>

        <label className="field stack-sm">
          <span>Deal title</span>
          <input
            className="text-input"
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="Website redesign for ExampleCo"
            value={state.title}
          />
        </label>

        <label className="field stack-sm">
          <span>Deal summary</span>
          <textarea
            className="text-input text-input--multiline"
            onChange={(event) => updateField("summary", event.target.value)}
            placeholder="Describe the scope, delivery model, and high-level terms."
            value={state.summary}
          />
        </label>

        <label className="field stack-sm">
          <span>Terms URL (optional)</span>
          <input
            className="text-input"
            onChange={(event) => updateField("termsUrl", event.target.value)}
            placeholder="https://..."
            value={state.termsUrl}
          />
        </label>
      </article>

      <article className="panel stack-md">
        <div className="eyebrow">Milestones</div>
        <h2>Milestone plan</h2>

        {state.milestones.map((milestone, index) => (
          <section className="panel panel--nested stack-md" key={`${index}-${milestone.title || "draft"}`}>
            <div className="action-row action-row--between">
              <h3>Milestone {index + 1}</h3>
              {state.milestones.length > 1 ? (
                <button className="button button--ghost" onClick={() => removeMilestone(index)} type="button">
                  Remove
                </button>
              ) : null}
            </div>

            <label className="field stack-sm">
              <span>Title</span>
              <input
                className="text-input"
                onChange={(event) => updateMilestone(index, { title: event.target.value })}
                placeholder="Discovery and wireframes"
                value={milestone.title}
              />
            </label>

            <label className="field stack-sm">
              <span>Description</span>
              <textarea
                className="text-input text-input--multiline"
                onChange={(event) => updateMilestone(index, { description: event.target.value })}
                placeholder="Describe the deliverable and review expectations."
                value={milestone.description}
              />
            </label>

            <div className="grid-two">
              <label className="field stack-sm">
                <span>Amount (USDC)</span>
                <input
                  className="text-input"
                  inputMode="decimal"
                  onChange={(event) => updateMilestone(index, { amount: event.target.value })}
                  placeholder="1000"
                  value={milestone.amount}
                />
              </label>

              <label className="field stack-sm">
                <span>Review window (days)</span>
                <input
                  className="text-input"
                  inputMode="numeric"
                  onChange={(event) => updateMilestone(index, { reviewWindowDays: event.target.value })}
                  placeholder="5"
                  value={milestone.reviewWindowDays}
                />
              </label>
            </div>
          </section>
        ))}

        <div className="action-row">
          <button className="button button--ghost" onClick={addMilestone} type="button">
            Add milestone
          </button>
        </div>
      </article>

      <article className="panel stack-md">
        <div className="eyebrow">Preview</div>
        <h2>Deployment summary</h2>
        <p>Metadata hash: {validation.metadataHash ?? "Unavailable until required fields are valid."}</p>

        {validation.errors.length > 0 ? (
          <ul className="plain-list stack-sm">
            {validation.errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="status-text">
            The form is valid and ready to deploy through the escrow factory on {configuredChain.name}.
          </p>
        )}

        <button
          className="button button--primary"
          disabled={!factoryAddress || !isConnected || isWrongChain || isBusy || validation.errors.length > 0}
          onClick={submit}
          type="button"
        >
          Deploy escrow
        </button>
      </article>
    </section>
  );
}

function extractEscrowAddressFromReceipt(logs: readonly Log[]) {
  const parsedLogs = parseEventLogs({
    abi: escrowFactoryAbi,
    eventName: "EscrowCreated",
    logs: [...logs],
    strict: false,
  }) as Array<{ args?: { escrow?: Address } }>;

  return parsedLogs[0]?.args?.escrow ?? null;
}
