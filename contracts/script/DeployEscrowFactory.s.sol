// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";

import { EscrowFactory } from "src/EscrowFactory.sol";

contract DeployEscrowFactory is Script {
    function run() external returns (EscrowFactory deployedFactory) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint16 protocolFeeBps = uint16(vm.envUint("PROTOCOL_FEE_BPS"));

        vm.startBroadcast();
        deployedFactory = new EscrowFactory(usdc, feeRecipient, protocolFeeBps);
        vm.stopBroadcast();
    }
}
