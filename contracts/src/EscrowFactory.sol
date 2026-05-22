// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {
    AUTHORITY_MODEL_WIDENED_V1,
    AuthorityAction,
    DealConfig,
    DelegatedAuthority,
    MilestoneConfig,
    ParticipantRole,
    TopologyParticipant,
    WidenedAuthorityConfig
} from "./MilestackTypes.sol";
import {
    ZeroAddress,
    InvalidPartyConfiguration,
    InvalidMilestoneCount,
    InvalidMilestoneAmount,
    InvalidReviewWindow,
    InvalidFeeBps,
    InvalidMetadataHash,
    Unauthorized,
    CreationPaused,
    InvalidAuthorityModelVersion,
    InvalidTopologyParticipant,
    InvalidParticipantRole,
    DuplicateTopologyParticipant,
    InvalidDelegatedAuthority,
    DuplicateDelegation,
    SelfDelegation,
    PrivilegeEscalation
} from "./MilestackErrors.sol";
import "./MilestackEvents.sol";
import { MilestoneEscrow } from "./MilestoneEscrow.sol";

contract EscrowFactory {
    address public immutable usdc;
    address public immutable feeRecipient;
    uint16 public immutable protocolFeeBps;

    address public immutable owner;
    bool public creationPaused;

    constructor(address usdc_, address feeRecipient_, uint16 protocolFeeBps_) {
        if (usdc_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (protocolFeeBps_ > 10_000) revert InvalidFeeBps();

        usdc = usdc_;
        feeRecipient = feeRecipient_;
        protocolFeeBps = protocolFeeBps_;
        owner = msg.sender;
    }

    function pauseCreation() external {
        if (msg.sender != owner) revert Unauthorized();
        creationPaused = true;
    }

    function unpauseCreation() external {
        if (msg.sender != owner) revert Unauthorized();
        creationPaused = false;
    }

    function createEscrow(
        address buyer,
        address seller,
        address arbiter,
        bytes32 metadataHash,
        MilestoneConfig[] calldata milestones
    ) external returns (address escrow) {
        _validateCoreInputs(buyer, seller, arbiter, metadataHash, milestones);

        DealConfig memory config = DealConfig({
            buyer: buyer,
            seller: seller,
            arbiter: arbiter,
            token: usdc,
            feeRecipient: feeRecipient,
            protocolFeeBps: protocolFeeBps,
            metadataHash: metadataHash
        });

        MilestoneEscrow deployed = new MilestoneEscrow(config, milestones, _emptyWidenedConfig());
        escrow = address(deployed);

        emit EscrowCreated(escrow, buyer, seller, arbiter, usdc, milestones.length, metadataHash);
    }

    function createEscrowWidened(
        address buyer,
        address seller,
        address arbiter,
        bytes32 metadataHash,
        MilestoneConfig[] calldata milestones,
        WidenedAuthorityConfig calldata widenedConfig
    ) external returns (address escrow) {
        _validateCoreInputs(buyer, seller, arbiter, metadataHash, milestones);
        _validateWidenedConfig(buyer, seller, arbiter, widenedConfig);

        DealConfig memory config = DealConfig({
            buyer: buyer,
            seller: seller,
            arbiter: arbiter,
            token: usdc,
            feeRecipient: feeRecipient,
            protocolFeeBps: protocolFeeBps,
            metadataHash: metadataHash
        });

        MilestoneEscrow deployed = new MilestoneEscrow(config, milestones, widenedConfig);
        escrow = address(deployed);

        emit EscrowCreated(escrow, buyer, seller, arbiter, usdc, milestones.length, metadataHash);
        emit EscrowCreatedWidened(
            escrow,
            widenedConfig.modelVersion,
            widenedConfig.participants.length,
            widenedConfig.delegations.length
        );
    }

    function _validateCoreInputs(
        address buyer,
        address seller,
        address arbiter,
        bytes32 metadataHash,
        MilestoneConfig[] calldata milestones
    ) internal view {
        if (creationPaused) revert CreationPaused();
        if (buyer == address(0) || seller == address(0) || arbiter == address(0)) {
            revert ZeroAddress();
        }
        if (buyer == seller || buyer == arbiter || seller == arbiter) {
            revert InvalidPartyConfiguration();
        }
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (milestones.length == 0) revert InvalidMilestoneCount();

        for (uint256 i = 0; i < milestones.length; i++) {
            if (milestones[i].amount == 0) revert InvalidMilestoneAmount();
            if (milestones[i].reviewWindowSeconds == 0) revert InvalidReviewWindow();
        }
    }

    function _validateWidenedConfig(
        address buyer,
        address seller,
        address arbiter,
        WidenedAuthorityConfig calldata widenedConfig
    ) internal pure {
        if (widenedConfig.modelVersion != AUTHORITY_MODEL_WIDENED_V1) {
            revert InvalidAuthorityModelVersion();
        }

        bool hasBuyer;
        bool hasSeller;
        bool hasArbiter;

        TopologyParticipant[] calldata participants = widenedConfig.participants;

        for (uint256 i = 0; i < participants.length; i++) {
            TopologyParticipant calldata participant = participants[i];
            if (participant.account == address(0)) revert InvalidTopologyParticipant();
            if (participant.role == ParticipantRole.None) revert InvalidParticipantRole();

            for (uint256 j = 0; j < i; j++) {
                if (participants[j].account == participant.account) {
                    revert DuplicateTopologyParticipant();
                }
            }

            if (participant.account == buyer) {
                if (participant.role != ParticipantRole.Buyer || !participant.active) {
                    revert InvalidPartyConfiguration();
                }
                hasBuyer = true;
            }

            if (participant.account == seller) {
                if (participant.role != ParticipantRole.Seller || !participant.active) {
                    revert InvalidPartyConfiguration();
                }
                hasSeller = true;
            }

            if (participant.account == arbiter) {
                if (participant.role != ParticipantRole.Arbiter || !participant.active) {
                    revert InvalidPartyConfiguration();
                }
                hasArbiter = true;
            }
        }

        if (!hasBuyer || !hasSeller || !hasArbiter) revert InvalidPartyConfiguration();

        DelegatedAuthority[] calldata delegations = widenedConfig.delegations;

        for (uint256 i = 0; i < delegations.length; i++) {
            DelegatedAuthority calldata delegation = delegations[i];

            if (delegation.delegator == address(0) || delegation.delegate == address(0)) {
                revert InvalidDelegatedAuthority();
            }
            if (delegation.delegator == delegation.delegate) revert SelfDelegation();
            if (delegation.permissions == 0 || !delegation.active) {
                revert InvalidDelegatedAuthority();
            }

            for (uint256 j = 0; j < i; j++) {
                if (
                    delegations[j].delegator == delegation.delegator
                        && delegations[j].delegate == delegation.delegate
                ) {
                    revert DuplicateDelegation();
                }
            }

            ParticipantRole delegatorRole = _findRole(participants, delegation.delegator);
            if (delegatorRole == ParticipantRole.None) revert InvalidDelegatedAuthority();
            if (!_findActive(participants, delegation.delegator)) {
                revert InvalidDelegatedAuthority();
            }
            if (!_findActive(participants, delegation.delegate)) {
                revert InvalidDelegatedAuthority();
            }

            uint32 allowed = _allowedPermissionsForRole(delegatorRole);
            if (allowed == 0 || (delegation.permissions & ~allowed) != 0) {
                revert PrivilegeEscalation();
            }
        }
    }

    function _emptyWidenedConfig() internal pure returns (WidenedAuthorityConfig memory config) {
        TopologyParticipant[] memory participants = new TopologyParticipant[](0);
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](0);

        config = WidenedAuthorityConfig({
            modelVersion: 0, participants: participants, delegations: delegations
        });
    }

    function _findRole(TopologyParticipant[] calldata participants, address account)
        internal
        pure
        returns (ParticipantRole)
    {
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i].account == account) {
                return participants[i].role;
            }
        }

        return ParticipantRole.None;
    }

    function _findActive(TopologyParticipant[] calldata participants, address account)
        internal
        pure
        returns (bool)
    {
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i].account == account) {
                return participants[i].active;
            }
        }

        return false;
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
}
