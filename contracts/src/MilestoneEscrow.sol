// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DealConfig, DealStatus, Milestone, MilestoneConfig, MilestoneStatus} from "./MilestackTypes.sol";
import {
    Unauthorized,
    InvalidMilestoneState,
    InvalidMilestoneIndex,
    InvalidMilestoneSequence,
    ActiveDisputeExists,
    InvalidEvidenceHash,
    InvalidDisputeHash,
    NoActiveDispute,
    InvalidResolutionSplit,
    DeadlineNotReached,
    DeadlinePassed,
    NothingToCancel
} from "./MilestackErrors.sol";
import "./MilestackEvents.sol";

contract MilestoneEscrow {
    using SafeERC20 for IERC20;

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

        _safeTransferFrom(msg.sender, address(this), milestone.amount);

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

        _safeTransferFrom(msg.sender, address(this), totalToFund);

        for (uint256 i = currentMilestoneIndex; i < milestones.length; i++) {
            milestones[i].status = MilestoneStatus.Funded;
            emit MilestoneFunded(i, milestones[i].amount);
        }

        totalFunded += totalToFund;

        if (dealStatus == DealStatus.Draft) {
            dealStatus = DealStatus.Active;
        }
    }

    function submitMilestone(uint256 milestoneId, bytes32 evidenceHash) external {
        if (msg.sender != dealConfig.seller) revert Unauthorized();
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();
        if (milestoneId != currentMilestoneIndex) revert InvalidMilestoneSequence();

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Funded) revert InvalidMilestoneState();

        uint64 submittedAt = uint64(block.timestamp);
        uint64 reviewDeadline = submittedAt + milestone.reviewWindowSeconds;

        milestone.evidenceHash = evidenceHash;
        milestone.submittedAt = submittedAt;
        milestone.reviewDeadline = reviewDeadline;
        milestone.status = MilestoneStatus.Submitted;

        emit MilestoneSubmitted(milestoneId, evidenceHash, submittedAt, reviewDeadline);
    }

    function approveMilestone(uint256 milestoneId) external {
        if (msg.sender != dealConfig.buyer) revert Unauthorized();
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidMilestoneState();
        if (milestoneId != currentMilestoneIndex) revert InvalidMilestoneSequence();
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (block.timestamp > milestone.reviewDeadline) revert DeadlinePassed();

        milestone.status = MilestoneStatus.Approved;
        _payoutMilestone(milestoneId, milestone);

        emit MilestoneApproved(milestoneId);
    }

    function claimAfterReviewWindow(uint256 milestoneId) external {
        if (msg.sender != dealConfig.seller) revert Unauthorized();
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidMilestoneState();
        if (milestoneId != currentMilestoneIndex) revert InvalidMilestoneSequence();
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (block.timestamp <= milestone.reviewDeadline) revert DeadlineNotReached();

        _payoutMilestone(milestoneId, milestone);
    }

    function openDispute(uint256 milestoneId, bytes32 disputeHash) external {
        if (msg.sender != dealConfig.buyer) revert Unauthorized();
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (disputeHash == bytes32(0)) revert InvalidDisputeHash();
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidMilestoneState();
        if (milestoneId != currentMilestoneIndex) revert InvalidMilestoneSequence();
        if (block.timestamp > milestone.reviewDeadline) revert DeadlinePassed();

        milestone.disputeHash = disputeHash;
        milestone.status = MilestoneStatus.Disputed;
        activeDisputeMilestoneId = milestoneId;

        emit MilestoneDisputed(milestoneId, disputeHash);
    }

    function resolveDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount) external {
        if (msg.sender != dealConfig.arbiter) revert Unauthorized();
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();
        if (activeDisputeMilestoneId == type(uint256).max || activeDisputeMilestoneId != milestoneId) {
            revert NoActiveDispute();
        }

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Disputed) revert InvalidMilestoneState();
        if (buyerAmount + sellerAmount != milestone.amount) revert InvalidResolutionSplit();

        uint256 feeAmount = (sellerAmount * dealConfig.protocolFeeBps) / 10_000;
        uint256 sellerNetAmount = sellerAmount - feeAmount;

        milestone.buyerAward = buyerAmount;
        milestone.sellerAward = sellerAmount;
        activeDisputeMilestoneId = type(uint256).max;
        totalRefundedToBuyer += buyerAmount;
        totalReleasedToSeller += sellerNetAmount;
        totalFeesCollected += feeAmount;
        _finalizeMilestone(milestone, sellerAmount == 0 ? MilestoneStatus.Refunded : MilestoneStatus.PaidOut);

        if (buyerAmount > 0) {
            _safeTransfer(dealConfig.buyer, buyerAmount);
        }

        if (sellerNetAmount > 0) {
            _safeTransfer(dealConfig.seller, sellerNetAmount);
        }

        if (feeAmount > 0) {
            _safeTransfer(dealConfig.feeRecipient, feeAmount);
        }

        emit DisputeResolved(milestoneId, buyerAmount, sellerAmount, feeAmount);
    }

    function cancelUnfundedMilestones() external {
        if (msg.sender != dealConfig.buyer && msg.sender != dealConfig.seller) revert Unauthorized();

        uint256 cancelledCount;

        for (uint256 i = currentMilestoneIndex; i < milestones.length; i++) {
            MilestoneStatus status = milestones[i].status;

            if (
                status == MilestoneStatus.Funded || status == MilestoneStatus.Submitted || status == MilestoneStatus.Disputed
            ) {
                revert InvalidMilestoneState();
            }

            if (status == MilestoneStatus.PendingFunding) {
                milestones[i].status = MilestoneStatus.Cancelled;
                cancelledCount++;
                emit MilestoneCancelled(i);
            }
        }

        if (cancelledCount == 0) revert NothingToCancel();

        dealStatus = DealStatus.Cancelled;
        emit DealCancelled();
    }

    function _payoutMilestone(uint256 milestoneId, Milestone storage milestone) internal {
        uint256 feeAmount = (milestone.amount * dealConfig.protocolFeeBps) / 10_000;
        uint256 sellerAmount = milestone.amount - feeAmount;

        milestone.sellerAward = sellerAmount;
        _finalizeMilestone(milestone, MilestoneStatus.PaidOut);

        if (sellerAmount > 0) {
            _safeTransfer(dealConfig.seller, sellerAmount);
        }

        if (feeAmount > 0) {
            _safeTransfer(dealConfig.feeRecipient, feeAmount);
        }

        totalReleasedToSeller += sellerAmount;
        totalFeesCollected += feeAmount;

        emit MilestoneClaimed(milestoneId, sellerAmount, feeAmount);
    }

    function _finalizeMilestone(Milestone storage milestone, MilestoneStatus terminalStatus) internal {
        milestone.status = terminalStatus;

        if (currentMilestoneIndex + 1 < milestones.length) {
            currentMilestoneIndex++;
        } else {
            dealStatus = DealStatus.Completed;
            emit DealCompleted();
        }
    }

    function _safeTransfer(address to, uint256 amount) internal {
        IERC20(dealConfig.token).safeTransfer(to, amount);
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        IERC20(dealConfig.token).safeTransferFrom(from, to, amount);
    }
}
