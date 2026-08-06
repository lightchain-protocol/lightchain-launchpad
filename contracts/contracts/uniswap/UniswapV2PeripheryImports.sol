// SPDX-License-Identifier: MIT
pragma solidity =0.6.6;

// WETH9 is the canonical wrapped-native contract the Uniswap V2 router expects.
// Imported so Hardhat emits an artifact for it; nothing here is deployed
// directly. UniswapV2Router02 lives in its own file because it needs the local
// UniswapV2Library (see the note there).
import {WETH9} from "@uniswap/v2-periphery/contracts/test/WETH9.sol";
