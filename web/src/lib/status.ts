import { getMilestoneStatusSemanticLabel } from "@/lib/milestone-semantics";

const dealStatusLabels = ["Draft", "Active", "Completed", "Cancelled"] as const;

export function getDealStatusLabel(status: number): string {
  return dealStatusLabels[status] ?? `Unknown (${status})`;
}

export function getMilestoneStatusLabel(status: number): string {
  return getMilestoneStatusSemanticLabel(status);
}
