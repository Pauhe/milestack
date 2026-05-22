// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import {
    DealConfig,
    DelegatedAuthority,
    Milestone,
    MilestoneConfig,
    MilestoneStatus,
    TopologyParticipant,
    WidenedAuthorityConfig
} from "src/MilestackTypes.sol";
import { InvalidMilestoneState } from "src/MilestackErrors.sol";
import { MockERC20 } from "test/mocks/MockERC20.sol";

contract MilestoneEscrowFuzzTest is Test {
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);

    bytes32 internal constant EVIDENCE_HASH = keccak256("fuzz-evidence");
    bytes32 internal constant DISPUTE_HASH = keccak256("fuzz-dispute");
    bytes32 internal constant SECOND_EVIDENCE_HASH = keccak256("fuzz-evidence-2");
    bytes32 internal constant SECOND_DISPUTE_HASH = keccak256("fuzz-dispute-2");

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

    function testFuzzMultiMilestoneFundAllThenSequentialApproveAccounting(
        uint96 rawAmount0,
        uint96 rawAmount1,
        uint32 rawReviewWindow,
        uint16 rawFeeBps
    ) public {
        uint256 amount0 = bound(uint256(rawAmount0), 1, 1_000_000_000_000e6);
        uint256 amount1 = bound(uint256(rawAmount1), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));
        uint16 feeBps = uint16(bound(uint256(rawFeeBps), 0, 2_000));

        uint256 totalAmount = amount0 + amount1;

        (MockERC20 token, MilestoneEscrow escrow) = _deployTwoMilestoneEscrowWithFunding(
            amount0, amount1, reviewWindow, feeBps, totalAmount
        );

        vm.prank(BUYER);
        escrow.fundAllMilestones();

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.approveMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(1, SECOND_EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.approveMilestone(1);

        uint256 fee0 = (amount0 * feeBps) / 10_000;
        uint256 fee1 = (amount1 * feeBps) / 10_000;
        uint256 sellerNet0 = amount0 - fee0;
        uint256 sellerNet1 = amount1 - fee1;
        uint256 totalFees = fee0 + fee1;
        uint256 totalSellerNet = sellerNet0 + sellerNet1;

        Milestone memory milestone0 = escrow.getMilestone(0);
        Milestone memory milestone1 = escrow.getMilestone(1);

        assertEq(uint256(milestone0.status), uint256(MilestoneStatus.PaidOut));
        assertEq(uint256(milestone1.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone0.sellerAward, sellerNet0);
        assertEq(milestone1.sellerAward, sellerNet1);
        assertEq(escrow.totalFunded(), totalAmount);
        assertEq(escrow.totalReleasedToSeller(), totalSellerNet);
        assertEq(escrow.totalRefundedToBuyer(), 0);
        assertEq(escrow.totalFeesCollected(), totalFees);
        assertEq(token.balanceOf(SELLER), totalSellerNet);
        assertEq(token.balanceOf(FEE_RECIPIENT), totalFees);
        assertEq(token.balanceOf(BUYER), 0);
        _assertEscrowConservation(token, escrow);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzzMultiMilestoneApproveThenClaimAfterReviewWindowAccounting(
        uint96 rawAmount0,
        uint96 rawAmount1,
        uint32 rawReviewWindow,
        uint16 rawFeeBps
    ) public {
        uint256 amount0 = bound(uint256(rawAmount0), 1, 1_000_000_000_000e6);
        uint256 amount1 = bound(uint256(rawAmount1), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));
        uint16 feeBps = uint16(bound(uint256(rawFeeBps), 0, 2_000));

        uint256 totalAmount = amount0 + amount1;

        (MockERC20 token, MilestoneEscrow escrow) = _deployTwoMilestoneEscrowWithFunding(
            amount0, amount1, reviewWindow, feeBps, totalAmount
        );

        vm.prank(BUYER);
        escrow.fundAllMilestones();

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.approveMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(1, SECOND_EVIDENCE_HASH);

        Milestone memory submittedSecondMilestone = escrow.getMilestone(1);
        vm.warp(submittedSecondMilestone.reviewDeadline + 1);

        vm.prank(SELLER);
        escrow.claimAfterReviewWindow(1);

        uint256 fee0 = (amount0 * feeBps) / 10_000;
        uint256 fee1 = (amount1 * feeBps) / 10_000;
        uint256 sellerNet0 = amount0 - fee0;
        uint256 sellerNet1 = amount1 - fee1;
        uint256 totalFees = fee0 + fee1;
        uint256 totalSellerNet = sellerNet0 + sellerNet1;

        Milestone memory milestone0 = escrow.getMilestone(0);
        Milestone memory milestone1 = escrow.getMilestone(1);

        assertEq(uint256(milestone0.status), uint256(MilestoneStatus.PaidOut));
        assertEq(uint256(milestone1.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone0.sellerAward, sellerNet0);
        assertEq(milestone1.sellerAward, sellerNet1);
        assertEq(escrow.totalFunded(), totalAmount);
        assertEq(escrow.totalReleasedToSeller(), totalSellerNet);
        assertEq(escrow.totalRefundedToBuyer(), 0);
        assertEq(escrow.totalFeesCollected(), totalFees);
        assertEq(token.balanceOf(SELLER), totalSellerNet);
        assertEq(token.balanceOf(FEE_RECIPIENT), totalFees);
        assertEq(token.balanceOf(BUYER), 0);
        _assertEscrowConservation(token, escrow);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzzMultiMilestoneDisputeThenCancelRemainingAccounting(
        uint96 rawAmount0,
        uint96 rawAmount1,
        uint32 rawReviewWindow,
        uint16 rawFeeBps,
        uint16 rawSellerShareBps
    ) public {
        uint256 amount0 = bound(uint256(rawAmount0), 1, 1_000_000_000_000e6);
        uint256 amount1 = bound(uint256(rawAmount1), 1, 1_000_000_000_000e6);
        uint32 reviewWindow = uint32(bound(uint256(rawReviewWindow), 1, 30 days));
        uint16 feeBps = uint16(bound(uint256(rawFeeBps), 0, 2_000));

        uint256 sellerGrossAmount0 =
            (amount0 * bound(uint256(rawSellerShareBps), 0, 10_000)) / 10_000;
        uint256 buyerAmount0 = amount0 - sellerGrossAmount0;

        (MockERC20 token, MilestoneEscrow escrow) =
            _deployTwoMilestoneEscrowWithFunding(amount0, amount1, reviewWindow, feeBps, amount0);

        vm.prank(BUYER);
        escrow.fundMilestone(0);

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        escrow.resolveDispute(0, buyerAmount0, sellerGrossAmount0);

        vm.prank(BUYER);
        escrow.cancelUnfundedMilestones();

        uint256 fee0 = (sellerGrossAmount0 * feeBps) / 10_000;
        uint256 sellerNet0 = sellerGrossAmount0 - fee0;

        Milestone memory milestone0 = escrow.getMilestone(0);
        Milestone memory milestone1 = escrow.getMilestone(1);

        assertEq(milestone0.buyerAward, buyerAmount0);
        assertEq(milestone0.sellerAward, sellerGrossAmount0);
        assertEq(escrow.totalFunded(), amount0);
        assertEq(escrow.totalReleasedToSeller(), sellerNet0);
        assertEq(escrow.totalRefundedToBuyer(), buyerAmount0);
        assertEq(escrow.totalFeesCollected(), fee0);
        assertEq(token.balanceOf(BUYER), buyerAmount0);
        assertEq(token.balanceOf(SELLER), sellerNet0);
        assertEq(token.balanceOf(FEE_RECIPIENT), fee0);

        if (sellerGrossAmount0 == 0) {
            assertEq(uint256(milestone0.status), uint256(MilestoneStatus.Refunded));
        } else {
            assertEq(uint256(milestone0.status), uint256(MilestoneStatus.PaidOut));
        }

        assertEq(uint256(milestone1.status), uint256(MilestoneStatus.Cancelled));

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.fundMilestone(1);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.fundAllMilestones();

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.submitMilestone(1, SECOND_EVIDENCE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.openDispute(1, SECOND_DISPUTE_HASH);

        _assertEscrowConservation(token, escrow);
        assertEq(token.balanceOf(address(escrow)), 0);
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

        escrow = new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());

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

        escrow = new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());
    }

    function _deployTwoMilestoneEscrowWithFunding(
        uint256 amount0,
        uint256 amount1,
        uint32 reviewWindow,
        uint16 feeBps,
        uint256 mintAmount
    ) internal returns (MockERC20 token, MilestoneEscrow escrow) {
        (token, escrow) = _deployTwoMilestoneEscrow(amount0, amount1, reviewWindow, feeBps);

        token.mint(BUYER, mintAmount);
        vm.prank(BUYER);
        token.approve(address(escrow), type(uint256).max);
    }

    function _assertEscrowConservation(MockERC20 token, MilestoneEscrow escrow) internal view {
        uint256 distributedAndHeld = token.balanceOf(address(escrow))
            + escrow.totalReleasedToSeller() + escrow.totalRefundedToBuyer()
            + escrow.totalFeesCollected();

        assertEq(distributedAndHeld, escrow.totalFunded());
    }

    function _mvpWidenedConfig() internal pure returns (WidenedAuthorityConfig memory config) {
        TopologyParticipant[] memory participants = new TopologyParticipant[](0);
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](0);
        config = WidenedAuthorityConfig({
            modelVersion: 0, participants: participants, delegations: delegations
        });
    }
}
