// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @title MockPuller — stand-in for a venue whose approval spender differs from
/// the call target (the LiFi diamond/executor split). GroveManager approves THIS
/// contract; the router calls back into it to move the input funds.
contract MockPuller {
    function pull(address token, address from, address to, uint256 amount) external {
        require(MockERC20(token).transferFrom(from, to, amount), "MockPuller: pull failed");
    }
}

/// @title MockSwapRouter — a swap venue that can be told to misbehave.
/// @notice Swaps tokenIn -> tokenOut at a configurable rate (out = in * rate / 1e18),
/// minting the output to the caller. The knobs exist so tests can prove GroveManager
/// catches a lying venue via its own balance-delta verification:
///  - deliverBps < 10000: deliver less output than the rate promises (lying router);
///  - pullBps < 10000: consume only part of the approved input (partial pull);
///  - reenterTarget/reenterData: re-enter the caller mid-swap (reentrancy probe);
///  - puller: route the input pull through a separate spender contract
///    (approval-target != call-target, the LiFi shape).
contract MockSwapRouter {
    mapping(address => mapping(address => uint256)) public rate; // out per 1e18 in
    uint256 public deliverBps = 10_000;
    uint256 public pullBps = 10_000;
    address public reenterTarget;
    bytes public reenterData;
    address public puller;

    function setRate(address tokenIn, address tokenOut, uint256 rate_) external {
        rate[tokenIn][tokenOut] = rate_;
    }

    function setDeliverBps(uint256 bps) external {
        deliverBps = bps;
    }

    function setPullBps(uint256 bps) external {
        pullBps = bps;
    }

    function setReenter(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function setPuller(address puller_) external {
        puller = puller_;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn) external {
        uint256 pullAmount = (amountIn * pullBps) / 10_000;
        if (puller != address(0)) {
            MockPuller(puller).pull(tokenIn, msg.sender, address(this), pullAmount);
        } else {
            require(MockERC20(tokenIn).transferFrom(msg.sender, address(this), pullAmount), "router: pull failed");
        }

        uint256 out = (((amountIn * rate[tokenIn][tokenOut]) / 1e18) * deliverBps) / 10_000;
        MockERC20(tokenOut).mint(msg.sender, out);

        if (reenterTarget != address(0)) {
            (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
            if (!ok) {
                // Bubble the inner revert so the test sees the guard error.
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}
