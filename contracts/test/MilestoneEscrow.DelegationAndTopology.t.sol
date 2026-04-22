// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import {
    AUTHORITY_MODEL_WIDENED_V1,
    AuthorityAction,
    DealConfig,
    DealStatus,
    DelegatedAuthority,
    MilestoneConfig,
    MilestoneStatus,
    ParticipantRole,
    TopologyParticipant,
    WidenedAuthorityConfig
} from "src/MilestackTypes.sol";
import {
    Unauthorized,
    UnauthorizedDelegateOrTopology,
    InvalidTopologyParticipant,
    InvalidParticipantRole,
    InvalidPartyConfiguration,
    SelfDelegation,
    InvalidDelegatedAuthority,
    PrivilegeEscalation
} from "src/MilestackErrors.sol";
import { MockERC20 } from "test/mocks/MockERC20.sol";

contract MilestoneEscrowDelegationAndTopologyTest is Test {
    uint256 internal constant DELEGATED_PERMISSIONS_SLOT = 16;

    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);

    address internal constant BUYER_DELEGATE = address(0xB0D1);
    address internal constant SELLER_DELEGATE = address(0xA11D);
    address internal constant ARBITER_DELEGATE = address(0xCAFD);
    address internal constant INACTIVE_TOPOLOGY_MEMBER = address(0xD15A);
    address internal constant STRANGER = address(0x9999);

    bytes32 internal constant EVIDENCE_HASH = keccak256("milestone-evidence");
    bytes32 internal constant DISPUTE_HASH = keccak256("milestone-dispute");

    MockERC20 internal token;
    MilestoneEscrow internal mvpEscrow;
    MilestoneEscrow internal widenedEscrow;

    function setUp() public {
        token = new MockERC20();

        token.mint(BUYER, 30_000e6);

        mvpEscrow = new MilestoneEscrow(_config(), _milestones(), _mvpWidenedConfig());
        widenedEscrow = new MilestoneEscrow(_config(), _milestones(), _widenedConfig());

        vm.prank(BUYER);
        token.approve(address(mvpEscrow), type(uint256).max);

        vm.prank(BUYER);
        token.approve(address(widenedEscrow), type(uint256).max);
    }

    function testMvpPathStillUsesDirectRolesOnly() public {
        vm.prank(BUYER_DELEGATE);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector));
        mvpEscrow.fundMilestone(0);

        vm.prank(BUYER);
        mvpEscrow.fundMilestone(0);

        vm.prank(SELLER);
        mvpEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        mvpEscrow.approveMilestone(0);

        assertEq(uint256(mvpEscrow.authorityModelVersion()), 0);
        assertEq(uint256(mvpEscrow.getMilestone(0).status), uint256(MilestoneStatus.PaidOut));
    }

    function testWidenedBuyerDelegateCanFundAndCanonicalPathStillWorks() public {
        vm.prank(BUYER_DELEGATE);
        widenedEscrow.fundMilestone(0);

        vm.prank(SELLER);
        widenedEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER);
        widenedEscrow.approveMilestone(0);

        assertEq(widenedEscrow.authorityModelVersion(), AUTHORITY_MODEL_WIDENED_V1);
        assertEq(uint256(widenedEscrow.getMilestone(0).status), uint256(MilestoneStatus.PaidOut));
    }

    function testUnauthorizedDelegateCannotApproveWithoutPermission() public {
        vm.prank(BUYER);
        widenedEscrow.fundMilestone(0);

        vm.prank(SELLER);
        widenedEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(SELLER_DELEGATE);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        widenedEscrow.approveMilestone(0);
    }

    function testInactiveTopologyMemberCannotPerformAssignedAction() public {
        vm.prank(INACTIVE_TOPOLOGY_MEMBER);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        widenedEscrow.fundMilestone(0);
    }

    function testWidenedDelegatesCanExerciseConfiguredActionsAcrossLifecycle() public {
        vm.prank(BUYER_DELEGATE);
        widenedEscrow.fundMilestone(0);

        vm.prank(SELLER_DELEGATE);
        widenedEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(BUYER_DELEGATE);
        widenedEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(ARBITER_DELEGATE);
        widenedEscrow.resolveDispute(0, 400e6, 600e6);

        assertEq(uint256(widenedEscrow.getMilestone(0).status), uint256(MilestoneStatus.PaidOut));
        assertEq(widenedEscrow.totalRefundedToBuyer(), 400e6);
        assertEq(widenedEscrow.totalReleasedToSeller(), 594e6);
        assertEq(uint256(widenedEscrow.dealStatus()), uint256(DealStatus.Active));
    }

    function testStrangerCannotFundSubmitApproveDisputeOrResolveInWidenedMode() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        widenedEscrow.fundMilestone(0);

        vm.prank(BUYER);
        widenedEscrow.fundMilestone(0);

        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        widenedEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(SELLER);
        widenedEscrow.submitMilestone(0, EVIDENCE_HASH);

        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        widenedEscrow.approveMilestone(0);

        vm.prank(BUYER);
        widenedEscrow.openDispute(0, DISPUTE_HASH);

        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        widenedEscrow.resolveDispute(0, 500e6, 500e6);
    }

    function testConfigureWidenedAuthorityRevertsForZeroAddressParticipant() public {
        TopologyParticipant[] memory participants = _baseParticipants();
        participants[0].account = address(0);

        WidenedAuthorityConfig memory config = _widenedConfigWithParticipants(participants);

        vm.expectRevert(abi.encodeWithSelector(InvalidTopologyParticipant.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsForNoneParticipantRole() public {
        TopologyParticipant[] memory participants = _baseParticipants();
        participants[0].role = ParticipantRole.None;

        WidenedAuthorityConfig memory config = _widenedConfigWithParticipants(participants);

        vm.expectRevert(abi.encodeWithSelector(InvalidParticipantRole.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsWhenCanonicalBuyerMissing() public {
        TopologyParticipant[] memory participants = _baseParticipantsWithoutBuyer();

        WidenedAuthorityConfig memory config = _widenedConfigWithParticipants(participants);

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsWhenCanonicalSellerMissing() public {
        TopologyParticipant[] memory participants = _baseParticipantsWithoutSeller();

        WidenedAuthorityConfig memory config = _widenedConfigWithParticipants(participants);

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsWhenCanonicalArbiterMissing() public {
        TopologyParticipant[] memory participants = _baseParticipantsWithoutArbiter();

        WidenedAuthorityConfig memory config = _widenedConfigWithParticipants(participants);

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsForSelfDelegation() public {
        WidenedAuthorityConfig memory config = _widenedConfig();
        config.delegations[0].delegate = config.delegations[0].delegator;

        vm.expectRevert(abi.encodeWithSelector(SelfDelegation.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsForInactiveDelegation() public {
        WidenedAuthorityConfig memory config = _widenedConfig();
        config.delegations[0].active = false;

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsForZeroPermissionDelegation() public {
        WidenedAuthorityConfig memory config = _widenedConfig();
        config.delegations[0].permissions = 0;

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsWhenDelegatorMissingFromTopology() public {
        WidenedAuthorityConfig memory config = _widenedConfig();
        config.delegations[0].delegator = STRANGER;

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testConfigureWidenedAuthorityRevertsForPrivilegeEscalationPermissions() public {
        WidenedAuthorityConfig memory config = _widenedConfig();
        config.delegations[1].permissions = uint32(1 << uint8(AuthorityAction.Resolve));

        vm.expectRevert(abi.encodeWithSelector(PrivilegeEscalation.selector));
        new MilestoneEscrow(_config(), _milestones(), config);
    }

    function testWidenedFundRevertsWhenBuyerDelegationPermissionRemoved() public {
        WidenedAuthorityConfig memory config = _widenedConfig();
        MilestoneEscrow escrowWithoutBuyerFundDelegation =
            new MilestoneEscrow(_config(), _milestones(), config);

        bytes32 buyerKey = keccak256(abi.encode(BUYER, DELEGATED_PERMISSIONS_SLOT));
        bytes32 buyerDelegateKey = keccak256(abi.encode(BUYER_DELEGATE, uint256(buyerKey)));
        vm.store(address(escrowWithoutBuyerFundDelegation), buyerDelegateKey, bytes32(0));

        vm.prank(BUYER_DELEGATE);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        escrowWithoutBuyerFundDelegation.fundMilestone(0);
    }

    function testWidenedFundRevertsWhenDelegateNotInTopologyButDelegationExists() public {
        WidenedAuthorityConfig memory config = _widenedConfig();
        MilestoneEscrow escrowWithInactiveDelegate = new MilestoneEscrow(_config(), _milestones(), config);

        bytes32 topologyKey = keccak256(abi.encode(BUYER_DELEGATE, uint256(15)));
        vm.store(address(escrowWithInactiveDelegate), topologyKey, bytes32(0));

        vm.prank(BUYER_DELEGATE);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDelegateOrTopology.selector));
        escrowWithInactiveDelegate.fundMilestone(0);
    }

    function _config() internal view returns (DealConfig memory) {
        return DealConfig({
            buyer: BUYER,
            seller: SELLER,
            arbiter: ARBITER,
            token: address(token),
            feeRecipient: FEE_RECIPIENT,
            protocolFeeBps: 100,
            metadataHash: keccak256("deal")
        });
    }

    function _milestones() internal pure returns (MilestoneConfig[] memory milestoneConfigs) {
        milestoneConfigs = new MilestoneConfig[](2);
        milestoneConfigs[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });
        milestoneConfigs[1] = MilestoneConfig({ amount: 2_000e6, reviewWindowSeconds: 5 days });
    }

    function _baseParticipants() internal pure returns (TopologyParticipant[] memory participants) {
        participants = new TopologyParticipant[](6);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        participants[2] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        participants[3] = TopologyParticipant(BUYER_DELEGATE, ParticipantRole.Observer, true);
        participants[4] = TopologyParticipant(SELLER_DELEGATE, ParticipantRole.Observer, true);
        participants[5] = TopologyParticipant(ARBITER_DELEGATE, ParticipantRole.Observer, true);
    }

    function _baseParticipantsWithoutBuyer() internal pure returns (TopologyParticipant[] memory participants) {
        participants = new TopologyParticipant[](5);
        participants[0] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        participants[1] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        participants[2] = TopologyParticipant(BUYER_DELEGATE, ParticipantRole.Observer, true);
        participants[3] = TopologyParticipant(SELLER_DELEGATE, ParticipantRole.Observer, true);
        participants[4] = TopologyParticipant(ARBITER_DELEGATE, ParticipantRole.Observer, true);
    }

    function _baseParticipantsWithoutSeller()
        internal
        pure
        returns (TopologyParticipant[] memory participants)
    {
        participants = new TopologyParticipant[](5);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        participants[2] = TopologyParticipant(BUYER_DELEGATE, ParticipantRole.Observer, true);
        participants[3] = TopologyParticipant(SELLER_DELEGATE, ParticipantRole.Observer, true);
        participants[4] = TopologyParticipant(ARBITER_DELEGATE, ParticipantRole.Observer, true);
    }

    function _baseParticipantsWithoutArbiter()
        internal
        pure
        returns (TopologyParticipant[] memory participants)
    {
        participants = new TopologyParticipant[](5);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        participants[2] = TopologyParticipant(BUYER_DELEGATE, ParticipantRole.Observer, true);
        participants[3] = TopologyParticipant(SELLER_DELEGATE, ParticipantRole.Observer, true);
        participants[4] = TopologyParticipant(ARBITER_DELEGATE, ParticipantRole.Observer, true);
    }

    function _widenedConfigWithParticipants(TopologyParticipant[] memory participants)
        internal
        pure
        returns (WidenedAuthorityConfig memory config)
    {
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](3);
        delegations[0] = DelegatedAuthority(
            BUYER,
            BUYER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Fund))
                | uint32(1 << uint8(AuthorityAction.Approve))
                | uint32(1 << uint8(AuthorityAction.Dispute)),
            true
        );
        delegations[1] = DelegatedAuthority(
            SELLER,
            SELLER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Submit))
                | uint32(1 << uint8(AuthorityAction.Claim)),
            true
        );
        delegations[2] = DelegatedAuthority(
            ARBITER,
            ARBITER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Resolve)),
            true
        );

        config = WidenedAuthorityConfig({
            modelVersion: AUTHORITY_MODEL_WIDENED_V1,
            participants: participants,
            delegations: delegations
        });
    }

    function _widenedConfig() internal pure returns (WidenedAuthorityConfig memory config) {
        TopologyParticipant[] memory participants = new TopologyParticipant[](7);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        participants[2] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        participants[3] = TopologyParticipant(BUYER_DELEGATE, ParticipantRole.Observer, true);
        participants[4] = TopologyParticipant(SELLER_DELEGATE, ParticipantRole.Observer, true);
        participants[5] = TopologyParticipant(ARBITER_DELEGATE, ParticipantRole.Observer, true);
        participants[6] = TopologyParticipant(INACTIVE_TOPOLOGY_MEMBER, ParticipantRole.Observer, false);

        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](3);
        delegations[0] = DelegatedAuthority(
            BUYER,
            BUYER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Fund))
                | uint32(1 << uint8(AuthorityAction.Approve))
                | uint32(1 << uint8(AuthorityAction.Dispute)),
            true
        );
        delegations[1] = DelegatedAuthority(
            SELLER,
            SELLER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Submit))
                | uint32(1 << uint8(AuthorityAction.Claim)),
            true
        );
        delegations[2] = DelegatedAuthority(
            ARBITER,
            ARBITER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Resolve)),
            true
        );

        config = WidenedAuthorityConfig({
            modelVersion: AUTHORITY_MODEL_WIDENED_V1,
            participants: participants,
            delegations: delegations
        });
    }

    function _mvpWidenedConfig() internal pure returns (WidenedAuthorityConfig memory config) {
        TopologyParticipant[] memory participants = new TopologyParticipant[](0);
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](0);
        config = WidenedAuthorityConfig({ modelVersion: 0, participants: participants, delegations: delegations });
    }
}
