// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MockUniswapV2Factory} from "./MockUniswapV2Factory.sol";
import {MockUniswapV2Pair} from "./MockUniswapV2Pair.sol";
import {MockWETH} from "./MockWETH.sol";

/// @dev Minimal Uniswap-V2-style router for tests: implements only `factory()`,
///      `WETH()` and `addLiquidityETH(...)` — the surface the launchpad uses.
contract MockUniswapV2Router {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public immutable WETH;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH = weth_;
    }

    function addLiquidityETH(
        address tokenAddr,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(deadline >= block.timestamp, "EXPIRED");

        address pair = MockUniswapV2Factory(factory).getPair(tokenAddr, WETH);
        if (pair == address(0)) pair = MockUniswapV2Factory(factory).createPair(tokenAddr, WETH);

        (uint256 rToken, uint256 rEth) = _reservesFor(pair, tokenAddr);
        if (rToken == 0 && rEth == 0) {
            (amountToken, amountETH) = (amountTokenDesired, msg.value);
        } else {
            uint256 ethOptimal = (amountTokenDesired * rEth) / rToken;
            if (ethOptimal <= msg.value) {
                (amountToken, amountETH) = (amountTokenDesired, ethOptimal);
            } else {
                (amountToken, amountETH) = ((msg.value * rToken) / rEth, msg.value);
            }
        }
        require(amountToken >= amountTokenMin, "INSUFFICIENT_TOKEN");
        require(amountETH >= amountETHMin, "INSUFFICIENT_ETH");

        IERC20(tokenAddr).safeTransferFrom(msg.sender, pair, amountToken);
        MockWETH(payable(WETH)).deposit{value: amountETH}();
        IERC20(WETH).safeTransfer(pair, amountETH);
        liquidity = MockUniswapV2Pair(pair).mint(to);

        if (msg.value > amountETH) {
            (bool ok,) = msg.sender.call{value: msg.value - amountETH}("");
            require(ok, "REFUND_FAIL");
        }
    }

    function _reservesFor(address pair, address tokenAddr) internal view returns (uint256 rToken, uint256 rEth) {
        (uint112 r0, uint112 r1,) = MockUniswapV2Pair(pair).getReserves();
        return tokenAddr == MockUniswapV2Pair(pair).token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }
}
