// SPDX-License-Identifier: MIT
pragma solidity =0.5.16;

// Pulls the canonical Uniswap V2 core sources into the compilation unit so
// Hardhat emits artifacts for them and the tests / local deploys can use the
// real contracts instead of mocks. Nothing here is deployed directly.
import {UniswapV2Factory} from "@uniswap/v2-core/contracts/UniswapV2Factory.sol";
import {UniswapV2Pair} from "@uniswap/v2-core/contracts/UniswapV2Pair.sol";
