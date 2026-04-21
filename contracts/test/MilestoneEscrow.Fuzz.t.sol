// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import { DealConfig, Milestone, MilestoneConfig, MilestoneStatus } from "src/MilestackTypes.sol";
import { InvalidMilestoneState } from "src/MilestackErrors.sol";
import { MockERC20 } from "test/mocks/MockERC20.sol";

contract MilestoneEscrowFuzzTest is Test {
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);

    bytes32 internal constant EVIDENCE_HASH = keccak256("fuzz-evidence");
    bytes32 internal constant DISPUTE_HASH = keccak256("fuzz-dispute");

    function testFuzzApprovePayoutAccounting(
        uint96 rawAmount,
        uint32 rawReviewWindow,
        uint16 rawFeeBps
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));
        uint16 feeBps = uint16(bound(uint256(rawFeeBps), 0, 2_000));

        (MockERC20 token, MilestoneEscrow escrow) =
            _deploySingleMilestoneEscrow(amount, reviewWindow, feeBps);

        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.approveMilestone(0);

        uint256 feeAmount = (amount * feeBps) / 10_000;
        uint256 sellerNetAmount = amount - feeAmount;
        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone.sellerAward, sellerNetAmount);
        assertEq(escrow.totalReleasedToSeller(), sellerNetAmount);
        assertEq(escrow.totalFeesCollected(), feeAmount);
        assertEq(token.balanceOf(SELLER), sellerNetAmount);
        assertEq(token.balanceOf(FEE_RECIPIENT), feeAmount);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzzClaimPayoutAccounting(
        uint96 rawAmount,
        uint32 rawReviewWindow,
        uint16 rawFeeBps
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));
        uint16 feeBps = uint16(bound(uint256(rawFeeBps), 0, 2_000));

        (MockERC20 token, MilestoneEscrow escrow) =
            _deploySingleMilestoneEscrow(amount, reviewWindow, feeBps);

        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.prank(SELLER);
        escrow.claimAfterReviewWindow(0);

        uint256 feeAmount = (amount * feeBps) / 10_000;
        uint256 sellerNetAmount = amount - feeAmount;
        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone.sellerAward, sellerNetAmount);
        assertEq(escrow.totalReleasedToSeller(), sellerNetAmount);
        assertEq(escrow.totalFeesCollected(), feeAmount);
        assertEq(token.balanceOf(SELLER), sellerNetAmount);
        assertEq(token.balanceOf(FEE_RECIPIENT), feeAmount);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzzResolveDisputeAccounting(
        uint96 rawAmount,
        uint32 rawReviewWindow,
        uint16 rawFeeBps,
        uint16 rawSellerShareBps
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));
        uint16 feeBps = uint16(bound(uint256(rawFeeBps), 0, 2_000));
        uint256 sellerGrossAmount = (amount * bound(uint256(rawSellerShareBps), 0, 10_000)) / 10_000;
        uint256 buyerAmount = amount - sellerGrossAmount;

        (MockERC20 token, MilestoneEscrow escrow) =
            _deploySingleMilestoneEscrow(amount, reviewWindow, feeBps);

        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        escrow.resolveDispute(0, buyerAmount, sellerGrossAmount);

        uint256 feeAmount = (sellerGrossAmount * feeBps) / 10_000;
        uint256 sellerNetAmount = sellerGrossAmount - feeAmount;
        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(milestone.buyerAward, buyerAmount);
        assertEq(milestone.sellerAward, sellerGrossAmount);
        assertEq(escrow.totalRefundedToBuyer(), buyerAmount);
        assertEq(escrow.totalReleasedToSeller(), sellerNetAmount);
        assertEq(escrow.totalFeesCollected(), feeAmount);
        assertEq(token.balanceOf(BUYER), amount - sellerGrossAmount);
        assertEq(token.balanceOf(SELLER), sellerNetAmount);
        assertEq(token.balanceOf(FEE_RECIPIENT), feeAmount);
        assertEq(token.balanceOf(address(escrow)), 0);

        if (sellerGrossAmount == 0) {
            assertEq(uint256(milestone.status), uint256(MilestoneStatus.Refunded));
        } else {
            assertEq(uint256(milestone.status), uint256(MilestoneStatus.PaidOut));
        }
    }

    function testFuzzPaidOutMilestoneRemainsTerminal(
        uint96 rawAmount,
        uint32 rawReviewWindow,
        uint16 rawFeeBps,
        bytes32 replacementEvidence,
        bytes32 disputeHash
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));
        uint16 feeBps = uint16(bound(uint256(rawFeeBps), 0, 2_000));

        (, MilestoneEscrow escrow) = _deploySingleMilestoneEscrow(amount, reviewWindow, feeBps);

        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.approveMilestone(0);

        bytes32 nonZeroEvidence =
            replacementEvidence == bytes32(0) ? bytes32(uint256(1)) : replacementEvidence;
        bytes32 nonZeroDisputeHash = disputeHash == bytes32(0) ? bytes32(uint256(2)) : disputeHash;

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.submitMilestone(0, nonZeroEvidence);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.approveMilestone(0);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.claimAfterReviewWindow(0);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.openDispute(0, nonZeroDisputeHash);

        assertEq(uint256(escrow.getMilestone(0).status), uint256(MilestoneStatus.PaidOut));
    }

    function testFuzzRefundedMilestoneRemainsTerminal(
        uint96 rawAmount,
        uint32 rawReviewWindow,
        bytes32 evidenceHash,
        bytes32 disputeHash
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));

        (, MilestoneEscrow escrow) = _deploySingleMilestoneEscrow(amount, reviewWindow, 100);

        bytes32 nonZeroEvidence = evidenceHash == bytes32(0) ? EVIDENCE_HASH : evidenceHash;
        bytes32 nonZeroDisputeHash = disputeHash == bytes32(0) ? DISPUTE_HASH : disputeHash;

        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(0, nonZeroEvidence);

        vm.prank(BUYER);
        escrow.openDispute(0, nonZeroDisputeHash);

        vm.prank(ARBITER);
        escrow.resolveDispute(0, amount, 0);

        vm.prank(BUYER);
        vm.expectRevert();
        escrow.resolveDispute(0, amount, 0);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.claimAfterReviewWindow(0);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.openDispute(0, nonZeroDisputeHash);

        assertEq(uint256(escrow.getMilestone(0).status), uint256(MilestoneStatus.Refunded));
    }

    function testCancelledMilestoneRemainsTerminal() public {
        (, MilestoneEscrow escrow) = _deployTwoMilestoneEscrow(1_000e6, 2_000e6, 5 days, 100);

        vm.prank(BUYER);
        escrow.cancelUnfundedMilestones();

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.fundMilestone(0);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.submitMilestone(0, EVIDENCE_HASH);

        assertEq(uint256(escrow.getMilestone(0).status), uint256(MilestoneStatus.Cancelled));
    }

    function _deploySingleMilestoneEscrow(uint256 amount, uint32 reviewWindow, uint16 feeBps)
        internal
        returns (MockERC20 token, MilestoneEscrow escrow)
    {
        token = new MockERC20();

        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: feeBps,
            metadataHash: keccak256("fuzz-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](1);
        milestoneConfigs[0] = MilestoneConfig({ amount: amount, reviewWindowSeconds: reviewWindow });

        escrow = new MilestoneEscrow(config, milestoneConfigs);

        token.mint(BUYER, amount);
        vm.prank(BUYER);
        token.approve(address(escrow), type(uint256).max);
    }

    function _deployTwoMilestoneEscrow(
        uint256 amount0,
        uint256 amount1,
        uint32 reviewWindow,
        uint16 feeBps
    ) internal returns (MockERC20 token, MilestoneEscrow escrow) {
        token = new MockERC20();

        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: feeBps,
            metadataHash: keccak256("fuzz-two-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](2);
        milestoneConfigs[0] =
            MilestoneConfig({ amount: amount0, reviewWindowSeconds: reviewWindow });
        milestoneConfigs[1] =
            MilestoneConfig({ amount: amount1, reviewWindowSeconds: reviewWindow });

        escrow = new MilestoneEscrow(config, milestoneConfigs);
    }
}
