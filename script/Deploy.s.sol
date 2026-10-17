// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Partner} from "../src/Partner.sol";

/// @notice Deploy Partner to the configured network.
/// @dev Local:
///        forge script script/Deploy.s.sol
///      Sepolia (keys come from .env, never hardcoded):
///        forge script script/Deploy.s.sol \
///          --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external returns (Partner partner) {
        vm.startBroadcast();
        partner = new Partner();
        vm.stopBroadcast();

        console2.log("Partner deployed at:", address(partner));
    }
}
