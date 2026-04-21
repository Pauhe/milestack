// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DealConfig, DealStatus, Milestone, MilestoneConfig, MilestoneStatus} from "./MilestackTypes.sol";
import {
    Unauthorized,
    InvalidMilestoneState,
    InvalidMilestoneIndex,
    InvalidMilestoneSequence,
    ActiveDisputeExists,
    TransferFailed
} from "./MilestackErrors.sol";
import "./MilestackEvents.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MilestoneEscrow {
    DealConfig public dealConfig;
    DealStatus public dealStatus;
    uint256 public currentMilestoneIndex;
    uint256 public activeDisputeMilestoneId;
    uint256 public totalFunded;
    uint256 public totalReleasedToSeller;
    uint256 public totalRefundedToBuyer;
    uint256 public totalFeesCollected;

    Milestone[] internal milestones;

    constructor(DealConfig memory config, MilestoneConfig[] memory milestoneConfigs) {
        dealConfig = config;
        dealStatus = DealStatus.Draft;
        activeDisputeMilestoneId = type(uint256).max;

        for (uint256 i = 0; i < milestoneConfigs.length; i++) {
            milestones.push(
                Milestone({
                    amount: milestoneConfigs[i].amount,
                    status: MilestoneStatus.PendingFunding,
                    reviewWindowSeconds: milestoneConfigs[i].reviewWindowSeconds,
                    submittedAt: 0,
                    reviewDeadline: 0,
                    evidenceHash: bytes32(0),
                    disputeHash: bytes32(0),
                    buyerAward: 0,
                    sellerAward: 0
                })
            );
        }
    }

    function buyer() external view returns (address) {
        return dealConfig.buyer;
    }

    function seller() external view returns (address) {
        return dealConfig.seller;
    }

    function arbiter() external view returns (address) {
        return dealConfig.arbiter;
    }

    function token() external view returns (address) {
        return dealConfig.token;
    }

    function metadataHash() external view returns (bytes32) {
        return dealConfig.metadataHash;
    }

    function feeRecipient() external view returns (address) {
        return dealConfig.feeRecipient;
    }

    function protocolFeeBps() external view returns (uint16) {
        return dealConfig.protocolFeeBps;
    }

    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();
        return milestones[milestoneId];
    }

    function fundMilestone(uint256 milestoneId) external {
        if (msg.sender != dealConfig.buyer) revert Unauthorized();
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();
        if (milestoneId != currentMilestoneIndex) revert InvalidMilestoneSequence();

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.PendingFunding) revert InvalidMilestoneState();

        bool ok = IERC20Minimal(dealConfig.token).transferFrom(msg.sender, address(this), milestone.amount);
        if (!ok) revert TransferFailed();

        milestone.status = MilestoneStatus.Funded;
        totalFunded += milestone.amount;

        if (dealStatus == DealStatus.Draft) {
            dealStatus = DealStatus.Active;
        }

        emit MilestoneFunded(milestoneId, milestone.amount);
    }

    function fundAllMilestones() external {
        if (msg.sender != dealConfig.buyer) revert Unauthorized();
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (currentMilestoneIndex >= milestones.length) revert InvalidMilestoneIndex();

        uint256 totalToFund;

        for (uint256 i = currentMilestoneIndex; i < milestones.length; i++) {
            if (milestones[i].status != MilestoneStatus.PendingFunding) revert InvalidMilestoneState();
            totalToFund += milestones[i].amount;
        }

        bool ok = IERC20Minimal(dealConfig.token).transferFrom(msg.sender, address(this), totalToFund);
        if (!ok) revert TransferFailed();

        for (uint256 i = currentMilestoneIndex; i < milestones.length; i++) {
            milestones[i].status = MilestoneStatus.Funded;
            emit MilestoneFunded(i, milestones[i].amount);
        }

        totalFunded += totalToFund;

        if (dealStatus == DealStatus.Draft) {
            dealStatus = DealStatus.Active;
        }
    }
}
