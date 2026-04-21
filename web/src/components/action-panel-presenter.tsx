import type { ReactNode } from "react";

import {
  WorkflowCallout,
  WorkflowSectionHeader,
  WorkflowStatusRow,
  WorkflowSurfacePanel,
} from "@/components/workflow-surface";

type WalletConnectorOption = {
  uid: string;
  name: string;
  onConnect: () => void;
};

type WalletPanelProps = {
  roleTitle: string;
  description: string;
  isConnected: boolean;
  walletAddress?: string;
  chainLabel?: string;
  connectors?: WalletConnectorOption[];
  isConnectPending?: boolean;
  onDisconnect?: () => void;
  wrongChainMessage?: string | null;
  txHash?: string | null;
  txHashLabel?: string;
  errorMessage?: string | null;
  errorTitle?: string;
  children?: ReactNode;
};

type ActionPanelProps = {
  eyebrow: string;
  title: string;
  nextStepLabel?: string;
  nextStepMessage?: string;
  pendingMessage?: string | null;
  blockedReason?: string | null;
  trustHint?: string | null;
  children: ReactNode;
};

export function ActionPanelWalletPanel({
  roleTitle,
  description,
  isConnected,
  walletAddress,
  chainLabel,
  connectors = [],
  isConnectPending = false,
  onDisconnect,
  wrongChainMessage,
  txHash,
  txHashLabel = "Last submitted tx",
  errorMessage,
  errorTitle = "Transaction error",
  children,
}: WalletPanelProps) {
  return (
    <WorkflowSurfacePanel>
      <WorkflowSectionHeader eyebrow="Connected role" title={roleTitle} description={description} />

      {!isConnected ? (
        <div className="stack-sm">
          <p>Connect a wallet to unlock role-specific milestone actions.</p>
          <div className="action-row">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                className="button button--primary"
                disabled={isConnectPending}
                onClick={connector.onConnect}
                type="button"
              >
                Connect {connector.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          {walletAddress ? <p>Wallet: {walletAddress}</p> : null}
          {chainLabel ? <p>Chain: {chainLabel}</p> : null}
          {onDisconnect ? (
            <div className="action-row">
              <button className="button button--ghost" onClick={onDisconnect} type="button">
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
      )}

      {wrongChainMessage ? (
        <WorkflowCallout tone="degraded" title="Wrong chain" testId="action-panel-wrong-chain">
          {wrongChainMessage}
        </WorkflowCallout>
      ) : null}

      {txHash ? (
        <WorkflowStatusRow
          label={txHashLabel}
          value={txHash}
          testId="action-panel-last-tx"
        />
      ) : null}

      {errorMessage ? (
        <WorkflowCallout tone="degraded" title={errorTitle} testId="action-panel-write-error">
          {errorMessage}
        </WorkflowCallout>
      ) : null}

      {children}
    </WorkflowSurfacePanel>
  );
}

export function ActionPanelWorkflowPanel({
  eyebrow,
  title,
  nextStepLabel,
  nextStepMessage,
  pendingMessage,
  blockedReason,
  trustHint,
  children,
}: ActionPanelProps) {
  return (
    <WorkflowSurfacePanel>
      <WorkflowSectionHeader eyebrow={eyebrow} title={title} />

      {nextStepLabel && nextStepMessage ? (
        <WorkflowStatusRow label={nextStepLabel} value={nextStepMessage} testId="action-panel-next-step" />
      ) : null}

      {pendingMessage ? (
        <WorkflowCallout tone="trust" title="Transaction pending" testId="action-panel-pending">
          {pendingMessage}
        </WorkflowCallout>
      ) : null}

      {blockedReason ? (
        <WorkflowCallout tone="degraded" title="Blocked" testId="action-panel-blocked">
          {blockedReason}
        </WorkflowCallout>
      ) : null}

      {trustHint ? (
        <WorkflowCallout tone="trust" title="Lifecycle hint" testId="action-panel-trust-hint">
          {trustHint}
        </WorkflowCallout>
      ) : null}

      <div className="action-panel-workflow-body stack-md">{children}</div>
    </WorkflowSurfacePanel>
  );
}
