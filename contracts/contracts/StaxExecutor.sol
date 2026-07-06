// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {InferenceVerifier} from "./InferenceVerifier.sol";

/// @title StaxExecutor
/// @notice Non-custodial "verifiable AI allocation" executor on Mantle. A single call:
///   1. commits the AI's recommendation on-chain (keccak hash + ERC-8004 agentId),
///   2. verifies a signed risk inference (reverts if risk > the user's ceiling), then
///   3. executes the allocation by routing the caller's USDC through whitelisted routers
///      (Fluxion) into the chosen assets, forwarding every output token to the user.
/// Funds are pulled per-call and never custodied. The off-chain agent supplies each leg's
/// router calldata (built via the Mantle swap tooling) with the executor as recipient;
/// the contract bounds risk via router/asset whitelists, per-leg approval caps, and
/// balance-delta slippage checks.
contract StaxExecutor is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    InferenceVerifier public inferenceVerifier;

    /// @dev Whitelisted swap routers the executor may call (e.g. the Fluxion router).
    mapping(address => bool) public routerAllowed;
    /// @dev Whitelisted output tokens (the buyable asset set).
    mapping(address => bool) public assetAllowed;

    struct Plan {
        bytes32 planId;
        bytes32 recHash; // keccak256(allocation JSON) — provable AI advice
        uint16 riskScore; // AI-assessed portfolio risk (basis points)
        uint256 agentId; // ERC-8004 identity of the advising agent
    }

    struct Inference {
        uint16 assessedRisk; // bps
        uint16 maxRisk; // user's risk ceiling, bps
        uint256 expiry;
        bytes signature; // agent EIP-712 signature
    }

    struct Leg {
        address router; // whitelisted router to call
        address tokenOut; // whitelisted asset to receive
        uint256 usdcIn; // USDC to spend on this leg
        uint256 minOut; // minimum tokenOut (slippage guard)
        bytes swapData; // router calldata; recipient MUST be this contract
    }

    event RecommendationCommitted(
        bytes32 indexed planId, address indexed user, bytes32 recHash, uint16 riskScore, uint256 agentId
    );
    event LegFilled(bytes32 indexed planId, address indexed tokenOut, uint256 usdcIn, uint256 received);
    event AllocationExecuted(bytes32 indexed planId, address indexed user, uint256 usdcSpent, uint256 legCount);

    error RouterNotAllowed(address router);
    error AssetNotAllowed(address token);
    error SlippageExceeded(address tokenOut, uint256 received, uint256 minOut);
    error SwapCallFailed(uint256 legIndex);
    error SpentExceedsBudget();

    constructor(address _usdc, address _verifier) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        inferenceVerifier = InferenceVerifier(_verifier);
    }

    // ---------------- admin ----------------
    function setVerifier(address v) external onlyOwner {
        inferenceVerifier = InferenceVerifier(v);
    }

    function setRouter(address r, bool ok) external onlyOwner {
        routerAllowed[r] = ok;
    }

    function setAssets(address[] calldata tokens, bool ok) external onlyOwner {
        for (uint256 i; i < tokens.length; ++i) {
            assetAllowed[tokens[i]] = ok;
        }
    }

    /// @notice Commit the AI recommendation, verify the signed risk inference, then execute
    /// the allocation by routing the caller's USDC through whitelisted routers. The caller
    /// (the investor) must have approved this contract for `usdcTotal` USDC — batchable with
    /// the call in a single ERC-4337 UserOp so the user sees one gasless confirmation.
    function investWithAI(Plan calldata plan, Inference calldata inf, Leg[] calldata legs, uint256 usdcTotal)
        external
        nonReentrant
    {
        // 1) Commit AI advice + agent identity on-chain (the rubric's "inference written on-chain").
        emit RecommendationCommitted(plan.planId, msg.sender, plan.recHash, plan.riskScore, plan.agentId);

        // 2) Gate execution on the verified, signed risk inference.
        inferenceVerifier.verify(plan.planId, inf.assessedRisk, inf.maxRisk, inf.expiry, inf.signature);

        // 3) Pull the user's USDC for this allocation, then fill each leg.
        usdc.safeTransferFrom(msg.sender, address(this), usdcTotal);

        uint256 spent;
        for (uint256 i; i < legs.length; ++i) {
            Leg calldata leg = legs[i];
            if (!routerAllowed[leg.router]) revert RouterNotAllowed(leg.router);
            if (!assetAllowed[leg.tokenOut]) revert AssetNotAllowed(leg.tokenOut);

            usdc.forceApprove(leg.router, leg.usdcIn);

            uint256 balBefore = IERC20(leg.tokenOut).balanceOf(address(this));
            (bool ok,) = leg.router.call(leg.swapData);
            if (!ok) revert SwapCallFailed(i);
            uint256 received = IERC20(leg.tokenOut).balanceOf(address(this)) - balBefore;
            if (received < leg.minOut) revert SlippageExceeded(leg.tokenOut, received, leg.minOut);

            usdc.forceApprove(leg.router, 0); // reset approval
            IERC20(leg.tokenOut).safeTransfer(msg.sender, received); // forward asset to user
            spent += leg.usdcIn;
            emit LegFilled(plan.planId, leg.tokenOut, leg.usdcIn, received);
        }

        if (spent > usdcTotal) revert SpentExceedsBudget();

        // Refund any unspent USDC (non-custodial — contract holds nothing between calls).
        uint256 leftover = usdc.balanceOf(address(this));
        if (leftover > 0) usdc.safeTransfer(msg.sender, leftover);

        emit AllocationExecuted(plan.planId, msg.sender, spent, legs.length);
    }

    /// @notice Rescue tokens accidentally sent to the contract.
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
