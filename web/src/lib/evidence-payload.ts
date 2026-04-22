import { hashJson } from "@/lib/hash";

export const evidenceReferenceTypes = ["deliverable", "qa", "communication", "other"] as const;
export type EvidenceReferenceType = (typeof evidenceReferenceTypes)[number];

export const disputeReasonCodes = ["scope-mismatch", "quality-gap", "late-delivery", "other"] as const;
export type DisputeReasonCode = (typeof disputeReasonCodes)[number];

export type EvidenceReferenceInput = {
  type: string;
  label: string;
  url: string;
};

export type ComposeEvidencePayloadInput = {
  mode: "submission" | "dispute";
  note: string;
  references: EvidenceReferenceInput[];
  reasonCode?: string | null;
};

export type EvidencePayload = {
  version: 1;
  mode: "submission" | "dispute";
  note: string;
  references: {
    type: EvidenceReferenceType;
    label: string;
    url: string;
  }[];
  dispute?: {
    reasonCode: DisputeReasonCode;
  };
};

export type ComposeEvidencePayloadResult = {
  errors: string[];
  payload: EvidencePayload | null;
  payloadJson: string | null;
  payloadHash: `0x${string}` | null;
};

const MAX_REFERENCES = 10;

export function composeEvidencePayload(input: ComposeEvidencePayloadInput): ComposeEvidencePayloadResult {
  const errors: string[] = [];
  const note = normalizeText(input.note);

  if (!note) {
    errors.push("Public note is required.");
  }

  if (input.references.length === 0) {
    errors.push("At least one reference is required.");
  }

  if (input.references.length > MAX_REFERENCES) {
    errors.push(`No more than ${MAX_REFERENCES} references are allowed.`);
  }

  const normalizedReferences = input.references
    .map((reference, index) => normalizeReference(reference, index))
    .flatMap((result) => {
      errors.push(...result.errors);
      return result.reference ? [result.reference] : [];
    });

  const seenReferenceKeys = new Set<string>();
  for (const reference of normalizedReferences) {
    const key = `${reference.type}|${reference.url}`;
    if (seenReferenceKeys.has(key)) {
      errors.push(`Duplicate reference detected for ${reference.type} (${reference.url}).`);
      continue;
    }

    seenReferenceKeys.add(key);
  }

  let disputeReasonCode: DisputeReasonCode | undefined;
  if (input.mode === "dispute") {
    const normalizedReason = normalizeText(input.reasonCode ?? "");
    if (!normalizedReason) {
      errors.push("Dispute reason code is required.");
    } else if (!isDisputeReasonCode(normalizedReason)) {
      errors.push(`Unsupported dispute reason code '${normalizedReason}'.`);
    } else {
      disputeReasonCode = normalizedReason;
    }
  }

  if (errors.length > 0) {
    return {
      errors,
      payload: null,
      payloadJson: null,
      payloadHash: null,
    };
  }

  const payload: EvidencePayload = {
    version: 1,
    mode: input.mode,
    note,
    references: normalizedReferences.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      return a.url.localeCompare(b.url);
    }),
    ...(input.mode === "dispute" && disputeReasonCode
      ? {
          dispute: {
            reasonCode: disputeReasonCode,
          },
        }
      : {}),
  };

  return {
    errors: [],
    payload,
    payloadJson: JSON.stringify(payload),
    payloadHash: hashJson(payload),
  };
}

function normalizeReference(
  reference: EvidenceReferenceInput,
  index: number
): {
  reference: { type: EvidenceReferenceType; label: string; url: string } | null;
  errors: string[];
} {
  const type = normalizeText(reference.type);
  const label = normalizeText(reference.label);
  const rawUrl = normalizeText(reference.url);

  const errors: string[] = [];

  if (!type) {
    errors.push(`Reference ${index + 1} type is required.`);
  } else if (!isEvidenceReferenceType(type)) {
    errors.push(`Reference ${index + 1} uses unsupported type '${type}'.`);
  }

  if (!label) {
    errors.push(`Reference ${index + 1} label is required.`);
  }

  if (!rawUrl) {
    errors.push(`Reference ${index + 1} URL is required.`);
  }

  let url = "";
  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl);
      if (!["https:", "http:"].includes(parsedUrl.protocol)) {
        errors.push(`Reference ${index + 1} URL must use http or https.`);
      } else {
        url = parsedUrl.toString();
      }
    } catch {
      errors.push(`Reference ${index + 1} URL is invalid.`);
    }
  }

  if (errors.length > 0) {
    return { reference: null, errors };
  }

  return {
    reference: {
      type: type as EvidenceReferenceType,
      label,
      url,
    },
    errors: [],
  };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isEvidenceReferenceType(value: string): value is EvidenceReferenceType {
  return (evidenceReferenceTypes as readonly string[]).includes(value);
}

function isDisputeReasonCode(value: string): value is DisputeReasonCode {
  return (disputeReasonCodes as readonly string[]).includes(value);
}
