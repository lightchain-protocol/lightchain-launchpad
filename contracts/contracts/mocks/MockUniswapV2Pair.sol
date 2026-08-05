// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Minimal Uniswap-V2-style pair for tests: an ERC20 LP token over two reserves.
///      Supports mint (liquidity) and swap so local Anvil can exercise post-graduation DEX trades.
contract MockUniswapV2Pair is ERC20 {
    address public token0;
    address public token1;
    uint112 private _reserve0;
    uint112 private _reserve1;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address private constant BURN = 0x000000000000000000000000000000000000dEaD;

    event Sync(uint112 reserve0, uint112 reserve1);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );

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
        _update(bal0, bal1);
    }

    /// @dev Uniswap V2-compatible swap. Caller must have already transferred the input
    ///      token(s) into the pair; outputs are sent to `to`.
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        require(amount0Out > 0 || amount1Out > 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        (uint112 r0, uint112 r1) = (_reserve0, _reserve1);
        require(amount0Out < r0 && amount1Out < r1, "INSUFFICIENT_LIQUIDITY");
        require(to != token0 && to != token1, "INVALID_TO");

        if (amount0Out > 0) IERC20(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).transfer(to, amount1Out);

        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));

        uint256 amount0In = bal0 > uint256(r0) - amount0Out ? bal0 - (uint256(r0) - amount0Out) : 0;
        uint256 amount1In = bal1 > uint256(r1) - amount1Out ? bal1 - (uint256(r1) - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "INSUFFICIENT_INPUT_AMOUNT");

        // x*y=k with 0.3% fee (Uniswap V2)
        uint256 bal0Adjusted = (bal0 * 1000) - (amount0In * 3);
        uint256 bal1Adjusted = (bal1 * 1000) - (amount1In * 3);
        require(bal0Adjusted * bal1Adjusted >= uint256(r0) * uint256(r1) * (1000 ** 2), "K");

        _update(bal0, bal1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @dev Uniswap V2 `IUniswapV2Pair.sync()` — force reserves to match balances.
    function sync() external {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    /// @dev test helper: seed the pool's accounted reserves to simulate a pre-seeded pair.
    function syncFromBalances() external {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _update(uint256 bal0, uint256 bal1) private {
        require(bal0 <= type(uint112).max && bal1 <= type(uint112).max, "OVERFLOW");
        _reserve0 = uint112(bal0);
        _reserve1 = uint112(bal1);
        emit Sync(_reserve0, _reserve1);
    }
}
