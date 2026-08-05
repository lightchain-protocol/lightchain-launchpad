// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Launchpad} from "../Launchpad.sol";

interface IBuyLaunchpad {
    function buy(address token, uint256 minTokensOut) external payable returns (uint256);
}

/// @dev On receiving native (e.g. a buy refund) it re-enters the launchpad's `buy`, which the
///      launchpad's reentrancy guard must reject — bubbling the revert out of the original call.
contract ReentrantBuyer {
    address public launchpad;
    address public token;

    function setTarget(address launchpad_, address token_) external {
        launchpad = launchpad_;
        token = token_;
    }

    function attackBuy(uint256 minTokensOut) external payable returns (uint256) {
        return IBuyLaunchpad(launchpad).buy{value: msg.value}(token, minTokensOut);
    }

    receive() external payable {
        // re-entrancy attempt; expected to revert under the launchpad's nonReentrant guard
        IBuyLaunchpad(launchpad).buy{value: 1}(token, 0);
    }
}

/// @dev Always reverts on receiving native — used to check fee withdrawal to a bad address fails
///      while not bricking core flows (creation fees are pull-based, not pushed).
contract RevertingReceiver {
    receive() external payable {
        revert("RevertingReceiver: nope");
    }
}

/// @dev Mirrors the DAO Treasury's `receive()` (emits one event) so the fee-push
///      gas budget is exercised against the shape of the real recipient.
contract EventEmittingTreasury {
    event FundsReceived(address indexed from, uint256 amount);

    uint256 public totalReceived;

    receive() external payable {
        totalReceived += msg.value;
        emit FundsReceived(msg.sender, msg.value);
    }
}

/// @dev Burns gas in an unbounded loop on receive. Without a gas cap on the fee
///      push this would consume 63/64 of the caller's gas and brick the launch.
contract GasGriefingTreasury {
    uint256 public sink;

    receive() external payable {
        while (true) {
            sink++;
        }
    }
}

/// @dev V2 of the launchpad implementation, used to exercise the UUPS upgrade path.
contract LaunchpadV2 is Launchpad {
    function version() external pure returns (uint256) {
        return 2;
    }
}
