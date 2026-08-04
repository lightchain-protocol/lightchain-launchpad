// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MockUniswapV2Factory} from "./MockUniswapV2Factory.sol";
import {MockUniswapV2Pair} from "./MockUniswapV2Pair.sol";
import {MockWETH} from "./MockWETH.sol";

/// @dev Uniswap-V2-style router for local/dev: liquidity (graduation) + ETH↔token swaps
///      used by the frontend after a token graduates.
contract MockUniswapV2Router {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public immutable WETH;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH = weth_;
    }

    receive() external payable {
        require(msg.sender == WETH, "ONLY_WETH");
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

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / ((reserveIn * 1000) + amountInWithFee);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountIn)
    {
        require(amountOut > 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > amountOut, "INSUFFICIENT_LIQUIDITY");
        uint256 numerator = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        amountIn = (numerator / denominator) + 1;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        require(path.length == 2, "INVALID_PATH");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        address pair = MockUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "PAIR_NOT_FOUND");
        (uint256 rIn, uint256 rOut) = _reservesFor(pair, path[0]);
        amounts[1] = getAmountOut(amountIn, rIn, rOut);
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        require(path.length == 2, "INVALID_PATH");
        amounts = new uint256[](2);
        amounts[1] = amountOut;
        address pair = MockUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "PAIR_NOT_FOUND");
        (uint256 rIn, uint256 rOut) = _reservesFor(pair, path[0]);
        amounts[0] = getAmountIn(amountOut, rIn, rOut);
    }

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts)
    {
        require(deadline >= block.timestamp, "EXPIRED");
        require(path.length == 2 && path[0] == WETH, "INVALID_PATH");

        amounts = new uint256[](2);
        amounts[0] = msg.value;
        address pair = MockUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "PAIR_NOT_FOUND");
        (uint256 rIn, uint256 rOut) = _reservesFor(pair, WETH);
        amounts[1] = getAmountOut(msg.value, rIn, rOut);
        require(amounts[1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        MockWETH(payable(WETH)).deposit{value: msg.value}();
        IERC20(WETH).safeTransfer(pair, msg.value);
        _swap(pair, path[0], path[1], amounts[1], to);
    }

    function swapETHForExactTokens(uint256 amountOut, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts)
    {
        require(deadline >= block.timestamp, "EXPIRED");
        require(path.length == 2 && path[0] == WETH, "INVALID_PATH");

        amounts = new uint256[](2);
        amounts[1] = amountOut;
        address pair = MockUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "PAIR_NOT_FOUND");
        (uint256 rIn, uint256 rOut) = _reservesFor(pair, WETH);
        amounts[0] = getAmountIn(amountOut, rIn, rOut);
        require(msg.value >= amounts[0], "INSUFFICIENT_INPUT_AMOUNT");

        MockWETH(payable(WETH)).deposit{value: amounts[0]}();
        IERC20(WETH).safeTransfer(pair, amounts[0]);
        _swap(pair, path[0], path[1], amountOut, to);

        if (msg.value > amounts[0]) {
            (bool ok,) = msg.sender.call{value: msg.value - amounts[0]}("");
            require(ok, "REFUND_FAIL");
        }
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "EXPIRED");
        require(path.length == 2 && path[1] == WETH, "INVALID_PATH");

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        address pair = MockUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "PAIR_NOT_FOUND");
        (uint256 rIn, uint256 rOut) = _reservesFor(pair, path[0]);
        amounts[1] = getAmountOut(amountIn, rIn, rOut);
        require(amounts[1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        IERC20(path[0]).safeTransferFrom(msg.sender, pair, amountIn);
        _swap(pair, path[0], path[1], amounts[1], address(this));
        MockWETH(payable(WETH)).withdraw(amounts[1]);
        (bool ok,) = to.call{value: amounts[1]}("");
        require(ok, "ETH_TRANSFER_FAIL");
    }

    function _swap(address pair, address tokenIn, address tokenOut, uint256 amountOut, address to) internal {
        (address t0,) = tokenIn < tokenOut ? (tokenIn, tokenOut) : (tokenOut, tokenIn);
        (uint256 amount0Out, uint256 amount1Out) = tokenIn == t0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
        MockUniswapV2Pair(pair).swap(amount0Out, amount1Out, to, new bytes(0));
    }

    function _reservesFor(address pair, address tokenAddr) internal view returns (uint256 rToken, uint256 rOther) {
        (uint112 r0, uint112 r1,) = MockUniswapV2Pair(pair).getReserves();
        return tokenAddr == MockUniswapV2Pair(pair).token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }
}
