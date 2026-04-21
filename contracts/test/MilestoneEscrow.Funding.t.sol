// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MilestoneEscrow} from "src/MilestoneEscrow.sol";
import {DealConfig, DealStatus, Milestone, MilestoneConfig, MilestoneStatus} from "src/MilestackTypes.sol";
import {
    Unauthorized,
    InvalidMilestoneState,
    InvalidMilestoneIndex,
    InvalidMilestoneSequence,
    ActiveDisputeExists
} from "src/MilestackErrors.sol";
import {MockERC20} from "test/mocks/MockERC20.sol";

contract MilestoneEscrowFundingTest is Test {
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);

    MockERC20 internal token;
    MilestoneEscrow internal escrow;

    function setUp() public {
        token = new MockERC20();

        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](2);
        milestoneConfigs[0] = MilestoneConfig({amount: 1_000e6, reviewWindowSeconds: 5 days});
        milestoneConfigs[1] = MilestoneConfig({amount: 2_000e6, reviewWindowSeconds: 5 days});

        escrow = new MilestoneEscrow(config, milestoneConfigs);

        token.mint(BUYER, 10_000e6);
        vm.prank(BUYER);
        token.approve(address(escrow), type(uint256).max);
    }

    function testBuyerCanFundCurrentMilestone() public {
        vm.prank(BUYER);
        escrow.fundMilestone(0);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(escrow.dealStatus()), uint256(DealStatus.Active));
        assertEq(escrow.totalFunded(), 1_000e6);
        assertEq(token.balanceOf(address(escrow)), 1_000e6);
        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Funded));
    }

    function testNonBuyerCannotFundMilestone() public {
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.fundMilestone(0);
    }

    function testCannotFundWrongMilestoneIndex() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneSequence.selector));
        escrow.fundMilestone(1);
    }

    function testCannotFundOutOfBoundsMilestone() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneIndex.selector));
        escrow.fundMilestone(2);
    }

    function testCannotFundAlreadyFundedMilestone() public {
        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.fundMilestone(0);
    }

    function testBuyerCanFundAllMilestones() public {
        vm.prank(BUYER);
        escrow.fundAllMilestones();

        Milestone memory milestone0 = escrow.getMilestone(0);
        Milestone memory milestone1 = escrow.getMilestone(1);

        assertEq(uint256(escrow.dealStatus()), uint256(DealStatus.Active));
        assertEq(escrow.totalFunded(), 3_000e6);
        assertEq(token.balanceOf(address(escrow)), 3_000e6);
        assertEq(uint256(milestone0.status), uint256(MilestoneStatus.Funded));
        assertEq(uint256(milestone1.status), uint256(MilestoneStatus.Funded));
    }

    function testNonBuyerCannotFundAllMilestones() public {
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.fundAllMilestones();
    }

    function testFundAllRevertsIfCurrentMilestoneAlreadyFunded() public {
        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.fundAllMilestones();
    }

    function testFundingRevertsIfActiveDisputeExists() public {
        vm.store(address(escrow), bytes32(uint256(8)), bytes32(uint256(0)));

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        escrow.fundMilestone(0);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        escrow.fundAllMilestones();
    }
}
