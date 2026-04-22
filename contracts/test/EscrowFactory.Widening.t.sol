// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { EscrowFactory } from "src/EscrowFactory.sol";
import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import {
    AUTHORITY_MODEL_MVP,
    AUTHORITY_MODEL_WIDENED_V1,
    AuthorityAction,
    DelegatedAuthority,
    MilestoneConfig,
    ParticipantRole,
    TopologyParticipant,
    WidenedAuthorityConfig
} from "src/MilestackTypes.sol";
import {
    InvalidAuthorityModelVersion,
    InvalidDelegatedAuthority,
    InvalidPartyConfiguration,
    InvalidTopologyParticipant,
    DuplicateTopologyParticipant,
    DuplicateDelegation,
    PrivilegeEscalation,
    SelfDelegation
} from "src/MilestackErrors.sol";

contract EscrowFactoryWideningTest is Test {
    address internal constant USDC = address(0x1001);
    address internal constant FEE_RECIPIENT = address(0x1002);
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);
    address internal constant ARBITER = address(0xCAFE);
    address internal constant BUYER_DELEGATE = address(0xB0D1);

    bytes32 internal constant METADATA_HASH = keccak256("deal-metadata");

    EscrowFactory internal factory;

    function setUp() public {
        factory = new EscrowFactory(USDC, FEE_RECIPIENT, 100);
    }

    function testMvpCreateEscrowStillDeploysMvpAuthorityModel() public {
        address escrowAddress =
            factory.createEscrow(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones());

        MilestoneEscrow escrow = MilestoneEscrow(escrowAddress);
        assertEq(escrow.authorityModelVersion(), AUTHORITY_MODEL_MVP);
    }

    function testCreateEscrowWidenedDeploysWidenedAuthorityModel() public {
        address escrowAddress = factory.createEscrowWidened(
            BUYER,
            SELLER,
            ARBITER,
            METADATA_HASH,
            _milestones(),
            _defaultWidenedConfig()
        );

        MilestoneEscrow escrow = MilestoneEscrow(escrowAddress);
        assertEq(escrow.authorityModelVersion(), AUTHORITY_MODEL_WIDENED_V1);
        assertEq(uint8(escrow.topologyRole(BUYER)), uint8(ParticipantRole.Buyer));
        assertEq(escrow.topologyActive(BUYER), true);
        assertEq(
            escrow.delegatedPermissions(BUYER, BUYER_DELEGATE),
            uint32(1 << uint8(AuthorityAction.Fund))
        );
    }

    function testCreateEscrowWidenedRevertsForUnsupportedModelVersion() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        config.modelVersion = 2;

        vm.expectRevert(abi.encodeWithSelector(InvalidAuthorityModelVersion.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRevertsForDuplicateParticipants() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        participants[2] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        participants[3] = TopologyParticipant(BUYER, ParticipantRole.Observer, true);
        config.participants = participants;

        vm.expectRevert(abi.encodeWithSelector(DuplicateTopologyParticipant.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRevertsForZeroParticipantAddress() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        TopologyParticipant[] memory participants = new TopologyParticipant[](3);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(address(0), ParticipantRole.Seller, true);
        participants[2] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        config.participants = participants;

        vm.expectRevert(abi.encodeWithSelector(InvalidTopologyParticipant.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRevertsWhenCanonicalRolesMissing() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        TopologyParticipant[] memory participants = new TopologyParticipant[](2);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        config.participants = participants;

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRevertsForDuplicateDelegationPair() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](2);
        uint32 fundPermission = uint32(1 << uint8(AuthorityAction.Fund));
        delegations[0] = DelegatedAuthority(BUYER, BUYER_DELEGATE, fundPermission, true);
        delegations[1] = DelegatedAuthority(BUYER, BUYER_DELEGATE, fundPermission, true);
        config.delegations = delegations;

        vm.expectRevert(abi.encodeWithSelector(DuplicateDelegation.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRevertsForSelfDelegationLoop() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](1);
        delegations[0] = DelegatedAuthority(
            BUYER,
            BUYER,
            uint32(1 << uint8(AuthorityAction.Fund)),
            true
        );
        config.delegations = delegations;

        vm.expectRevert(abi.encodeWithSelector(SelfDelegation.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRevertsForZeroDelegationAddress() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](1);
        delegations[0] = DelegatedAuthority(
            BUYER,
            address(0),
            uint32(1 << uint8(AuthorityAction.Fund)),
            true
        );
        config.delegations = delegations;

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRevertsForPrivilegeEscalation() public {
        WidenedAuthorityConfig memory config = _defaultWidenedConfig();
        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](1);
        delegations[0] = DelegatedAuthority(
            SELLER,
            BUYER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Resolve)),
            true
        );
        config.delegations = delegations;

        vm.expectRevert(abi.encodeWithSelector(PrivilegeEscalation.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function _milestones() internal pure returns (MilestoneConfig[] memory milestones) {
        milestones = new MilestoneConfig[](1);
        milestones[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });
    }

    function _defaultWidenedConfig() internal pure returns (WidenedAuthorityConfig memory config) {
        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        participants[2] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        participants[3] = TopologyParticipant(BUYER_DELEGATE, ParticipantRole.Observer, true);

        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](1);
        delegations[0] = DelegatedAuthority(
            BUYER,
            BUYER_DELEGATE,
            uint32(1 << uint8(AuthorityAction.Fund)),
            true
        );

        config = WidenedAuthorityConfig({
            modelVersion: AUTHORITY_MODEL_WIDENED_V1,
            participants: participants,
            delegations: delegations
        });
    }
}
