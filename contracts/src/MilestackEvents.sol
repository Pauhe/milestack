// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

event EscrowCreated(
    address indexed escrow,
    address indexed buyer,
    address indexed seller,
    address arbiter,
    address token,
    uint256 milestoneCount,
    bytes32 metadataHash
);

event MilestoneFunded(uint256 indexed milestoneId, uint256 amount);
event MilestoneSubmitted(
    uint256 indexed milestoneId,
    bytes32 evidenceHash,
    uint64 submittedAt,
    uint64 reviewDeadline
);
event MilestoneApproved(uint256 indexed milestoneId);
event MilestoneClaimable(uint256 indexed milestoneId);
event MilestoneClaimed(uint256 indexed milestoneId, uint256 sellerAmount, uint256 feeAmount);
event MilestoneDisputed(uint256 indexed milestoneId, bytes32 disputeHash);
event DisputeResolved(
    uint256 indexed milestoneId,
    uint256 buyerAmount,
    uint256 sellerAmount,
    uint256 feeAmount
);
event MilestoneCancelled(uint256 indexed milestoneId);
event DealCompleted();
event DealCancelled();
