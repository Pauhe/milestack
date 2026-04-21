// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import { DealConfig, Milestone, MilestoneConfig, MilestoneStatus } from "src/MilestackTypes.sol";
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

    function fundCurrent() external {
        uint256 index = escrow.currentMilestoneIndex();

        vm.prank(BUYER);
        try escrow.fundMilestone(index) { } catch { }

        _syncMaxIndex();
    }

    function submitCurrent(bytes32 evidenceHash) external {
        uint256 index = escrow.currentMilestoneIndex();
        bytes32 nonZeroEvidence = evidenceHash == bytes32(0) ? bytes32(uint256(1)) : evidenceHash;

        vm.prank(SELLER);
        try escrow.submitMilestone(index, nonZeroEvidence) { } catch { }

        _syncMaxIndex();
    }

    function approveCurrent() external {
        uint256 index = escrow.currentMilestoneIndex();

        vm.prank(BUYER);
        try escrow.approveMilestone(index) { } catch { }

        _syncMaxIndex();
    }

    function warpAfterDeadline() external {
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

    function claimCurrent() external {
        uint256 index = escrow.currentMilestoneIndex();

        vm.prank(SELLER);
        try escrow.claimAfterReviewWindow(index) { } catch { }

        _syncMaxIndex();
    }

    function openDispute(bytes32 disputeHash) external {
        uint256 index = escrow.currentMilestoneIndex();
        bytes32 nonZeroDispute = disputeHash == bytes32(0) ? bytes32(uint256(2)) : disputeHash;

        vm.prank(BUYER);
        try escrow.openDispute(index, nonZeroDispute) { } catch { }

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

    function invariantFundConservation() public view {
        MilestoneEscrow escrow = handler.escrow();
        MockERC20 token = handler.token();

        uint256 distributedAndHeld = token.balanceOf(address(escrow))
            + escrow.totalReleasedToSeller() + escrow.totalRefundedToBuyer()
            + escrow.totalFeesCollected();

        assertEq(distributedAndHeld, escrow.totalFunded());
    }

    function invariantActiveDisputeMatchesMilestoneState() public view {
        MilestoneEscrow escrow = handler.escrow();
        uint256 disputeIndex = escrow.activeDisputeMilestoneId();

        if (disputeIndex == type(uint256).max) {
            return;
        }

        Milestone memory milestone = escrow.getMilestone(disputeIndex);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Disputed));
        assertEq(disputeIndex, escrow.currentMilestoneIndex());
    }

    function invariantCurrentMilestoneIndexNeverMovesBackward() public view {
        assertLe(handler.escrow().currentMilestoneIndex(), handler.escrow().milestoneCount() - 1);
        assertEq(handler.escrow().currentMilestoneIndex(), handler.maxObservedIndex());
    }
}
