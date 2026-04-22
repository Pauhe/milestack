// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import {
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
} from "src/MilestackTypes.sol";
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
    NothingToCancel,
    InvalidAuthorityModelVersion,
    DuplicateTopologyParticipant,
    InvalidPartyConfiguration,
    InvalidDelegatedAuthority,
    DuplicateDelegation
} from "src/MilestackErrors.sol";
import { MockERC20 } from "test/mocks/MockERC20.sol";
import { MockFailingTransferERC20 } from "test/mocks/MockFailingTransferERC20.sol";
import { MilestoneClaimable } from "src/MilestackEvents.sol";

contract MilestoneEscrowInternalHarness is MilestoneEscrow {
    constructor(
        DealConfig memory config,
        MilestoneConfig[] memory milestoneConfigs,
        WidenedAuthorityConfig memory widenedConfig
    ) MilestoneEscrow(config, milestoneConfigs, widenedConfig) { }

    function exposedPayerForAction(address actor, AuthorityAction action) external view returns (address) {
        return _payerForAction(actor, action);
    }

    function exposedIsAuthorized(address actor, AuthorityAction action) external view returns (bool) {
        return _isAuthorized(actor, action);
    }

    function exposedIsAuthorizedForRole(
        address actor,
        address principal,
        ParticipantRole requiredRole,
        AuthorityAction action
    ) external view returns (bool) {
        return _isAuthorizedForRole(actor, principal, requiredRole, action);
    }

    function exposedAllowedPermissionsForRole(ParticipantRole role) external pure returns (uint32) {
        return _allowedPermissionsForRole(role);
    }
}

contract MilestoneEscrowSubmissionTest is Test {
    uint256 internal constant ACTIVE_DISPUTE_SLOT = 8;
    uint256 internal constant MILESTONES_SLOT = 17;
    uint256 internal constant MILESTONE_STORAGE_STRIDE = 6;

    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);

    bytes32 internal constant EVIDENCE_HASH = keccak256("milestone-evidence");
    bytes32 internal constant DISPUTE_HASH = keccak256("milestone-dispute");

    MockERC20 internal token;
    MilestoneEscrow internal escrow;

    function setUp() public {
        token = new MockERC20();

        escrow = _deployEscrow();

        token.mint(BUYER, 10_000e6);
        vm.prank(BUYER);
        token.approve(address(escrow), type(uint256).max);

        vm.prank(BUYER);
        escrow.fundMilestone(0);
    }

    function _deployEscrow() internal returns (MilestoneEscrow deployedEscrow) {
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
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });
        milestoneConfigs[1] = MilestoneConfig({ amount: 2_000e6, reviewWindowSeconds: 3 days });

        deployedEscrow = new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());
    }

    function _deploySingleMilestoneEscrow() internal returns (MilestoneEscrow deployedEscrow) {
        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("single-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](1);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });

        deployedEscrow = new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());
    }

    function _deployZeroFeeEscrow() internal returns (MilestoneEscrow deployedEscrow) {
        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 0,
            metadataHash: keccak256("zero-fee-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](1);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });

        deployedEscrow = new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());
    }

    function _baseDealConfig() internal view returns (DealConfig memory config) {
        config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("authority-config-deal")
        });
    }

    function _singleMilestoneConfig() internal pure returns (MilestoneConfig[] memory milestoneConfigs) {
        milestoneConfigs = new MilestoneConfig[](1);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });
    }

    function _widenedParticipants() internal pure returns (TopologyParticipant[] memory participants) {
        participants = new TopologyParticipant[](3);
        participants[0] = TopologyParticipant({ account: BUYER, role: ParticipantRole.Buyer, active: true });
        participants[1] = TopologyParticipant({ account: SELLER, role: ParticipantRole.Seller, active: true });
        participants[2] = TopologyParticipant({ account: ARBITER, role: ParticipantRole.Arbiter, active: true });
    }

    function _singleFundDelegation(address delegate)
        internal
        pure
        returns (DelegatedAuthority[] memory delegations)
    {
        delegations = new DelegatedAuthority[](1);
        delegations[0] = DelegatedAuthority({
            delegator: BUYER,
            delegate: delegate,
            permissions: uint32(1 << uint8(AuthorityAction.Fund)),
            active: true
        });
    }

    function _widenedConfig(TopologyParticipant[] memory participants, DelegatedAuthority[] memory delegations)
        internal
        pure
        returns (WidenedAuthorityConfig memory config)
    {
        config = WidenedAuthorityConfig({
            modelVersion: AUTHORITY_MODEL_WIDENED_V1,
            participants: participants,
            delegations: delegations
        });
    }

    function testSellerCanSubmitFundedCurrentMilestone() public {
        uint256 submissionTime = 1_700_000_000;
        vm.warp(submissionTime);

        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Submitted));
        assertEq(milestone.evidenceHash, EVIDENCE_HASH);
        assertEq(milestone.submittedAt, submissionTime);
        assertEq(milestone.reviewDeadline, submissionTime + 5 days);
    }

    function testNonSellerCannotSubmitMilestone() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.submitMilestone(0, EVIDENCE_HASH);
    }

    function testSubmitRevertsForZeroEvidenceHash() public {
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidEvidenceHash.selector));
        escrow.submitMilestone(0, bytes32(0));
    }

    function testSubmitRevertsForOutOfBoundsMilestone() public {
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneIndex.selector));
        escrow.submitMilestone(2, EVIDENCE_HASH);
    }

    function testGetMilestoneRevertsForOutOfBoundsMilestone() public {
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneIndex.selector));
        escrow.getMilestone(2);
    }

    function testSubmitRevertsForWrongMilestoneSequence() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneSequence.selector));
        anotherEscrow.submitMilestone(1, EVIDENCE_HASH);
    }

    function testSubmitRevertsWhenMilestoneNotFunded() public {
        MilestoneEscrow unfundedEscrow = _deployEscrow();

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        unfundedEscrow.submitMilestone(0, EVIDENCE_HASH);
    }

    function testSubmitRevertsWhenMilestoneAlreadySubmitted() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.submitMilestone(0, keccak256("replacement-evidence"));
    }

    function testSubmitRevertsIfActiveDisputeExists() public {
        vm.store(address(escrow), bytes32(uint256(8)), bytes32(uint256(0)));

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        escrow.submitMilestone(0, EVIDENCE_HASH);
    }

    function testBuyerCanApproveSubmittedMilestoneAndPaySeller() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.approveMilestone(0);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone.sellerAward, 990e6);
        assertEq(escrow.currentMilestoneIndex(), 1);
        assertEq(escrow.totalReleasedToSeller(), 990e6);
        assertEq(escrow.totalFeesCollected(), 10e6);
        assertEq(token.balanceOf(SELLER), 990e6);
        assertEq(token.balanceOf(FEE_RECIPIENT), 10e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testApprovalCompletesDealOnFinalMilestone() public {
        MilestoneEscrow singleMilestoneEscrow = _deploySingleMilestoneEscrow();

        token.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        token.approve(address(singleMilestoneEscrow), type(uint256).max);

        vm.prank(BUYER);
        singleMilestoneEscrow.fundMilestone(0);

        vm.prank(SELLER);
        singleMilestoneEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        singleMilestoneEscrow.approveMilestone(0);

        assertEq(singleMilestoneEscrow.currentMilestoneIndex(), 0);
        assertEq(uint256(singleMilestoneEscrow.dealStatus()), uint256(DealStatus.Completed));
    }

    function testFundAllMilestonesRevertsAfterFinalSettlement() public {
        MilestoneEscrow singleMilestoneEscrow = _deploySingleMilestoneEscrow();

        token.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        token.approve(address(singleMilestoneEscrow), type(uint256).max);

        vm.prank(BUYER);
        singleMilestoneEscrow.fundMilestone(0);

        vm.prank(SELLER);
        singleMilestoneEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        singleMilestoneEscrow.approveMilestone(0);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        singleMilestoneEscrow.fundAllMilestones();
    }

    function testNonBuyerCannotApproveMilestone() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.approveMilestone(0);
    }

    function testApproveRevertsForOutOfBoundsMilestone() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneIndex.selector));
        escrow.approveMilestone(2);
    }

    function testApproveRevertsForWrongMilestoneSequence() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        _setMilestoneStatus(anotherEscrow, 1, MilestoneStatus.Submitted);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneSequence.selector));
        anotherEscrow.approveMilestone(1);
    }

    function testApproveRevertsWhenMilestoneNotSubmitted() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.approveMilestone(0);
    }

    function testApproveRevertsForPreviouslySettledMilestone() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        anotherEscrow.approveMilestone(0);

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(1, EVIDENCE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        anotherEscrow.approveMilestone(0);
    }

    function testApproveRevertsAfterReviewDeadline() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.warp(block.timestamp + 5 days + 1);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(DeadlinePassed.selector));
        escrow.approveMilestone(0);
    }

    function testBuyerCanApproveAtExactReviewDeadline() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline);

        vm.prank(BUYER);
        escrow.approveMilestone(0);

        assertEq(uint256(escrow.getMilestone(0).status), uint256(MilestoneStatus.PaidOut));
    }

    function testApprovePaysFullAmountWhenProtocolFeeIsZero() public {
        MilestoneEscrow zeroFeeEscrow = _deployZeroFeeEscrow();

        token.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        token.approve(address(zeroFeeEscrow), type(uint256).max);

        vm.prank(BUYER);
        zeroFeeEscrow.fundMilestone(0);

        vm.prank(SELLER);
        zeroFeeEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        zeroFeeEscrow.approveMilestone(0);

        Milestone memory milestone = zeroFeeEscrow.getMilestone(0);

        assertEq(milestone.sellerAward, 1_000e6);
        assertEq(zeroFeeEscrow.totalReleasedToSeller(), 1_000e6);
        assertEq(zeroFeeEscrow.totalFeesCollected(), 0);
        assertEq(token.balanceOf(SELLER), 1_000e6);
        assertEq(token.balanceOf(FEE_RECIPIENT), 0);
    }

    function testApproveRevertsIfPayoutTransferFails() public {
        MockFailingTransferERC20 failingToken = new MockFailingTransferERC20();

        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(failingToken),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("failing-transfer-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](1);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });

        MilestoneEscrow failingEscrow =
            new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());

        failingToken.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        failingToken.approve(address(failingEscrow), type(uint256).max);

        vm.prank(BUYER);
        failingEscrow.fundMilestone(0);

        vm.prank(SELLER);
        failingEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeERC20.SafeERC20FailedOperation.selector, address(failingToken)
            )
        );
        failingEscrow.approveMilestone(0);

        Milestone memory milestone = failingEscrow.getMilestone(0);
        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Submitted));
        assertEq(failingEscrow.totalReleasedToSeller(), 0);
        assertEq(failingEscrow.totalFeesCollected(), 0);
    }

    function testApproveRevertsIfActiveDisputeExists() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.store(address(escrow), bytes32(uint256(8)), bytes32(uint256(0)));

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        escrow.approveMilestone(0);
    }

    function testSellerCanClaimAfterReviewWindow() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.prank(SELLER);
        escrow.claimAfterReviewWindow(0);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone.sellerAward, 990e6);
        assertEq(escrow.currentMilestoneIndex(), 1);
        assertEq(escrow.totalReleasedToSeller(), 990e6);
        assertEq(escrow.totalFeesCollected(), 10e6);
        assertEq(token.balanceOf(SELLER), 990e6);
        assertEq(token.balanceOf(FEE_RECIPIENT), 10e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testClaimAfterReviewWindowDoesNotEmitClaimableEvent() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.recordLogs();
        vm.prank(SELLER);
        escrow.claimAfterReviewWindow(0);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 claimableTopic = keccak256("MilestoneClaimable(uint256)");

        for (uint256 i = 0; i < entries.length; i++) {
            assertTrue(entries[i].topics[0] != claimableTopic);
        }
    }

    function testClaimCompletesDealOnFinalMilestone() public {
        MilestoneEscrow singleMilestoneEscrow = _deploySingleMilestoneEscrow();

        token.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        token.approve(address(singleMilestoneEscrow), type(uint256).max);

        vm.prank(BUYER);
        singleMilestoneEscrow.fundMilestone(0);

        vm.prank(SELLER);
        singleMilestoneEscrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = singleMilestoneEscrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.prank(SELLER);
        singleMilestoneEscrow.claimAfterReviewWindow(0);

        assertEq(singleMilestoneEscrow.currentMilestoneIndex(), 0);
        assertEq(uint256(singleMilestoneEscrow.dealStatus()), uint256(DealStatus.Completed));
    }

    function testNonSellerCannotClaimAfterReviewWindow() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.claimAfterReviewWindow(0);
    }

    function testClaimRevertsForOutOfBoundsMilestone() public {
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneIndex.selector));
        escrow.claimAfterReviewWindow(2);
    }

    function testClaimRevertsForWrongMilestoneSequence() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        _setMilestoneStatus(anotherEscrow, 1, MilestoneStatus.Submitted);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneSequence.selector));
        anotherEscrow.claimAfterReviewWindow(1);
    }

    function testClaimRevertsWhenMilestoneNotSubmitted() public {
        vm.warp(block.timestamp + 5 days + 1);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.claimAfterReviewWindow(0);
    }

    function testClaimRevertsAtExactReviewDeadline() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(DeadlineNotReached.selector));
        escrow.claimAfterReviewWindow(0);
    }

    function testClaimRevertsIfActiveDisputeExists() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.store(address(escrow), bytes32(uint256(8)), bytes32(uint256(0)));

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        escrow.claimAfterReviewWindow(0);
    }

    function testClaimRevertsIfPayoutTransferFails() public {
        MockFailingTransferERC20 failingToken = new MockFailingTransferERC20();

        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(failingToken),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("failing-claim-transfer-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](1);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });

        MilestoneEscrow failingEscrow =
            new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());

        failingToken.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        failingToken.approve(address(failingEscrow), type(uint256).max);

        vm.prank(BUYER);
        failingEscrow.fundMilestone(0);

        vm.prank(SELLER);
        failingEscrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = failingEscrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.prank(SELLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeERC20.SafeERC20FailedOperation.selector, address(failingToken)
            )
        );
        failingEscrow.claimAfterReviewWindow(0);

        Milestone memory milestone = failingEscrow.getMilestone(0);
        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Submitted));
        assertEq(failingEscrow.totalReleasedToSeller(), 0);
        assertEq(failingEscrow.totalFeesCollected(), 0);
    }

    function testBuyerCanOpenDisputeForSubmittedMilestone() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Disputed));
        assertEq(milestone.disputeHash, DISPUTE_HASH);
        assertEq(escrow.activeDisputeMilestoneId(), 0);
    }

    function testBuyerCanOpenDisputeAtExactReviewDeadline() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        assertEq(uint256(escrow.getMilestone(0).status), uint256(MilestoneStatus.Disputed));
    }

    function testNonBuyerCannotOpenDispute() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.openDispute(0, DISPUTE_HASH);
    }

    function testOpenDisputeRevertsForZeroDisputeHash() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidDisputeHash.selector));
        escrow.openDispute(0, bytes32(0));
    }

    function testOpenDisputeRevertsForOutOfBoundsMilestone() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneIndex.selector));
        escrow.openDispute(2, DISPUTE_HASH);
    }

    function testOpenDisputeRevertsForWrongMilestoneSequence() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        _setMilestoneStatus(anotherEscrow, 1, MilestoneStatus.Submitted);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneSequence.selector));
        anotherEscrow.openDispute(1, DISPUTE_HASH);
    }

    function testOpenDisputeRevertsWhenMilestoneNotSubmitted() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.openDispute(0, DISPUTE_HASH);
    }

    function testOpenDisputeRevertsAfterReviewDeadline() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        Milestone memory submittedMilestone = escrow.getMilestone(0);
        vm.warp(submittedMilestone.reviewDeadline + 1);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(DeadlinePassed.selector));
        escrow.openDispute(0, DISPUTE_HASH);
    }

    function testOpenDisputeRevertsIfAnotherDisputeIsActive() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        anotherEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        anotherEscrow.openDispute(0, keccak256("second-dispute"));
    }

    function testOpenDisputeBlocksFundingNextMilestone() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        anotherEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        anotherEscrow.fundMilestone(1);
    }

    function testOpenDisputeBlocksSubmittingNextMilestone() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        anotherEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(ActiveDisputeExists.selector));
        anotherEscrow.submitMilestone(1, EVIDENCE_HASH);
    }

    function testArbiterCanResolveDisputeWithFullBuyerRefund() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        escrow.resolveDispute(0, 1_000e6, 0);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Refunded));
        assertEq(milestone.buyerAward, 1_000e6);
        assertEq(milestone.sellerAward, 0);
        assertEq(escrow.activeDisputeMilestoneId(), type(uint256).max);
        assertEq(escrow.currentMilestoneIndex(), 1);
        assertEq(escrow.totalRefundedToBuyer(), 1_000e6);
        assertEq(escrow.totalReleasedToSeller(), 0);
        assertEq(escrow.totalFeesCollected(), 0);
        assertEq(token.balanceOf(BUYER), 10_000e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testArbiterCanResolveDisputeWithFullSellerPayout() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        escrow.resolveDispute(0, 0, 1_000e6);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone.buyerAward, 0);
        assertEq(milestone.sellerAward, 1_000e6);
        assertEq(escrow.activeDisputeMilestoneId(), type(uint256).max);
        assertEq(escrow.currentMilestoneIndex(), 1);
        assertEq(escrow.totalRefundedToBuyer(), 0);
        assertEq(escrow.totalReleasedToSeller(), 990e6);
        assertEq(escrow.totalFeesCollected(), 10e6);
        assertEq(token.balanceOf(SELLER), 990e6);
        assertEq(token.balanceOf(FEE_RECIPIENT), 10e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testArbiterCanResolveDisputeWithSplitOutcome() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        escrow.resolveDispute(0, 400e6, 600e6);

        Milestone memory milestone = escrow.getMilestone(0);

        assertEq(uint256(milestone.status), uint256(MilestoneStatus.PaidOut));
        assertEq(milestone.buyerAward, 400e6);
        assertEq(milestone.sellerAward, 600e6);
        assertEq(escrow.activeDisputeMilestoneId(), type(uint256).max);
        assertEq(escrow.totalRefundedToBuyer(), 400e6);
        assertEq(escrow.totalReleasedToSeller(), 594e6);
        assertEq(escrow.totalFeesCollected(), 6e6);
        assertEq(token.balanceOf(BUYER), 9_400e6);
        assertEq(token.balanceOf(SELLER), 594e6);
        assertEq(token.balanceOf(FEE_RECIPIENT), 6e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testResolveDisputeClearsPointerAndUnblocksNextMilestoneProgression() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundAllMilestones();

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        anotherEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        anotherEscrow.resolveDispute(0, 400e6, 600e6);

        assertEq(anotherEscrow.activeDisputeMilestoneId(), type(uint256).max);
        assertEq(anotherEscrow.currentMilestoneIndex(), 1);

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(1, keccak256("milestone-1-evidence"));

        assertEq(uint256(anotherEscrow.getMilestone(1).status), uint256(MilestoneStatus.Submitted));
    }

    function testResolveDisputeCompletesDealOnFinalMilestone() public {
        MilestoneEscrow singleMilestoneEscrow = _deploySingleMilestoneEscrow();

        token.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        token.approve(address(singleMilestoneEscrow), type(uint256).max);

        vm.prank(BUYER);
        singleMilestoneEscrow.fundMilestone(0);

        vm.prank(SELLER);
        singleMilestoneEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        singleMilestoneEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        singleMilestoneEscrow.resolveDispute(0, 0, 1_000e6);

        assertEq(singleMilestoneEscrow.currentMilestoneIndex(), 0);
        assertEq(uint256(singleMilestoneEscrow.dealStatus()), uint256(DealStatus.Completed));
    }

    function testNonArbiterCannotResolveDispute() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.resolveDispute(0, 1_000e6, 0);
    }

    function testResolveDisputeRevertsForOutOfBoundsMilestone() public {
        vm.prank(ARBITER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneIndex.selector));
        escrow.resolveDispute(2, 1_000e6, 0);
    }

    function testResolveDisputeRevertsWithoutActiveDispute() public {
        vm.prank(ARBITER);
        vm.expectRevert(abi.encodeWithSelector(NoActiveDispute.selector));
        escrow.resolveDispute(0, 1_000e6, 0);
    }

    function testResolveDisputeRevertsForInvalidSplit() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        vm.expectRevert(abi.encodeWithSelector(InvalidResolutionSplit.selector));
        escrow.resolveDispute(0, 500e6, 499e6);
    }

    function testResolveDisputeRevertsIfMilestoneNotDisputed() public {
        vm.prank(ARBITER);
        vm.expectRevert(abi.encodeWithSelector(NoActiveDispute.selector));
        escrow.resolveDispute(0, 0, 1_000e6);
    }

    function testResolveDisputeRevertsWhenPointerSetButMilestoneStateNotDisputed() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.store(address(escrow), bytes32(ACTIVE_DISPUTE_SLOT), bytes32(uint256(0)));

        vm.prank(ARBITER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.resolveDispute(0, 400e6, 600e6);
    }

    function testResolveDisputeRevertsIfTransferFails() public {
        MockFailingTransferERC20 failingToken = new MockFailingTransferERC20();

        DealConfig memory config = DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(failingToken),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("failing-resolve-transfer-deal")
        });

        MilestoneConfig[] memory milestoneConfigs = new MilestoneConfig[](1);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });

        MilestoneEscrow failingEscrow =
            new MilestoneEscrow(config, milestoneConfigs, _mvpWidenedConfig());

        failingToken.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        failingToken.approve(address(failingEscrow), type(uint256).max);

        vm.prank(BUYER);
        failingEscrow.fundMilestone(0);

        vm.prank(SELLER);
        failingEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        failingEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeERC20.SafeERC20FailedOperation.selector, address(failingToken)
            )
        );
        failingEscrow.resolveDispute(0, 400e6, 600e6);

        Milestone memory milestone = failingEscrow.getMilestone(0);
        assertEq(uint256(milestone.status), uint256(MilestoneStatus.Disputed));
        assertEq(failingEscrow.activeDisputeMilestoneId(), 0);
        assertEq(failingEscrow.totalRefundedToBuyer(), 0);
        assertEq(failingEscrow.totalReleasedToSeller(), 0);
        assertEq(failingEscrow.totalFeesCollected(), 0);
    }

    function testBuyerCanCancelAllUnfundedMilestonesInDraftDeal() public {
        MilestoneEscrow draftEscrow = _deployEscrow();

        vm.prank(BUYER);
        draftEscrow.cancelUnfundedMilestones();

        Milestone memory milestone0 = draftEscrow.getMilestone(0);
        Milestone memory milestone1 = draftEscrow.getMilestone(1);

        assertEq(uint256(milestone0.status), uint256(MilestoneStatus.Cancelled));
        assertEq(uint256(milestone1.status), uint256(MilestoneStatus.Cancelled));
        assertEq(uint256(draftEscrow.dealStatus()), uint256(DealStatus.Cancelled));
    }

    function testSellerCanCancelRemainingUnfundedMilestonesAfterSettlement() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundMilestone(0);

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        anotherEscrow.approveMilestone(0);

        vm.prank(SELLER);
        anotherEscrow.cancelUnfundedMilestones();

        Milestone memory milestone0 = anotherEscrow.getMilestone(0);
        Milestone memory milestone1 = anotherEscrow.getMilestone(1);

        assertEq(uint256(milestone0.status), uint256(MilestoneStatus.PaidOut));
        assertEq(uint256(milestone1.status), uint256(MilestoneStatus.Cancelled));
        assertEq(uint256(anotherEscrow.dealStatus()), uint256(DealStatus.Cancelled));
    }

    function testCancelAfterSettlementLocksFutureMilestoneOperations() public {
        MilestoneEscrow anotherEscrow = _deployEscrow();

        vm.prank(BUYER);
        token.approve(address(anotherEscrow), type(uint256).max);

        vm.prank(BUYER);
        anotherEscrow.fundMilestone(0);

        vm.prank(SELLER);
        anotherEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        anotherEscrow.approveMilestone(0);

        vm.prank(SELLER);
        anotherEscrow.cancelUnfundedMilestones();

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        anotherEscrow.fundMilestone(1);

        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        anotherEscrow.submitMilestone(1, keccak256("cancelled-milestone-evidence"));

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        anotherEscrow.openDispute(1, keccak256("cancelled-milestone-dispute"));
    }

    function testNonPartyCannotCancelUnfundedMilestones() public {
        vm.prank(ARBITER);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        escrow.cancelUnfundedMilestones();
    }

    function testCancelUnfundedMilestonesRevertsWhenCurrentMilestoneFunded() public {
        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.cancelUnfundedMilestones();
    }

    function testCancelUnfundedMilestonesRevertsWhenCurrentMilestoneSubmitted() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.cancelUnfundedMilestones();
    }

    function testCancelUnfundedMilestonesRevertsWhenCurrentMilestoneDisputed() public {
        vm.prank(SELLER);
        escrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        escrow.openDispute(0, DISPUTE_HASH);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(InvalidMilestoneState.selector));
        escrow.cancelUnfundedMilestones();
    }

    function testCancelUnfundedMilestonesRevertsWhenNothingRemainsToCancel() public {
        MilestoneEscrow singleMilestoneEscrow = _deploySingleMilestoneEscrow();

        token.mint(BUYER, 1_000e6);
        vm.prank(BUYER);
        token.approve(address(singleMilestoneEscrow), type(uint256).max);

        vm.prank(BUYER);
        singleMilestoneEscrow.fundMilestone(0);

        vm.prank(SELLER);
        singleMilestoneEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        singleMilestoneEscrow.approveMilestone(0);

        vm.prank(BUYER);
        vm.expectRevert(abi.encodeWithSelector(NothingToCancel.selector));
        singleMilestoneEscrow.cancelUnfundedMilestones();
    }

    function testConfigureWidenedAuthorityRevertsForUnsupportedModelVersion() public {
        TopologyParticipant[] memory participants = _widenedParticipants();
        DelegatedAuthority[] memory delegations = _singleFundDelegation(address(0xD1));
        WidenedAuthorityConfig memory config = _widenedConfig(participants, delegations);
        config.modelVersion = AUTHORITY_MODEL_WIDENED_V1 + 1;

        vm.expectRevert(abi.encodeWithSelector(InvalidAuthorityModelVersion.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testConfigureWidenedAuthorityRevertsForDuplicateTopologyParticipant() public {
        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant({ account: BUYER, role: ParticipantRole.Buyer, active: true });
        participants[1] = TopologyParticipant({ account: SELLER, role: ParticipantRole.Seller, active: true });
        participants[2] = TopologyParticipant({ account: BUYER, role: ParticipantRole.Buyer, active: true });
        participants[3] = TopologyParticipant({ account: ARBITER, role: ParticipantRole.Arbiter, active: true });

        WidenedAuthorityConfig memory config =
            _widenedConfig(participants, _singleFundDelegation(address(0xD1)));

        vm.expectRevert(abi.encodeWithSelector(DuplicateTopologyParticipant.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testConfigureWidenedAuthorityRevertsForInactiveCanonicalBuyer() public {
        TopologyParticipant[] memory participants = _widenedParticipants();
        participants[0].active = false;

        WidenedAuthorityConfig memory config =
            _widenedConfig(participants, _singleFundDelegation(address(0xD1)));

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testConfigureWidenedAuthorityRevertsForInactiveCanonicalSeller() public {
        TopologyParticipant[] memory participants = _widenedParticipants();
        participants[1].active = false;

        WidenedAuthorityConfig memory config =
            _widenedConfig(participants, _singleFundDelegation(address(0xD1)));

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testConfigureWidenedAuthorityRevertsForInactiveCanonicalArbiter() public {
        TopologyParticipant[] memory participants = _widenedParticipants();
        participants[2].active = false;

        WidenedAuthorityConfig memory config =
            _widenedConfig(participants, _singleFundDelegation(address(0xD1)));

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testConfigureWidenedAuthorityRevertsForZeroDelegationAddress() public {
        TopologyParticipant[] memory participants = _widenedParticipants();
        DelegatedAuthority[] memory delegations = _singleFundDelegation(address(0xD1));
        delegations[0].delegator = address(0);

        WidenedAuthorityConfig memory config = _widenedConfig(participants, delegations);

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testConfigureWidenedAuthorityRevertsForDuplicateDelegationPair() public {
        address buyerDelegate = address(0xD1);

        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant({ account: BUYER, role: ParticipantRole.Buyer, active: true });
        participants[1] = TopologyParticipant({ account: SELLER, role: ParticipantRole.Seller, active: true });
        participants[2] = TopologyParticipant({ account: ARBITER, role: ParticipantRole.Arbiter, active: true });
        participants[3] = TopologyParticipant({ account: buyerDelegate, role: ParticipantRole.Observer, active: true });

        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](2);
        delegations[0] = DelegatedAuthority({
            delegator: BUYER,
            delegate: buyerDelegate,
            permissions: uint32(1 << uint8(AuthorityAction.Fund)),
            active: true
        });
        delegations[1] = delegations[0];

        WidenedAuthorityConfig memory config = _widenedConfig(participants, delegations);

        vm.expectRevert(abi.encodeWithSelector(DuplicateDelegation.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testWidenedFundDelegateRevertsWhenCanonicalBuyerRoleMismatches() public {
        address buyerDelegate = address(0xD1);

        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant({ account: BUYER, role: ParticipantRole.Observer, active: true });
        participants[1] = TopologyParticipant({ account: SELLER, role: ParticipantRole.Seller, active: true });
        participants[2] = TopologyParticipant({ account: ARBITER, role: ParticipantRole.Arbiter, active: true });
        participants[3] = TopologyParticipant({ account: buyerDelegate, role: ParticipantRole.Observer, active: true });

        WidenedAuthorityConfig memory config =
            _widenedConfig(participants, _singleFundDelegation(buyerDelegate));

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testConfigureWidenedAuthorityRevertsWhenDelegationDelegateIsInactive() public {
        address buyerDelegate = address(0xD1);

        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant({ account: BUYER, role: ParticipantRole.Buyer, active: true });
        participants[1] = TopologyParticipant({ account: SELLER, role: ParticipantRole.Seller, active: true });
        participants[2] = TopologyParticipant({ account: ARBITER, role: ParticipantRole.Arbiter, active: true });
        participants[3] = TopologyParticipant({ account: buyerDelegate, role: ParticipantRole.Observer, active: false });

        WidenedAuthorityConfig memory config =
            _widenedConfig(participants, _singleFundDelegation(buyerDelegate));

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        new MilestoneEscrow(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function testMockErc20TransferAndTransferFromHappyPath() public {
        MockERC20 mockToken = new MockERC20();
        address receiver = address(0xC0FFEE);
        address spender = address(0xABCD);

        mockToken.mint(address(this), 200e6);
        assertTrue(mockToken.transfer(receiver, 100e6));
        assertEq(mockToken.balanceOf(receiver), 100e6);

        mockToken.approve(spender, 50e6);
        vm.prank(spender);
        assertTrue(mockToken.transferFrom(address(this), receiver, 50e6));

        assertEq(mockToken.balanceOf(receiver), 150e6);
        assertEq(mockToken.allowance(address(this), spender), 0);
    }

    function testMockErc20TransferRevertsOnInsufficientBalance() public {
        MockERC20 mockToken = new MockERC20();

        vm.expectRevert("insufficient balance");
        mockToken.transfer(address(0xC0FFEE), 1);
    }

    function testMockErc20TransferFromRevertsOnInsufficientAllowance() public {
        MockERC20 mockToken = new MockERC20();
        address spender = address(0xABCD);

        mockToken.mint(address(this), 10);

        vm.prank(spender);
        vm.expectRevert("insufficient allowance");
        mockToken.transferFrom(address(this), address(0xC0FFEE), 1);
    }

    function testMockErc20TransferFromRevertsOnInsufficientBalance() public {
        MockERC20 mockToken = new MockERC20();
        address spender = address(0xABCD);

        mockToken.approve(spender, 10);

        vm.prank(spender);
        vm.expectRevert("insufficient balance");
        mockToken.transferFrom(address(this), address(0xC0FFEE), 1);
    }

    function testMockFailingTransferReturnsFalse() public {
        MockFailingTransferERC20 failingToken = new MockFailingTransferERC20();

        assertFalse(failingToken.transfer(address(0xC0FFEE), 1));
    }

    function testInternalPayerForActionFallsBackToActorForNonFundAction() public {
        MilestoneEscrowInternalHarness harness = _deployInternalHarnessMvp();
        address actor = address(0xDADA);

        assertEq(harness.exposedPayerForAction(actor, AuthorityAction.Resolve), actor);
    }

    function testInternalIsAuthorizedForRoleReturnsFalseWhenActorIsOutsideTopology() public {
        address buyerDelegate = address(0xD1);
        MilestoneEscrowInternalHarness harness = _deployInternalHarnessWidened(buyerDelegate);

        assertFalse(
            harness.exposedIsAuthorizedForRole(
                address(0xD2),
                BUYER,
                ParticipantRole.Buyer,
                AuthorityAction.Fund
            )
        );
    }

    function testInternalIsAuthorizedForRoleReturnsFalseWhenTopologyRoleMismatches() public {
        address buyerDelegate = address(0xD1);
        MilestoneEscrowInternalHarness harness = _deployInternalHarnessWidened(buyerDelegate);

        assertFalse(
            harness.exposedIsAuthorizedForRole(
                buyerDelegate,
                BUYER,
                ParticipantRole.Seller,
                AuthorityAction.Fund
            )
        );
    }

    function testInternalIsAuthorizedReturnsFalseForUnknownAction() public {
        MilestoneEscrowInternalHarness harness = _deployInternalHarnessMvp();

        assertFalse(
            harness.exposedIsAuthorized(address(0xD2), AuthorityAction(uint8(type(AuthorityAction).max)))
        );
    }

    function testInternalAllowedPermissionsReturnsZeroForObserverRole() public {
        MilestoneEscrowInternalHarness harness = _deployInternalHarnessMvp();

        assertEq(harness.exposedAllowedPermissionsForRole(ParticipantRole.Observer), 0);
    }

    function _setMilestoneStatus(MilestoneEscrow target, uint256 milestoneId, MilestoneStatus status)
        internal
    {
        bytes32 milestonesBase = keccak256(abi.encode(uint256(MILESTONES_SLOT)));
        uint256 statusSlot =
            uint256(milestonesBase) + milestoneId * MILESTONE_STORAGE_STRIDE + 1;
        vm.store(address(target), bytes32(statusSlot), bytes32(uint256(status)));
    }

    function _deployInternalHarnessMvp() internal returns (MilestoneEscrowInternalHarness harness) {
        harness = new MilestoneEscrowInternalHarness(
            _baseDealConfig(),
            _singleMilestoneConfig(),
            _mvpWidenedConfig()
        );
    }

    function _deployInternalHarnessWidened(address buyerDelegate)
        internal
        returns (MilestoneEscrowInternalHarness harness)
    {
        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant({ account: BUYER, role: ParticipantRole.Buyer, active: true });
        participants[1] = TopologyParticipant({ account: SELLER, role: ParticipantRole.Seller, active: true });
        participants[2] = TopologyParticipant({ account: ARBITER, role: ParticipantRole.Arbiter, active: true });
        participants[3] = TopologyParticipant({ account: buyerDelegate, role: ParticipantRole.Observer, active: true });

        WidenedAuthorityConfig memory config =
            _widenedConfig(participants, _singleFundDelegation(buyerDelegate));

        harness = new MilestoneEscrowInternalHarness(_baseDealConfig(), _singleMilestoneConfig(), config);
    }

    function _mvpWidenedConfig() internal pure returns (WidenedAuthorityConfig memory config) {
        TopologyParticipant[] memory participants = new TopologyParticipant[](0);
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](0);
        config = WidenedAuthorityConfig({ modelVersion: 0, participants: participants, delegations: delegations });
    }
}
