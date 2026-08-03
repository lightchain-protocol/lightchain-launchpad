// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title Token
/// @notice Plain, ownerless ERC20 used for every launch. Fixed supply, 18 decimals,
///         no mint after construction, no transfer tax, no hooks. The full supply is
///         minted to the launch's BondingCurve, which sells it and burns whatever is
///         left over at graduation. `ERC20Burnable` lets the curve burn the remainder
///         (any holder may also burn their own balance — harmless).
contract Token is ERC20, ERC20Burnable {
    constructor(string memory name_, string memory symbol_, uint256 supply_, address mintTo_)
        ERC20(name_, symbol_)
    {
        _mint(mintTo_, supply_);
    }
}
