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
import {
  composeEvidencePayload,
  disputeReasonCodes,
  evidenceReferenceTypes,
  type DisputeReasonCode,
  type EvidenceReferenceInput,
} from "@/lib/evidence-payload";
import { deriveMilestoneActionSemantics, type MilestoneRole } from "@/lib/milestone-semantics";
import { getDealStatusLabel } from "@/lib/status";
import { deriveActionPanelGuidance } from "@/lib/workflow-guidance";
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

type EvidenceDraft = {
  note: string;
  references: EvidenceReferenceInput[];
};

const defaultReference: EvidenceReferenceInput = {
  type: "deliverable",
  label: "",
  url: "",
};

const defaultSubmissionDraft: EvidenceDraft = {
  note: "",
  references: [{ ...defaultReference }],
};

const defaultDisputeDraft: EvidenceDraft = {
  note: "",
  references: [{ ...defaultReference, type: "communication" }],
};

const defaultDisputeReason: DisputeReasonCode = "scope-mismatch";

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
  const [submissionDraft, setSubmissionDraft] = useState<EvidenceDraft>(defaultSubmissionDraft);
  const [disputeDraft, setDisputeDraft] = useState<EvidenceDraft>(defaultDisputeDraft);
  const [disputeReasonCode, setDisputeReasonCode] = useState<DisputeReasonCode>(defaultDisputeReason);

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

  const submissionPayload = useMemo(
    () =>
      composeEvidencePayload({
        mode: "submission",
        note: submissionDraft.note,
        references: submissionDraft.references,
      }),
    [submissionDraft]
  );

  const disputePayload = useMemo(
    () =>
      composeEvidencePayload({
        mode: "dispute",
        note: disputeDraft.note,
        references: disputeDraft.references,
        reasonCode: disputeReasonCode,
      }),
    [disputeDraft, disputeReasonCode]
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

  function updateReference(
    mode: "submission" | "dispute",
    index: number,
    field: keyof EvidenceReferenceInput,
    value: string
  ) {
    const applyUpdate = (draft: EvidenceDraft): EvidenceDraft => ({
      ...draft,
      references: draft.references.map((reference, referenceIndex) =>
        referenceIndex === index
          ? {
              ...reference,
              [field]: value,
            }
          : reference
      ),
    });

    if (mode === "submission") {
      setSubmissionDraft((current) => applyUpdate(current));
      return;
    }

    setDisputeDraft((current) => applyUpdate(current));
  }

  function addReference(mode: "submission" | "dispute") {
    const nextReference: EvidenceReferenceInput = {
      ...defaultReference,
      type: mode === "dispute" ? "communication" : "deliverable",
    };

    if (mode === "submission") {
      setSubmissionDraft((current) => ({
        ...current,
        references: [...current.references, nextReference],
      }));
      return;
    }

    setDisputeDraft((current) => ({
      ...current,
      references: [...current.references, nextReference],
    }));
  }

  function removeReference(mode: "submission" | "dispute", index: number) {
    if (mode === "submission") {
      setSubmissionDraft((current) => ({
        ...current,
        references: current.references.filter((_, referenceIndex) => referenceIndex !== index),
      }));
      return;
    }

    setDisputeDraft((current) => ({
      ...current,
      references: current.references.filter((_, referenceIndex) => referenceIndex !== index),
    }));
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
                <span>Public submission note</span>
                <textarea
                  className="text-input text-input--multiline"
                  onChange={(event) =>
                    setSubmissionDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Public narrative describing delivered work, review scope, and expected acceptance evidence."
                  value={submissionDraft.note}
                />
              </label>

              {submissionDraft.references.map((reference, index) => (
                <div className="stack-sm" key={`submission-reference-${index}`}>
                  <label className="field stack-sm">
                    <span>Reference type</span>
                    <select
                      className="text-input"
                      onChange={(event) => updateReference("submission", index, "type", event.target.value)}
                      value={reference.type}
                    >
                      {evidenceReferenceTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field stack-sm">
                    <span>Reference label</span>
                    <input
                      className="text-input"
                      onChange={(event) => updateReference("submission", index, "label", event.target.value)}
                      placeholder="e.g. Staging URL, QA report"
                      value={reference.label}
                    />
                  </label>
                  <label className="field stack-sm">
                    <span>Reference URL</span>
                    <input
                      className="text-input"
                      onChange={(event) => updateReference("submission", index, "url", event.target.value)}
                      placeholder="https://..."
                      value={reference.url}
                    />
                  </label>
                  {submissionDraft.references.length > 1 ? (
                    <button
                      className="button button--ghost"
                      onClick={() => removeReference("submission", index)}
                      type="button"
                    >
                      Remove reference
                    </button>
                  ) : null}
                </div>
              ))}

              <button className="button button--ghost" onClick={() => addReference("submission")} type="button">
                Add reference
              </button>

              <p className="status-text">
                Public note + references are public-facing. Only the canonical hash is submitted onchain.
              </p>
              <p className="status-text">
                Canonical submission hash preview: {submissionPayload.payloadHash ?? "Unavailable until payload is valid."}
              </p>
              {submissionPayload.errors.length > 0 ? (
                <ul className="plain-list stack-sm">
                  {submissionPayload.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}

              <button
                className="button button--primary"
                disabled={isBusy || isWrongChain || submissionPayload.errors.length > 0 || !submissionPayload.payloadHash}
                onClick={() => runWrite("submitMilestone", [milestoneId, submissionPayload.payloadHash])}
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
                    <span>Dispute reason code</span>
                    <select
                      className="text-input"
                      onChange={(event) => setDisputeReasonCode(event.target.value as DisputeReasonCode)}
                      value={disputeReasonCode}
                    >
                      {disputeReasonCodes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field stack-sm">
                    <span>Public dispute note</span>
                    <textarea
                      className="text-input text-input--multiline"
                      onChange={(event) =>
                        setDisputeDraft((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Public rationale describing why buyer is disputing this milestone."
                      value={disputeDraft.note}
                    />
                  </label>

                  {disputeDraft.references.map((reference, index) => (
                    <div className="stack-sm" key={`dispute-reference-${index}`}>
                      <label className="field stack-sm">
                        <span>Reference type</span>
                        <select
                          className="text-input"
                          onChange={(event) => updateReference("dispute", index, "type", event.target.value)}
                          value={reference.type}
                        >
                          {evidenceReferenceTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field stack-sm">
                        <span>Reference label</span>
                        <input
                          className="text-input"
                          onChange={(event) => updateReference("dispute", index, "label", event.target.value)}
                          placeholder="e.g. Buyer review notes"
                          value={reference.label}
                        />
                      </label>
                      <label className="field stack-sm">
                        <span>Reference URL</span>
                        <input
                          className="text-input"
                          onChange={(event) => updateReference("dispute", index, "url", event.target.value)}
                          placeholder="https://..."
                          value={reference.url}
                        />
                      </label>
                      {disputeDraft.references.length > 1 ? (
                        <button
                          className="button button--ghost"
                          onClick={() => removeReference("dispute", index)}
                          type="button"
                        >
                          Remove reference
                        </button>
                      ) : null}
                    </div>
                  ))}

                  <button className="button button--ghost" onClick={() => addReference("dispute")} type="button">
                    Add dispute reference
                  </button>

                  <p className="status-text">
                    Dispute narratives are public-facing metadata. Only the canonical hash is written onchain.
                  </p>
                  <p className="status-text">
                    Canonical dispute hash preview: {disputePayload.payloadHash ?? "Unavailable until payload is valid."}
                  </p>
                  {disputePayload.errors.length > 0 ? (
                    <ul className="plain-list stack-sm">
                      {disputePayload.errors.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}

                  <button
                    className="button button--ghost"
                    disabled={isBusy || isWrongChain || disputePayload.errors.length > 0 || !disputePayload.payloadHash}
                    onClick={() => runWrite("openDispute", [milestoneId, disputePayload.payloadHash])}
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
