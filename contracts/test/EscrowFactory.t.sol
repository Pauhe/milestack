// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { EscrowFactory } from "src/EscrowFactory.sol";
import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import { DealStatus, Milestone, MilestoneConfig, MilestoneStatus } from "src/MilestackTypes.sol";
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
} from "src/MilestackErrors.sol";

contract EscrowFactoryTest is Test {
    address internal constant USDC = address(0x1001);
    address internal constant FEE_RECIPIENT = address(0x1002);
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);

    bytes32 internal constant METADATA_HASH = keccak256("deal-metadata");

    EscrowFactory internal factory;

    function setUp() public {
        factory = new EscrowFactory(USDC, FEE_RECIPIENT, 100);
    }

    function testConstructorStoresImmutableConfig() public view {
        assertEq(factory.usdc(), USDC);
        assertEq(factory.feeRecipient(), FEE_RECIPIENT);
        assertEq(factory.protocolFeeBps(), 100);
        assertFalse(factory.creationPaused());
    }

    function testConstructorRejectsZeroAddresses() public {
        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector));
        new EscrowFactory(address(0), FEE_RECIPIENT, 100);

        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector));
        new EscrowFactory(USDC, address(0), 100);
    }

    function testConstructorRejectsInvalidFeeBps() public {
        vm.expectRevert(abi.encodeWithSelector(InvalidFeeBps.selector));
        new EscrowFactory(USDC, FEE_RECIPIENT, 10_001);
    }

    function testOwnerCanPauseAndUnpauseCreation() public {
        factory.pauseCreation();
        assertTrue(factory.creationPaused());

        factory.unpauseCreation();
        assertFalse(factory.creationPaused());
    }

    function testNonOwnerCannotPauseOrUnpauseCreation() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        factory.pauseCreation();

        factory.pauseCreation();

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        factory.unpauseCreation();
    }

    function testCreateEscrowRevertsWhenCreationPaused() public {
        factory.pauseCreation();

        vm.expectRevert(abi.encodeWithSelector(CreationPaused.selector));
        factory.createEscrow(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones());
    }

    function testCreateEscrowRejectsZeroPartyAddresses() public {
        MilestoneConfig[] memory milestones = _milestones();

        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector));
        factory.createEscrow(address(0), SELLER, ARBITER, METADATA_HASH, milestones);

        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector));
        factory.createEscrow(BUYER, address(0), ARBITER, METADATA_HASH, milestones);

        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector));
        factory.createEscrow(BUYER, SELLER, address(0), METADATA_HASH, milestones);
    }

    function testCreateEscrowRejectsDuplicateParties() public {
        MilestoneConfig[] memory milestones = _milestones();

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        factory.createEscrow(BUYER, BUYER, ARBITER, METADATA_HASH, milestones);

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        factory.createEscrow(BUYER, SELLER, BUYER, METADATA_HASH, milestones);

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        factory.createEscrow(BUYER, SELLER, SELLER, METADATA_HASH, milestones);
    }

    function testCreateEscrowRejectsEmptyMetadataHash() public {
        vm.expectRevert(abi.encodeWithSelector(InvalidMetadataHash.selector));
        factory.createEscrow(BUYER, SELLER, ARBITER, bytes32(0), _milestones());
    }

    function testCreateEscrowRejectsEmptyMilestones() public {
        MilestoneConfig[] memory milestones = new MilestoneConfig[](0);

        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneCount.selector));
        factory.createEscrow(BUYER, SELLER, ARBITER, METADATA_HASH, milestones);
    }

    function testCreateEscrowRejectsZeroMilestoneAmount() public {
        MilestoneConfig[] memory milestones = new MilestoneConfig[](1);
        milestones[0] = MilestoneConfig({ amount: 0, reviewWindowSeconds: 5 days });

        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneAmount.selector));
        factory.createEscrow(BUYER, SELLER, ARBITER, METADATA_HASH, milestones);
    }

    function testCreateEscrowRejectsZeroReviewWindow() public {
        MilestoneConfig[] memory milestones = new MilestoneConfig[](1);
        milestones[0] = MilestoneConfig({ amount: 1 ether, reviewWindowSeconds: 0 });

        vm.expectRevert(abi.encodeWithSelector(InvalidReviewWindow.selector));
        factory.createEscrow(BUYER, SELLER, ARBITER, METADATA_HASH, milestones);
    }

    function testCreateEscrowDeploysEscrowWithExpectedInitialState() public {
        address escrowAddress =
            factory.createEscrow(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones());

        MilestoneEscrow escrow = MilestoneEscrow(escrowAddress);

        assertEq(escrow.buyer(), BUYER);
        assertEq(escrow.seller(), SELLER);
        assertEq(escrow.arbiter(), ARBITER);
        assertEq(escrow.token(), USDC);
        assertEq(escrow.feeRecipient(), FEE_RECIPIENT);
        assertEq(escrow.protocolFeeBps(), 100);
        assertEq(uint256(escrow.dealStatus()), uint256(DealStatus.Draft));
        assertEq(escrow.currentMilestoneIndex(), 0);
        assertEq(escrow.activeDisputeMilestoneId(), type(uint256).max);
        assertEq(escrow.milestoneCount(), 2);

        Milestone memory milestone0 = escrow.getMilestone(0);
        Milestone memory milestone1 = escrow.getMilestone(1);

        assertEq(milestone0.amount, 1_000e6);
        assertEq(uint256(milestone0.status), uint256(MilestoneStatus.PendingFunding));
        assertEq(milestone1.amount, 2_000e6);
        assertEq(uint256(milestone1.status), uint256(MilestoneStatus.PendingFunding));
    }

    function _milestones() internal pure returns (MilestoneConfig[] memory milestones) {
        milestones = new MilestoneConfig[](2);
        milestones[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });
        milestones[1] = MilestoneConfig({ amount: 2_000e6, reviewWindowSeconds: 5 days });
    }
}
