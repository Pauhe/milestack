// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DealConfig, MilestoneConfig} from "./MilestackTypes.sol";
import {
    ZeroAddress,
    InvalidPartyConfiguration,
    InvalidMilestoneCount,
    InvalidMilestoneAmount,
    InvalidReviewWindow,
    InvalidFeeBps,
    InvalidMetadataHash,
    Unauthorized,
    CreationPaused
} from "./MilestackErrors.sol";
import "./MilestackEvents.sol";
import {MilestoneEscrow} from "./MilestoneEscrow.sol";

contract EscrowFactory {
    address public immutable usdc;
    address public immutable feeRecipient;
    uint16 public immutable protocolFeeBps;

    address public owner;
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

        DealConfig memory config = DealConfig({
            buyer: buyer,
            seller: seller,
            arbiter: arbiter,
            token: usdc,
            feeRecipient: feeRecipient,
            protocolFeeBps: protocolFeeBps,
            metadataHash: metadataHash
        });

        MilestoneEscrow deployed = new MilestoneEscrow(config, milestones);
        escrow = address(deployed);

        emit EscrowCreated(
            escrow,
            buyer,
            seller,
            arbiter,
            usdc,
            milestones.length,
            metadataHash
        );
    }
}
