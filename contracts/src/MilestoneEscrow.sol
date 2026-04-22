// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    AUTHORITY_MODEL_MVP,
    AUTHORITY_MODEL_WIDENED_V1,
    AuthorityAction,
    DealConfig,
    DealStatus,
    DelegatedAuthority,
    Milestone,
    MilestoneConfig,
    MilestoneStatus,
    ParticipantRole,
    TopologyParticipant,
    WidenedAuthorityConfig
} from "./MilestackTypes.sol";
import {
    Unauthorized,
    UnauthorizedDelegateOrTopology,
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
    NothingToCancel,
    InvalidAuthorityModelVersion,
    InvalidTopologyParticipant,
    InvalidParticipantRole,
    DuplicateTopologyParticipant,
    InvalidDelegatedAuthority,
    DuplicateDelegation,
    SelfDelegation,
    PrivilegeEscalation,
    InvalidPartyConfiguration
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

    uint8 public authorityModelVersion;

    mapping(address => ParticipantRole) public topologyRole;
    mapping(address => bool) public topologyActive;
    mapping(address => mapping(address => uint32)) public delegatedPermissions;

    Milestone[] internal milestones;

    constructor(
        DealConfig memory config,
        MilestoneConfig[] memory milestoneConfigs,
        WidenedAuthorityConfig memory widenedConfig
    ) {
        dealConfig = config;
        dealStatus = DealStatus.Draft;
        activeDisputeMilestoneId = type(uint256).max;
        authorityModelVersion = AUTHORITY_MODEL_MVP;

        _initializeMilestones(milestoneConfigs);

        if (widenedConfig.modelVersion != AUTHORITY_MODEL_MVP) {
            _configureWidenedAuthority(widenedConfig);
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
        _requireAction(msg.sender, AuthorityAction.Fund, milestoneId);
        address fundingSource = _payerForAction(msg.sender, AuthorityAction.Fund);
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();
        if (milestoneId != currentMilestoneIndex) revert InvalidMilestoneSequence();

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.PendingFunding) revert InvalidMilestoneState();

        _safeTransferFrom(fundingSource, address(this), milestone.amount);

        milestone.status = MilestoneStatus.Funded;
        totalFunded += milestone.amount;

        if (dealStatus == DealStatus.Draft) {
            dealStatus = DealStatus.Active;
        }

        emit MilestoneFunded(milestoneId, milestone.amount);
    }

    function fundAllMilestones() external {
        _requireAction(msg.sender, AuthorityAction.Fund, currentMilestoneIndex);
        address fundingSource = _payerForAction(msg.sender, AuthorityAction.Fund);
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();

        uint256 milestoneCount_ = milestones.length;
        if (currentMilestoneIndex >= milestoneCount_) revert InvalidMilestoneIndex();

        uint256 totalToFund;

        for (uint256 i = currentMilestoneIndex; i < milestoneCount_; i++) {
            if (milestones[i].status != MilestoneStatus.PendingFunding) {
                revert InvalidMilestoneState();
            }
            totalToFund += milestones[i].amount;
        }

        _safeTransferFrom(fundingSource, address(this), totalToFund);

        for (uint256 i = currentMilestoneIndex; i < milestoneCount_; i++) {
            milestones[i].status = MilestoneStatus.Funded;
            emit MilestoneFunded(i, milestones[i].amount);
        }

        totalFunded += totalToFund;

        if (dealStatus == DealStatus.Draft) {
            dealStatus = DealStatus.Active;
        }
    }

    function submitMilestone(uint256 milestoneId, bytes32 evidenceHash) external {
        _requireAction(msg.sender, AuthorityAction.Submit, milestoneId);
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
        _requireAction(msg.sender, AuthorityAction.Approve, milestoneId);
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
        _requireAction(msg.sender, AuthorityAction.Claim, milestoneId);
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();

        Milestone storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidMilestoneState();
        if (milestoneId != currentMilestoneIndex) revert InvalidMilestoneSequence();
        if (activeDisputeMilestoneId != type(uint256).max) revert ActiveDisputeExists();
        if (block.timestamp <= milestone.reviewDeadline) revert DeadlineNotReached();

        _payoutMilestone(milestoneId, milestone);
    }

    function openDispute(uint256 milestoneId, bytes32 disputeHash) external {
        _requireAction(msg.sender, AuthorityAction.Dispute, milestoneId);
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

    function resolveDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount)
        external
    {
        _requireAction(msg.sender, AuthorityAction.Resolve, milestoneId);
        if (milestoneId >= milestones.length) revert InvalidMilestoneIndex();
        if (
            activeDisputeMilestoneId == type(uint256).max || activeDisputeMilestoneId != milestoneId
        ) {
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
        _finalizeMilestone(
            milestone, sellerAmount == 0 ? MilestoneStatus.Refunded : MilestoneStatus.PaidOut
        );

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
        _requireAction(msg.sender, AuthorityAction.Cancel, currentMilestoneIndex);

        uint256 cancelledCount;
        uint256 milestoneCount_ = milestones.length;

        for (uint256 i = currentMilestoneIndex; i < milestoneCount_; i++) {
            MilestoneStatus status = milestones[i].status;

            if (
                status == MilestoneStatus.Funded || status == MilestoneStatus.Submitted
                    || status == MilestoneStatus.Disputed
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

    function _configureWidenedAuthority(WidenedAuthorityConfig memory widenedConfig) internal {
        if (widenedConfig.modelVersion != AUTHORITY_MODEL_WIDENED_V1) {
            revert InvalidAuthorityModelVersion();
        }

        TopologyParticipant[] memory participants = widenedConfig.participants;
        DelegatedAuthority[] memory delegations = widenedConfig.delegations;

        bool hasBuyer;
        bool hasSeller;
        bool hasArbiter;

        for (uint256 i = 0; i < participants.length; i++) {
            TopologyParticipant memory participant = participants[i];
            if (participant.account == address(0)) revert InvalidTopologyParticipant();
            if (participant.role == ParticipantRole.None) revert InvalidParticipantRole();

            for (uint256 j = 0; j < i; j++) {
                if (participants[j].account == participant.account) {
                    revert DuplicateTopologyParticipant();
                }
            }

            topologyRole[participant.account] = participant.role;
            topologyActive[participant.account] = participant.active;

            if (participant.account == dealConfig.buyer) {
                if (participant.role != ParticipantRole.Buyer || !participant.active) {
                    revert InvalidPartyConfiguration();
                }
                hasBuyer = true;
            }
            if (participant.account == dealConfig.seller) {
                if (participant.role != ParticipantRole.Seller || !participant.active) {
                    revert InvalidPartyConfiguration();
                }
                hasSeller = true;
            }
            if (participant.account == dealConfig.arbiter) {
                if (participant.role != ParticipantRole.Arbiter || !participant.active) {
                    revert InvalidPartyConfiguration();
                }
                hasArbiter = true;
            }
        }

        if (!hasBuyer || !hasSeller || !hasArbiter) revert InvalidPartyConfiguration();

        for (uint256 i = 0; i < delegations.length; i++) {
            DelegatedAuthority memory delegation = delegations[i];

            if (delegation.delegator == address(0) || delegation.delegate == address(0)) {
                revert InvalidDelegatedAuthority();
            }
            if (delegation.delegator == delegation.delegate) revert SelfDelegation();
            if (delegation.permissions == 0 || !delegation.active) revert InvalidDelegatedAuthority();

            for (uint256 j = 0; j < i; j++) {
                if (
                    delegations[j].delegator == delegation.delegator
                        && delegations[j].delegate == delegation.delegate
                ) {
                    revert DuplicateDelegation();
                }
            }

            ParticipantRole delegatorRole = topologyRole[delegation.delegator];
            if (delegatorRole == ParticipantRole.None) revert InvalidDelegatedAuthority();
            if (!topologyActive[delegation.delegator] || !topologyActive[delegation.delegate]) {
                revert InvalidDelegatedAuthority();
            }

            uint32 allowed = _allowedPermissionsForRole(delegatorRole);
            if ((delegation.permissions & ~allowed) != 0) revert PrivilegeEscalation();

            delegatedPermissions[delegation.delegator][delegation.delegate] = delegation.permissions;
        }

        authorityModelVersion = AUTHORITY_MODEL_WIDENED_V1;
        emit WidenedAuthorityConfigured(
            widenedConfig.modelVersion, participants.length, delegations.length
        );
    }

    function _initializeMilestones(MilestoneConfig[] memory milestoneConfigs) internal {
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

    function _requireAction(address actor, AuthorityAction action, uint256) internal view {
        if (_isAuthorized(actor, action)) {
            return;
        }

        if (authorityModelVersion == AUTHORITY_MODEL_MVP) revert Unauthorized();
        revert UnauthorizedDelegateOrTopology();
    }

    function _payerForAction(address actor, AuthorityAction action) internal view returns (address) {
        if (action == AuthorityAction.Fund) {
            if (actor == dealConfig.buyer) {
                return actor;
            }

            if (_isAuthorizedForRole(actor, dealConfig.buyer, ParticipantRole.Buyer, action)) {
                return dealConfig.buyer;
            }
        }

        return actor;
    }

    function _isAuthorized(address actor, AuthorityAction action) internal view returns (bool) {
        if (action == AuthorityAction.Fund) {
            return _isAuthorizedForRole(actor, dealConfig.buyer, ParticipantRole.Buyer, action);
        }

        if (action == AuthorityAction.Submit) {
            return _isAuthorizedForRole(actor, dealConfig.seller, ParticipantRole.Seller, action);
        }

        if (action == AuthorityAction.Approve) {
            return _isAuthorizedForRole(actor, dealConfig.buyer, ParticipantRole.Buyer, action);
        }

        if (action == AuthorityAction.Claim) {
            return _isAuthorizedForRole(actor, dealConfig.seller, ParticipantRole.Seller, action);
        }

        if (action == AuthorityAction.Dispute) {
            return _isAuthorizedForRole(actor, dealConfig.buyer, ParticipantRole.Buyer, action);
        }

        if (action == AuthorityAction.Resolve) {
            return _isAuthorizedForRole(actor, dealConfig.arbiter, ParticipantRole.Arbiter, action);
        }

        if (action == AuthorityAction.Cancel) {
            bool buyerAuthorized =
                _isAuthorizedForRole(actor, dealConfig.buyer, ParticipantRole.Buyer, action);
            if (buyerAuthorized) {
                return true;
            }

            return _isAuthorizedForRole(actor, dealConfig.seller, ParticipantRole.Seller, action);
        }

        return false;
    }

    function _isAuthorizedForRole(
        address actor,
        address principal,
        ParticipantRole requiredRole,
        AuthorityAction action
    ) internal view returns (bool) {
        if (actor == principal) {
            return true;
        }

        if (authorityModelVersion != AUTHORITY_MODEL_WIDENED_V1) {
            return false;
        }

        if (!topologyActive[principal] || !topologyActive[actor]) {
            return false;
        }

        if (topologyRole[principal] != requiredRole) {
            return false;
        }

        uint32 permissionMask = delegatedPermissions[principal][actor];
        if (permissionMask == 0) {
            return false;
        }

        return (permissionMask & uint32(1 << uint8(action))) != 0;
    }

    function _allowedPermissionsForRole(ParticipantRole role) internal pure returns (uint32) {
        if (role == ParticipantRole.Buyer) {
            return uint32(1 << uint8(AuthorityAction.Fund))
                | uint32(1 << uint8(AuthorityAction.Approve))
                | uint32(1 << uint8(AuthorityAction.Dispute))
                | uint32(1 << uint8(AuthorityAction.Cancel));
        }

        if (role == ParticipantRole.Seller) {
            return uint32(1 << uint8(AuthorityAction.Submit))
                | uint32(1 << uint8(AuthorityAction.Claim))
                | uint32(1 << uint8(AuthorityAction.Cancel));
        }

        if (role == ParticipantRole.Arbiter) {
            return uint32(1 << uint8(AuthorityAction.Resolve));
        }

        return 0;
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

    function _finalizeMilestone(Milestone storage milestone, MilestoneStatus terminalStatus)
        internal
    {
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
