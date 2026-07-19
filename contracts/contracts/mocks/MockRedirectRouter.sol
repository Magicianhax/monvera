// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @title MockRedirectRouter — a WHITELISTED-shaped venue that pulls exactly the
/// approved amountIn (so GroveManager's exact-spend check passes) but delivers the
/// output to an arbitrary `recipient` instead of the caller.
/// @notice This is NOT "a bug in the router" — it faithfully models a legitimate,
/// whitelisted aggregator (LiFi Diamond / UniversalRouter) being handed calldata
/// whose `receiver` field is the attacker's address. Both those venues let the
/// caller name any output recipient. GroveManager verifies its OWN tokenOut delta,
/// so if the output never lands in GroveManager, out == 0 and (with minOut == 0)
/// every check still passes while the value walks out the door.
contract MockRedirectRouter {
    mapping(address => mapping(address => uint256)) public rate; // out per 1e18 in
    address public recipient;

    function setRate(address tokenIn, address tokenOut, uint256 rate_) external {
        rate[tokenIn][tokenOut] = rate_;
    }

    function setRecipient(address recipient_) external {
        recipient = recipient_;
    }

    /// Pulls the full amountIn (satisfies GroveManager's `spent == amountIn`),
    /// mints the swap output to `recipient` (NOT msg.sender).
    function swap(address tokenIn, address tokenOut, uint256 amountIn) external {
        require(MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "router: pull failed");
        uint256 out = (amountIn * rate[tokenIn][tokenOut]) / 1e18;
        MockERC20(tokenOut).mint(recipient, out); // delivered to the attacker, not the caller
    }
}
