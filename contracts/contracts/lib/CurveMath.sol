// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title CurveMath
/// @notice Pure helpers for the constant-product, virtual-reserve bonding curve.
/// @dev All rounding is biased in the curve's favour: outputs round down, required
///      inputs round up, fees round down. Accumulated rounding can therefore only
///      ever be slack the contract holds on top of what it owes — never a deficit.
library CurveMath {
    uint256 internal constant BPS = 10_000;

    error InsufficientInputAmount();
    error InsufficientLiquidity();
    error InsufficientOutputReserve();
    error InvalidFee();

    /// @notice Constant-product output for `amountIn`, rounded down.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        if (amountIn == 0) revert InsufficientInputAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        return Math.mulDiv(amountIn, reserveOut, reserveIn + amountIn); // floor
    }

    /// @notice Constant-product input required to receive exactly `amountOut`, rounded up.
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        if (amountOut == 0) revert InsufficientInputAmount();
        if (reserveIn == 0) revert InsufficientLiquidity();
        if (amountOut >= reserveOut) revert InsufficientOutputReserve();
        return Math.mulDiv(reserveIn, amountOut, reserveOut - amountOut, Math.Rounding.Ceil);
    }

    /// @notice Fee portion of `amount` at `feeBps`, rounded down.
    function feeOf(uint256 amount, uint16 feeBps) internal pure returns (uint256) {
        return Math.mulDiv(amount, feeBps, BPS); // floor
    }

    /// @notice `shareBps` portion of `amount`, rounded down. Caller keeps the remainder.
    function share(uint256 amount, uint16 shareBps) internal pure returns (uint256) {
        return Math.mulDiv(amount, shareBps, BPS); // floor
    }

    /// @notice Smallest gross amount whose post-fee remainder is at least `net`, rounded up.
    function grossForNet(uint256 net, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps == 0) return net;
        if (feeBps >= BPS) revert InvalidFee();
        return Math.mulDiv(net, BPS, BPS - feeBps, Math.Rounding.Ceil);
    }

    /// @notice Cumulative native currency raised by the time `tokensSold == amountSold`.
    /// @dev e(s) = VE * s / (VT - s), where k = VE * VT. Rounds down.
    function raisedAt(uint256 amountSold, uint256 virtualEthReserve, uint256 virtualTokenReserve)
        internal
        pure
        returns (uint256)
    {
        if (amountSold >= virtualTokenReserve) revert InsufficientOutputReserve();
        return Math.mulDiv(virtualEthReserve, amountSold, virtualTokenReserve - amountSold);
    }
}
