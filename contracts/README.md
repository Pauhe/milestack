# Contracts

This directory contains the Milestack smart contract workspace.

## Intended Tooling

- Foundry for compilation and tests
- Anvil for local chain testing

## Current State

The environment used to scaffold this repo does not have `forge` installed, so this workspace was created manually in Foundry layout.

Planned first implementation steps:
1. define shared types, enums, events, and custom errors
2. implement `EscrowFactory`
3. implement `MilestoneEscrow`
4. add unit tests, then fuzz/invariant tests

## Structure

- `src/`: Solidity source files
- `test/`: contract tests
- `script/`: deployment and utility scripts
- `lib/`: external dependencies
