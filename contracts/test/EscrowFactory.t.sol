// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { EscrowFactory } from "src/EscrowFactory.sol";
import { MilestoneEscrow } from "src/MilestoneEscrow.sol";
import {
    AUTHORITY_MODEL_WIDENED_V1,
    AuthorityAction,
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
    ZeroAddress,
    InvalidPartyConfiguration,
    InvalidMilestoneCount,
    InvalidMilestoneAmount,
    InvalidReviewWindow,
    InvalidFeeBps,
    InvalidMetadataHash,
    InvalidParticipantRole,
    InvalidDelegatedAuthority,
    DuplicateDelegation,
    PrivilegeEscalation,
    Unauthorized,
    CreationPaused
} from "src/MilestackErrors.sol";
import { DeployEscrowFactory } from "script/DeployEscrowFactory.s.sol";

contract EscrowFactoryTest is Test {
    string internal constant DEPLOYER_PRIVATE_KEY = "DEPLOYER_PRIVATE_KEY";
    string internal constant USDC_ADDRESS_KEY = "USDC_ADDRESS";
    string internal constant FEE_RECIPIENT_KEY = "FEE_RECIPIENT";
    string internal constant PROTOCOL_FEE_BPS_KEY = "PROTOCOL_FEE_BPS";

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
        assertEq(escrow.metadataHash(), METADATA_HASH);
    }

    function testCreateEscrowWidenedRejectsParticipantWithNoneRole() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.participants[3].role = ParticipantRole.None;

        vm.expectRevert(abi.encodeWithSelector(InvalidParticipantRole.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsInactiveCanonicalParty() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.participants[1].active = false;

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsCanonicalBuyerWithWrongRole() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.participants[0].role = ParticipantRole.Observer;

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsCanonicalArbiterWithWrongRole() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.participants[2].role = ParticipantRole.Seller;

        vm.expectRevert(abi.encodeWithSelector(InvalidPartyConfiguration.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsDelegationFromUnknownDelegator() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.delegations[0].delegator = address(0xDEAD);

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsDelegationToInactiveDelegate() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.participants[3].active = false;

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsDelegationToUnknownDelegate() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.delegations[0].delegate = address(0xFACE);

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsInactiveDelegation() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.delegations[0].active = false;

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsInactiveDelegatorParticipant() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        address observer = config.participants[3].account;

        config.participants[3].active = false;
        config.delegations[0] = DelegatedAuthority(
            observer,
            BUYER,
            uint32(1 << uint8(AuthorityAction.Fund)),
            true
        );

        vm.expectRevert(abi.encodeWithSelector(InvalidDelegatedAuthority.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedRejectsDuplicateDelegationPair() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();

        DelegatedAuthority[] memory duplicativeDelegations = new DelegatedAuthority[](2);
        duplicativeDelegations[0] = config.delegations[0];
        duplicativeDelegations[1] = config.delegations[0];
        config.delegations = duplicativeDelegations;

        vm.expectRevert(abi.encodeWithSelector(DuplicateDelegation.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testCreateEscrowWidenedAllowsArbiterResolveDelegation() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        config.delegations[0] = DelegatedAuthority(
            ARBITER,
            config.participants[3].account,
            uint32(1 << uint8(AuthorityAction.Resolve)),
            true
        );

        address escrow = factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
        assertTrue(escrow != address(0));
    }

    function testCreateEscrowWidenedRejectsObserverDelegationPermissions() public {
        WidenedAuthorityConfig memory config = _validWidenedConfig();
        address outsider = address(0xF00D);

        TopologyParticipant[] memory participants = new TopologyParticipant[](5);
        for (uint256 i = 0; i < 4; i++) {
            participants[i] = config.participants[i];
        }
        participants[4] = TopologyParticipant(outsider, ParticipantRole.Observer, true);
        config.participants = participants;

        config.delegations[0].delegator = outsider;

        vm.expectRevert(abi.encodeWithSelector(PrivilegeEscalation.selector));
        factory.createEscrowWidened(BUYER, SELLER, ARBITER, METADATA_HASH, _milestones(), config);
    }

    function testDeployScriptRunDeploysFactoryFromEnv() public {
        uint256 deployerPrivateKey = 0xA11CE;
        address deployer = vm.addr(deployerPrivateKey);
        address scriptUsdc = address(0x1234);
        address scriptFeeRecipient = address(0x5678);
        uint16 scriptFeeBps = 250;

        vm.setEnv(DEPLOYER_PRIVATE_KEY, vm.toString(deployerPrivateKey));
        vm.setEnv(USDC_ADDRESS_KEY, vm.toString(scriptUsdc));
        vm.setEnv(FEE_RECIPIENT_KEY, vm.toString(scriptFeeRecipient));
        vm.setEnv(PROTOCOL_FEE_BPS_KEY, vm.toString(uint256(scriptFeeBps)));

        uint256 deployerBalanceBefore = deployer.balance;

        DeployEscrowFactory script = new DeployEscrowFactory();
        EscrowFactory deployedFactory = script.run();

        assertEq(deployedFactory.usdc(), scriptUsdc);
        assertEq(deployedFactory.feeRecipient(), scriptFeeRecipient);
        assertEq(deployedFactory.protocolFeeBps(), scriptFeeBps);
        assertEq(deployedFactory.owner(), deployer);
        assertEq(deployer.balance, deployerBalanceBefore);
    }

    function testDeployScriptRunRevertsWhenProtocolFeeBpsOverflowsUint16() public {
        uint256 deployerPrivateKey = 0xA11CE;

        vm.setEnv(DEPLOYER_PRIVATE_KEY, vm.toString(deployerPrivateKey));
        vm.setEnv(USDC_ADDRESS_KEY, vm.toString(address(0x1234)));
        vm.setEnv(FEE_RECIPIENT_KEY, vm.toString(address(0x5678)));
        vm.setEnv(PROTOCOL_FEE_BPS_KEY, vm.toString(uint256(type(uint16).max) + 1));

        DeployEscrowFactory script = new DeployEscrowFactory();
        vm.expectRevert(bytes("PROTOCOL_FEE_BPS_OVERFLOW"));
        script.run();

        vm.setEnv(PROTOCOL_FEE_BPS_KEY, vm.toString(uint256(250)));
    }

    function _milestones() internal pure returns (MilestoneConfig[] memory milestones) {
        milestones = new MilestoneConfig[](2);
        milestones[0] = MilestoneConfig({ amount: 1_000e6, reviewWindowSeconds: 5 days });
        milestones[1] = MilestoneConfig({ amount: 2_000e6, reviewWindowSeconds: 5 days });
    }

    function _validWidenedConfig() internal pure returns (WidenedAuthorityConfig memory config) {
        address observer = address(0x0B5E);

        TopologyParticipant[] memory participants = new TopologyParticipant[](4);
        participants[0] = TopologyParticipant(BUYER, ParticipantRole.Buyer, true);
        participants[1] = TopologyParticipant(SELLER, ParticipantRole.Seller, true);
        participants[2] = TopologyParticipant(ARBITER, ParticipantRole.Arbiter, true);
        participants[3] = TopologyParticipant(observer, ParticipantRole.Observer, true);

        DelegatedAuthority[] memory delegations = new DelegatedAuthority[](1);
        delegations[0] = DelegatedAuthority(
            BUYER,
            observer,
            uint32(1 << uint8(AuthorityAction.Fund)),
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
