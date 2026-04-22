// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

enum DealStatus {
    Draft,
    Active,
    Completed,
    Cancelled
}

enum MilestoneStatus {
    PendingFunding,
    Funded,
    Submitted,
    Approved,
    Claimable,
    Disputed,
    Resolved,
    PaidOut,
    Refunded,
    Cancelled
}

enum ParticipantRole {
    None,
    Buyer,
    Seller,
    Arbiter,
    Observer
}

enum AuthorityAction {
    Fund,
    Submit,
    Approve,
    Claim,
    Dispute,
    Resolve,
    Cancel
}

uint8 constant AUTHORITY_MODEL_MVP = 0;
uint8 constant AUTHORITY_MODEL_WIDENED_V1 = 1;

uint32 constant PERMISSION_FUND = 1 << 0;
uint32 constant PERMISSION_SUBMIT = 1 << 1;
uint32 constant PERMISSION_APPROVE = 1 << 2;
uint32 constant PERMISSION_CLAIM = 1 << 3;
uint32 constant PERMISSION_DISPUTE = 1 << 4;
uint32 constant PERMISSION_RESOLVE = 1 << 5;
uint32 constant PERMISSION_CANCEL = 1 << 6;

struct DealConfig {
    address buyer;
    address seller;
    address arbiter;
    address token;
    address feeRecipient;
    uint16 protocolFeeBps;
    bytes32 metadataHash;
}

struct MilestoneConfig {
    uint256 amount;
    uint32 reviewWindowSeconds;
}

struct Milestone {
    uint256 amount;
    MilestoneStatus status;
    uint32 reviewWindowSeconds;
    uint64 submittedAt;
    uint64 reviewDeadline;
    bytes32 evidenceHash;
    bytes32 disputeHash;
    uint256 buyerAward;
    uint256 sellerAward;
}

struct TopologyParticipant {
    address account;
    ParticipantRole role;
    bool active;
}

struct DelegatedAuthority {
    address delegator;
    address delegate;
    uint32 permissions;
    bool active;
}

struct WidenedAuthorityConfig {
    uint8 modelVersion;
    TopologyParticipant[] participants;
    DelegatedAuthority[] delegations;
}
