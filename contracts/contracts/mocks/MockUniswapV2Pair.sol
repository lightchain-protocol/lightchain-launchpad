// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Minimal Uniswap-V2-style pair for tests: an ERC20 LP token over two reserves.
///      Only the bits the launchpad touches are implemented (`getReserves`, `mint`,
///      `token0`). Trading on the pool isn't exercised by the suite.
contract MockUniswapV2Pair is ERC20 {
    address public token0;
    address public token1;
    uint112 private _reserve0;
    uint112 private _reserve1;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address private constant BURN = 0x000000000000000000000000000000000000dEaD;

    constructor(address tokenA, address tokenB) ERC20("Mock LP", "MLP") {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        return (_reserve0, _reserve1, 0);
    }

    function mint(address to) external returns (uint256 liquidity) {
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = bal0 - _reserve0;
        uint256 amount1 = bal1 - _reserve1;
        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(BURN, MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min((amount0 * supply) / _reserve0, (amount1 * supply) / _reserve1);
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);
        _reserve0 = uint112(bal0);
        _reserve1 = uint112(bal1);
    }

    /// @dev test helper: seed the pool's accounted reserves to simulate a pre-seeded pair.
    function syncFromBalances() external {
        _reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        _reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
    }
}
