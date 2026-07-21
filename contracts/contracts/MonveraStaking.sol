// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MonveraStaking — stake $MONVERA to hold rights, not to farm a rate.
/// @notice Staking backs ACCESS in the Monvera app (feature tiers, Grove curator
/// eligibility) and the retroactive, discretionary reward seasons. Deliberately:
///
///   1. NO REWARD MATH ON-CHAIN. This contract never promises, computes, or
///      streams a yield. Seasons are distributed off-schedule by the treasury,
///      announced only after the fact. The absence of an APY is a design
///      feature, not a missing feature.
///   2. NO ADMIN. There is no owner, no pause, no parameter setter, no rescue
///      hook for the stake token. Nothing and nobody can block, delay beyond
///      the fixed cooldown, or redirect a withdrawal. Unstaking is as sacred
///      here as exits are in GroveManager.
///   3. ONE COOLDOWN. Unstaking is a two-step: request, wait `cooldown`,
///      withdraw. The wait exists so perks and season weightings cannot be
///      flash-staked. Requesting again before withdrawing adds to the pending
///      amount and RESTARTS the single timer — documented, keeps state tiny.
///
/// Stake-time weighting for seasons is computed off-chain from this contract's
/// event stream (Staked / UnstakeRequested / UnstakeCancelled / Withdrawn);
/// the contract stores only current balances.
///
/// @dev Amounts are credited by measured balance delta, so a fee-on-transfer
/// token would simply credit what actually arrived. $MONVERA is a standard
/// ERC-20 (18dp); the delta check is belt-and-braces, not an expectation.
contract MonveraStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The stake token ($MONVERA). Fixed at deploy.
    IERC20 public immutable token;
    /// @notice Seconds between requestUnstake and withdraw. Fixed at deploy.
    uint256 public immutable cooldown;

    /// @notice Sum of all currently staked balances (excludes pending unstakes).
    uint256 public totalStaked;
    /// @notice Sum of all pending (cooling-down) balances.
    uint256 public totalPending;

    struct Account {
        uint256 staked;
        uint256 pending;
        uint64 unlockAt;
    }

    mapping(address => Account) private _accounts;

    event Staked(address indexed user, uint256 amount, uint256 stakedAfter);
    event UnstakeRequested(address indexed user, uint256 amount, uint256 pendingAfter, uint64 unlockAt);
    event UnstakeCancelled(address indexed user, uint256 amount, uint256 stakedAfter);
    event Withdrawn(address indexed user, uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error BadCooldown(uint256 seconds_);
    error InsufficientStaked(uint256 want, uint256 have);
    error NothingPending();
    error StillCooling(uint64 unlockAt);

    /// @param token_ $MONVERA — 0x7541872e32Bb529d7FF11D6C59832269ce33a6FF on 4663.
    /// @param cooldown_ Unstake cooldown in seconds. Bounded to [1 hour, 30 days]
    /// at deploy so a typo can't brick withdrawals; immutable after.
    constructor(address token_, uint256 cooldown_) {
        if (token_ == address(0)) revert ZeroAddress();
        if (cooldown_ < 1 hours || cooldown_ > 30 days) revert BadCooldown(cooldown_);
        token = IERC20(token_);
        cooldown = cooldown_;
    }

    // ---------------------------------------------------------------- actions

    /// @notice Stake `amount` of $MONVERA. Credited by measured delta.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 credited = token.balanceOf(address(this)) - before;
        if (credited == 0) revert ZeroAmount();
        Account storage a = _accounts[msg.sender];
        a.staked += credited;
        totalStaked += credited;
        emit Staked(msg.sender, credited, a.staked);
    }

    /// @notice Move `amount` from staked to pending and (re)start the cooldown.
    /// The amount stops counting toward tiers/seasons immediately.
    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage a = _accounts[msg.sender];
        if (a.staked < amount) revert InsufficientStaked(amount, a.staked);
        a.staked -= amount;
        a.pending += amount;
        a.unlockAt = uint64(block.timestamp + cooldown);
        totalStaked -= amount;
        totalPending += amount;
        emit UnstakeRequested(msg.sender, amount, a.pending, a.unlockAt);
    }

    /// @notice Put the whole pending amount back into the stake (changed your
    /// mind). Clears the timer.
    function cancelUnstake() external nonReentrant {
        Account storage a = _accounts[msg.sender];
        uint256 amount = a.pending;
        if (amount == 0) revert NothingPending();
        a.pending = 0;
        a.unlockAt = 0;
        a.staked += amount;
        totalPending -= amount;
        totalStaked += amount;
        emit UnstakeCancelled(msg.sender, amount, a.staked);
    }

    /// @notice Withdraw the whole pending amount after the cooldown has passed.
    function withdraw() external nonReentrant {
        Account storage a = _accounts[msg.sender];
        uint256 amount = a.pending;
        if (amount == 0) revert NothingPending();
        if (block.timestamp < a.unlockAt) revert StillCooling(a.unlockAt);
        a.pending = 0;
        a.unlockAt = 0;
        totalPending -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- views

    /// @notice Currently staked balance — the number tiers and curator
    /// eligibility read. Pending (cooling-down) amounts do not count.
    function stakedOf(address user) external view returns (uint256) {
        return _accounts[user].staked;
    }

    /// @notice Pending unstake amount and when it unlocks (0, 0 if none).
    function pendingOf(address user) external view returns (uint256 amount, uint64 unlockAt) {
        Account storage a = _accounts[user];
        return (a.pending, a.unlockAt);
    }
}
