// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import { DealConfig, DealStatus, Milestone, MilestoneConfig, MilestoneStatus } from "src/MilestackTypes.sol";
import { MockERC20 } from "test/mocks/MockERC20.sol";

contract MilestoneEscrowHandler is Test {
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);

    MockERC20 public token;
    MilestoneEscrow public escrow;
    uint256 public maxObservedIndex;

    constructor() {
        token = new MockERC20();

        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("invariant-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](2);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });
        milestoneConfigs[1] = MilestoneConfig({ amount: 2_000e6, reviewWindowSeconds: 3 days });

        escrow = new MilestoneEscrow(config, milestoneConfigs);

        token.mint(BUYER, 10_000e6);
        vm.prank(BUYER);
        token.approve(address(escrow), type(uint256).max);

        _syncMaxIndex();
    }

    function fundArbitrary(uint256 rawMilestoneId) external {
        vm.prank(BUYER);
        try escrow.fundMilestone(_deriveMilestoneId(rawMilestoneId)) { } catch { }

        _syncMaxIndex();
    }

    function submitArbitrary(uint256 rawMilestoneId, bytes32 evidenceHash) external {
        bytes32 nonZeroEvidence = evidenceHash == bytes32(0) ? bytes32(uint256(1)) : evidenceHash;

        vm.prank(SELLER);
        try escrow.submitMilestone(_deriveMilestoneId(rawMilestoneId), nonZeroEvidence) { } catch { }

        _syncMaxIndex();
    }

    function approveArbitrary(uint256 rawMilestoneId) external {
        vm.prank(BUYER);
        try escrow.approveMilestone(_deriveMilestoneId(rawMilestoneId)) { } catch { }

        _syncMaxIndex();
    }

    function warpAfterCurrentDeadline() external {
        uint256 index = escrow.currentMilestoneIndex();

        if (index >= escrow.milestoneCount()) {
            vm.warp(block.timestamp + 1 days);
            return;
        }

        Milestone memory milestone = escrow.getMilestone(index);
        if (milestone.reviewDeadline > 0) {
            vm.warp(milestone.reviewDeadline + 1);
        } else {
            vm.warp(block.timestamp + 1 days);
        }
    }

    function claimArbitrary(uint256 rawMilestoneId) external {
        vm.prank(SELLER);
        try escrow.claimAfterReviewWindow(_deriveMilestoneId(rawMilestoneId)) { } catch { }

        _syncMaxIndex();
    }

    function openDisputeArbitrary(uint256 rawMilestoneId, bytes32 disputeHash) external {
        bytes32 nonZeroDispute = disputeHash == bytes32(0) ? bytes32(uint256(2)) : disputeHash;

        vm.prank(BUYER);
        try escrow.openDispute(_deriveMilestoneId(rawMilestoneId), nonZeroDispute) { } catch { }

        _syncMaxIndex();
    }

    function resolveDispute(uint16 sellerShareBps) external {
        uint256 disputeIndex = escrow.activeDisputeMilestoneId();
        if (disputeIndex == type(uint256).max) return;

        Milestone memory milestone = escrow.getMilestone(disputeIndex);
        uint256 sellerAmount = (milestone.amount * sellerShareBps) / 10_000;
        uint256 buyerAmount = milestone.amount - sellerAmount;

        vm.prank(ARBITER);
        try escrow.resolveDispute(disputeIndex, buyerAmount, sellerAmount) { } catch { }

        _syncMaxIndex();
    }

    function cancelRemaining() external {
        vm.prank(BUYER);
        try escrow.cancelUnfundedMilestones() { } catch { }

        _syncMaxIndex();
    }

    function _deriveMilestoneId(uint256 rawMilestoneId) internal view returns (uint256) {
        uint256 milestoneCount = escrow.milestoneCount();
        if (milestoneCount == 0) return 0;

        return rawMilestoneId % (milestoneCount + 1);
    }

    function _syncMaxIndex() internal {
        uint256 currentIndex = escrow.currentMilestoneIndex();
        if (currentIndex > maxObservedIndex) {
            maxObservedIndex = currentIndex;
        }
    }
}

contract MilestoneEscrowInvariantTest is StdInvariant, Test {
    MilestoneEscrowHandler internal handler;

    function setUp() public {
        handler = new MilestoneEscrowHandler();
        targetContract(address(handler));
    }

    function invariantEscrowBalanceConservesFundsAcrossAllOutcomes() public view {
        MilestoneEscrow escrow = handler.escrow();
        MockERC20 token = handler.token();

        uint256 distributedAndHeld = token.balanceOf(address(escrow)) + escrow.totalReleasedToSeller()
            + escrow.totalRefundedToBuyer() + escrow.totalFeesCollected();

        assertEq(distributedAndHeld, escrow.totalFunded());
    }

    function invariantAtMostOneActiveDisputeAndPointerMatchesIt() public view {
        MilestoneEscrow escrow = handler.escrow();
        uint256 disputeIndex = escrow.activeDisputeMilestoneId();
        uint256 disputeCount;

        for (uint256 i = 0; i < escrow.milestoneCount(); i++) {
            Milestone memory milestone = escrow.getMilestone(i);
            if (milestone.status == MilestoneStatus.Disputed) {
                disputeCount++;
                assertEq(i, disputeIndex, "active dispute pointer must match disputed milestone index");
            }
        }

        assertLe(disputeCount, 1, "multiple disputed milestones cannot coexist");

        if (disputeCount == 0) {
            assertEq(
                disputeIndex,
                type(uint256).max,
                "active dispute pointer must clear when no milestone is disputed"
            );
            return;
        }

        assertEq(disputeCount, 1, "active dispute pointer implies exactly one disputed milestone");
        assertEq(
            disputeIndex,
            escrow.currentMilestoneIndex(),
            "disputed milestone must stay at the current index"
        );
    }

    function invariantPriorMilestonesNeverRegressFromTerminalStatuses() public view {
        MilestoneEscrow escrow = handler.escrow();
        uint256 currentIndex = escrow.currentMilestoneIndex();
        uint256 milestoneCount = escrow.milestoneCount();

        assertLe(currentIndex, milestoneCount - 1, "current index must stay within milestone bounds");
        assertEq(currentIndex, handler.maxObservedIndex(), "current index must never move backward");

        for (uint256 i = 0; i < currentIndex; i++) {
            MilestoneStatus status = escrow.getMilestone(i).status;
            assertTrue(
                status == MilestoneStatus.PaidOut || status == MilestoneStatus.Refunded,
                "milestones before current index must remain terminal paid/refunded"
            );
        }
    }

    function invariantCompletedDealHasCleanTerminalState() public view {
        MilestoneEscrow escrow = handler.escrow();
        if (escrow.dealStatus() != DealStatus.Completed) return;

        uint256 milestoneCount = escrow.milestoneCount();
        uint256 lastMilestoneIndex = milestoneCount - 1;

        assertEq(
            escrow.currentMilestoneIndex(),
            lastMilestoneIndex,
            "completed deal must point at final milestone index"
        );
        assertEq(
            escrow.activeDisputeMilestoneId(),
            type(uint256).max,
            "completed deal cannot retain an active dispute"
        );

        for (uint256 i = 0; i < milestoneCount; i++) {
            MilestoneStatus status = escrow.getMilestone(i).status;
            assertTrue(
                status == MilestoneStatus.PaidOut || status == MilestoneStatus.Refunded,
                "completed deal milestones must be terminal paid/refunded"
            );
        }

        assertEq(
            handler.token().balanceOf(address(escrow)),
            0,
            "completed deal must not retain escrow token balance"
        );
    }

    function invariantCancelledDealHasOnlyTerminalOrUnsettleableMilestones() public view {
        MilestoneEscrow escrow = handler.escrow();
        if (escrow.dealStatus() != DealStatus.Cancelled) return;

        uint256 milestoneCount = escrow.milestoneCount();

        assertEq(
            escrow.activeDisputeMilestoneId(),
            type(uint256).max,
            "cancelled deal cannot retain an active dispute"
        );

        for (uint256 i = 0; i < milestoneCount; i++) {
            MilestoneStatus status = escrow.getMilestone(i).status;
            assertTrue(
                status == MilestoneStatus.PaidOut || status == MilestoneStatus.Refunded
                    || status == MilestoneStatus.Cancelled,
                "cancelled deals may only contain settled or cancelled milestones"
            );
        }
    }
}
