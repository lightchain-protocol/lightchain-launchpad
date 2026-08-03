// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Pulls ERC1967Proxy into the compilation unit so Hardhat produces its artifact.
// The deploy script wires the LaunchpadFactory implementation behind one of these.
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
