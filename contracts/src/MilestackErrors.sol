// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

error ZeroAddress();
error InvalidPartyConfiguration();
error InvalidMilestoneCount();
error InvalidMilestoneAmount();
error InvalidReviewWindow();
error InvalidFeeBps();
error InvalidMetadataHash();
error InvalidAuthorityModelVersion();
error InvalidTopologyParticipant();
error InvalidParticipantRole();
error DuplicateTopologyParticipant();
error InvalidDelegatedAuthority();
error DuplicateDelegation();
error SelfDelegation();
error PrivilegeEscalation();
error CreationPaused();

error Unauthorized();
error UnauthorizedDelegateOrTopology();
error InvalidDealState();
error InvalidMilestoneState();
error InvalidMilestoneIndex();
error InvalidMilestoneSequence();
error ActiveDisputeExists();
error NoActiveDispute();
error DeadlineNotReached();
error DeadlinePassed();
error InvalidEvidenceHash();
error InvalidDisputeHash();
error InvalidResolutionSplit();
error NothingToCancel();
