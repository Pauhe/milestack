// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";

import { EscrowFactory } from "src/EscrowFactory.sol";

contract DeployEscrowFactory is Script {
    function run() external returns (EscrowFactory deployedFactory) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        uint256 rawProtocolFeeBps = vm.envUint("PROTOCOL_FEE_BPS");
        require(rawProtocolFeeBps <= type(uint16).max, "PROTOCOL_FEE_BPS_OVERFLOW");
        uint16 protocolFeeBps = uint16(rawProtocolFeeBps);

        vm.startBroadcast(deployerPrivateKey);
        deployedFactory = new EscrowFactory(usdc, feeRecipient, protocolFeeBps);
        vm.stopBroadcast();
    }
}
