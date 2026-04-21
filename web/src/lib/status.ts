const dealStatusLabels = ["Draft", "Active", "Completed", "Cancelled"] as const;

const milestoneStatusLabels = [
  "Pending funding",
  "Funded",
  "Submitted",
  "Approved",
  "Claimable",
  "Disputed",
  "Resolved",
  "Paid out",
  "Refunded",
  "Cancelled",
] as const;

export function getDealStatusLabel(status: number): string {
  return dealStatusLabels[status] ?? `Unknown (${status})`;
}

export function getMilestoneStatusLabel(status: number): string {
  return milestoneStatusLabels[status] ?? `Unknown (${status})`;
}
