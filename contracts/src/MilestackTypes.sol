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
