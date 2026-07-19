// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title GroveManager — the mandatory rail for Monvera's Groves (curated stock baskets).
/// @notice A grove is a STRATEGY, not a wrapper token. Users buy a basket of real
/// tokenized stocks with USDG; the stock tokens land in — and stay in — the USER's
/// wallet within the same transaction. This contract only executes, accounts, collects
/// the single fee, and emits the public record:
///
///   1. NON-CUSTODIAL: the contract holds nothing between transactions. Balances are
///      transient during a swap only; every leg's verified output is forwarded to the
///      user before the call returns.
///   2. PER-USER ISOLATION: no pooled shares, no shared NAV. One user's exit can never
///      touch another user's position, and no user-facing path loops over other users.
///   3. ONE FEE: zero on entry, zero on rebalance, zero management fee. Exactly
///      feeBps (immutable per grove, capped at 10%) of PROFIT at exit —
///      fee = feeBps * max(0, proceeds - costBasisWithdrawn) / 10000 — paid in USDG
///      from sale proceeds to the treasury. The per-user cost basis IS the
///      high-water mark; partial exits reduce it pro-rata.
///   4. TRUST NOTHING: the server prepares venue calldata off-chain, but the contract
///      only calls owner-whitelisted targets and verifies every outcome itself via its
///      own balance deltas — never the router's return values. All legs succeed or the
///      whole transaction reverts.
///   5. EXITS ARE SACRED: pause blocks new buys and manager actions only. exit() works
///      while paused, and closePosition() zeroes a user's accounting with no swap at
///      all (they hold the tokens anyway) — no function can ever trap a user.
///
/// No proxy, no upgradability. New logic = new contract; users migrate voluntarily.
///
/// @dev Callers are expected to be ERC-4337 smart accounts (contract callers) or the
/// manager EOA for auto flows — nothing here assumes an EOA and tx.origin is never
/// read. All USD accounting is in raw USDG units (6 decimals); stock tokens are 18dp.
///
/// Design choices where the spec was silent (conservative options, documented):
/// - Rebalance proceeds must re-enter buy legs EXACTLY: any residual USDG at the end
///   of a rebalance reverts. The server must size buy legs to consume sell proceeds
///   precisely; there is deliberately no refund path because a rebalance may not send
///   USDG to anyone.
/// - A full exit (fractionBps == 10000) MUST liquidate the whole position: every
///   tracked token amount has to reach zero in the exit legs, otherwise it reverts.
///   This closes the pooled-basis front-loading dodge — withdrawing 100% of the
///   (pooled, average-cost) basis against a sale of only the appreciated token while
///   abandoning the flat/loser tokens fee-free with the accounting cleared. A user
///   who genuinely cannot sell everything uses closePosition (the documented,
///   zero-fee emergency hatch) instead. Partial exits (fractionBps < 10000) keep the
///   remaining basis on the position, so the fee obligation always follows the
///   still-held tokens.
/// - Managed flows (managedBuy/managedRebalance) require every leg to carry a
///   non-zero minOut. The contract forwards only its OWN measured tokenOut delta to
///   the user, so a manager leg that routes a whitelisted venue's output to a third
///   party (minOut == 0, out == 0) would otherwise pass every check while the value
///   walks out the door. minOut > 0 makes the contract-measured, user-delivered
///   output strictly positive, so a full output redirect reverts.
/// - managedRebalance is bounded by the user's maxPerBuyUsdg: the USDG turnover
///   (sum of sell-leg proceeds routed through the transient pool) in a single
///   managed rebalance may not exceed that cap. A net-zero-USDG rebalance no longer
///   means unbounded value churn per cooldown.
/// - Re-enabling auto-manage resets the cumulative manager-spend counter: enableAuto
///   is callable only by the user, so a fresh call is explicit consent to a fresh
///   budget.
/// - closePosition, enableAuto and revokeAuto take no deadline: none of them execute
///   swaps, and a deadline on the emergency hatch could only hurt.
/// - Pause is guardian-only (the owner can rotate the guardian but cannot pause
///   directly), and per the spec's "only", a user-initiated rebalance still works
///   while paused — pause stops new money in and manager keys, nothing else.
contract GroveManager is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    uint256 public constant BPS = 10_000;
    /// @dev Fee ceiling: no grove can ever take more than 10% of profit.
    uint256 public constant MAX_FEE_BPS = 1_000;
    /// @dev Hard cap on legs per call — bounds gas and loop work everywhere.
    uint256 public constant MAX_LEGS = 20;
    uint256 public constant MIN_COMPONENTS = 3;
    uint256 public constant MAX_COMPONENTS = 30;
    /// @dev Composition changes and swap-target ADDITIONS wait this long. Removal of
    /// a swap target is instant — you never want to wait 48h to cut a bad venue.
    uint256 public constant TIMELOCK = 48 hours;
    /// @dev Floor on the user-chosen manager cooldown.
    uint256 public constant MIN_COOLDOWN = 1 hours;
    /// @dev Minimum USDG a single buy leg may spend. An on-chain dust/Sybil floor
    /// matching the product's "$11 per leg" rule — without it a 1-raw-unit buy
    /// (0.000001 USDG) mints a full activeUserCount++, letting the public tracker
    /// metrics be Sybil-inflated for ~gas.
    uint256 public constant MIN_BUY_USDG = 11_000_000; // 11 USDG (6dp)

    /// @notice USDG (6 decimals) — the only cash asset. Immutable by construction.
    IERC20 public immutable usdg;
    /// @notice Where exit fees go. Fixed at deploy; the owner cannot redirect it.
    address public immutable treasury;

    // ---------------------------------------------------------------- types

    /// @dev One basket component. weightBps guides the server's leg construction;
    /// the contract enforces set-membership, not weights (weights would force it to
    /// price assets, which it refuses to do).
    struct Component {
        address token;
        uint16 weightBps;
    }

    /// @dev One swap leg, prepared off-chain. The contract ignores what `data`
    /// claims and measures its own balance deltas. approvalTarget and callTarget are
    /// separate whitelist roles because venues like LiFi approve one contract and
    /// call another.
    struct SwapLeg {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        address callTarget;
        address approvalTarget;
        bytes data;
    }

    struct Grove {
        string name;
        uint16 feeBps; // immutable after creation — there is no setter, on purpose
        uint32 version; // current composition version, starts at 1
        uint256 activeUserCount;
        uint256 totalCostBasisUsdg;
        uint256 cumulativeInflowUsdg;
        uint256 cumulativeProceedsUsdg;
        uint256 cumulativeFeesUsdg;
    }

    struct Position {
        uint256 costBasisUsdg;
        address[] tokens; // tokens ever bought through the contract, for enumeration
        mapping(address => uint256) amountOf; // bought-through-contract amounts
        mapping(address => bool) tracked;
    }

    /// @dev Per-user, per-grove auto-manage consent. Every field is a hard cap the
    /// contract enforces against the manager — the manager key is never trusted.
    struct AutoConfig {
        bool enabled;
        uint256 maxPerBuyUsdg;
        uint256 maxTotalUsdg; // cumulative cap across all manager buys
        uint256 managerSpentUsdg;
        uint256 minSecondsBetween; // cooldown between ANY two manager actions
        uint256 lastManagerAction;
    }

    struct PendingComposition {
        uint64 eta;
        Component[] components;
    }

    // ---------------------------------------------------------------- storage

    uint256 public groveCount;
    mapping(uint256 => Grove) public groves;
    mapping(uint256 => mapping(uint32 => Component[])) private _composition;
    /// @dev weight > 0 doubles as set-membership for the buy-leg subset check.
    mapping(uint256 => mapping(uint32 => mapping(address => uint16))) private _weightOf;
    mapping(uint256 => PendingComposition) private _pendingComposition;

    mapping(address => mapping(uint256 => Position)) private _positions;
    mapping(address => mapping(uint256 => AutoConfig)) public autoConfigs;

    /// @notice Contracts the manager rail may CALL.
    mapping(address => bool) public callTargetAllowed;
    /// @notice Contracts the manager rail may APPROVE as spender (LiFi splits these).
    mapping(address => bool) public approvalTargetAllowed;
    mapping(address => uint64) public pendingCallTargetEta;
    mapping(address => uint64) public pendingApprovalTargetEta;

    /// @notice Vera's ops key for auto-manage flows. Can only act inside user caps.
    address public manager;
    /// @notice Can pause/unpause. Pause blocks buys + manager actions, never exits.
    address public guardian;
    bool public paused;

    // ---------------------------------------------------------------- events

    event GroveCreated(uint256 indexed groveId, string name, uint16 feeBps);
    event CompositionProposed(uint256 indexed groveId, uint64 eta);
    event CompositionUpdated(uint256 indexed groveId, uint32 version, address[] tokens, uint16[] weightsBps);
    event Bought(address indexed user, uint256 indexed groveId, uint256 usdgIn, uint256 legs);
    event Exited(
        address indexed user, uint256 indexed groveId, uint256 proceedsUsdg, uint256 feeUsdg, uint16 fractionBps
    );
    event Rebalanced(address indexed user, uint256 indexed groveId);
    event PositionClosed(address indexed user, uint256 indexed groveId, uint256 costBasisCleared);
    event AutoEnabled(
        address indexed user,
        uint256 indexed groveId,
        uint256 maxPerBuyUsdg,
        uint256 maxTotalUsdg,
        uint256 minSecondsBetween
    );
    event AutoRevoked(address indexed user, uint256 indexed groveId);
    event SwapTargetProposed(address indexed target, bool asApproval, uint64 eta);
    event SwapTargetAdded(address indexed target, bool asApproval);
    event SwapTargetRemoved(address indexed target, bool asApproval);
    event ManagerUpdated(address indexed manager);
    event GuardianUpdated(address indexed guardian);
    event PauseSet(bool paused);

    // ---------------------------------------------------------------- errors

    error GroveUnknown(uint256 groveId);
    error FeeTooHigh(uint16 feeBps);
    error BadComposition();
    error DeadlineExpired(uint256 deadline);
    error ContractPaused();
    error NotManager(address caller);
    error NotGuardian(address caller);
    error BadLegCount(uint256 n);
    error ZeroAmount();
    error TargetNotAllowed(address target);
    error ApprovalTargetNotAllowed(address target);
    error TargetIsToken(address target);
    error TokenNotInComposition(address token);
    error InsufficientPositionAmount(address token, uint256 want, uint256 have);
    error OutputBelowMin(address tokenOut, uint256 got, uint256 minOut);
    error SpendMismatch(address tokenIn, uint256 expected, uint256 actual);
    error LegTokenNotUsdg(uint256 index);
    error BadRebalanceLeg(uint256 index);
    error RebalanceInsufficientUsdg(uint256 want, uint256 have);
    error RebalanceUsdgResidue(uint256 residue);
    error NoPosition(address user, uint256 groveId);
    error BadFraction(uint16 fractionBps);
    error IncompleteFullExit(address token, uint256 remaining);
    error BuyLegTooSmall(uint256 index, uint256 amountIn);
    error ManagerMinOutRequired(uint256 index);
    error RebalanceTurnoverCapExceeded(uint256 turnover, uint256 cap);
    error AutoNotEnabled(address user, uint256 groveId);
    error PerBuyCapExceeded(uint256 want, uint256 cap);
    error TotalCapExceeded(uint256 want, uint256 cap);
    error CooldownActive(uint256 readyAt);
    error CooldownTooShort(uint256 seconds_);
    error BadAutoCaps();
    error TimelockPending(uint64 eta);
    error NothingPending();
    error SwapCallFailed(address target);
    error ZeroAddress();

    // ---------------------------------------------------------------- setup

    /// @param usdg_ USDG token (6dp) — 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 on 4663.
    /// @param treasury_ Monvera treasury — receives exit fees, nothing else.
    constructor(address usdg_, address treasury_) Ownable(msg.sender) {
        if (usdg_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdg = IERC20(usdg_);
        treasury = treasury_;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager(msg.sender);
        _;
    }

    modifier notPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ---------------------------------------------------------------- governance
    // The owner can create groves, evolve compositions (48h timelock), rotate the
    // manager/guardian keys and curate the swap-target whitelist (48h to add,
    // instant to remove). The owner can NEVER: touch user funds, change an existing
    // grove's feeBps, block an exit, or move accounting. None of those functions
    // exist.

    /// @notice Create a grove. feeBps is fixed forever at creation (max 10%).
    /// The initial composition applies immediately — a brand-new grove has no users
    /// to protect, so no timelock on version 1.
    function createGrove(string calldata name, uint16 feeBps, Component[] calldata components)
        external
        onlyOwner
        returns (uint256 groveId)
    {
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh(feeBps);
        groveId = groveCount++;
        Grove storage g = groves[groveId];
        g.name = name;
        g.feeBps = feeBps;
        g.version = 1;
        _storeComposition(groveId, 1, components);
        emit GroveCreated(groveId, name, feeBps);
    }

    /// @notice Propose a new composition for a grove. Applies after 48h via
    /// applyComposition — users get a full window to exit before the strategy moves.
    function proposeComposition(uint256 groveId, Component[] calldata components) external onlyOwner {
        _requireGrove(groveId);
        _validateComposition(components);
        PendingComposition storage pend = _pendingComposition[groveId];
        delete pend.components;
        for (uint256 i = 0; i < components.length; i++) {
            pend.components.push(components[i]);
        }
        pend.eta = uint64(block.timestamp + TIMELOCK);
        emit CompositionProposed(groveId, pend.eta);
    }

    /// @notice Apply a composition proposed at least 48h ago. Bumps the version;
    /// old versions stay queryable so historical events remain interpretable.
    function applyComposition(uint256 groveId) external onlyOwner {
        Grove storage g = _requireGrove(groveId);
        PendingComposition storage pend = _pendingComposition[groveId];
        if (pend.eta == 0) revert NothingPending();
        if (block.timestamp < pend.eta) revert TimelockPending(pend.eta);
        uint32 v = ++g.version;
        // Copy pending into a calldata-shaped memory array for the shared store path.
        Component[] memory comps = pend.components;
        _storeCompositionMem(groveId, v, comps);
        delete _pendingComposition[groveId];
    }

    /// @notice Queue a swap target for the whitelist (48h). `asApproval` selects the
    /// role: false = contract we may CALL, true = spender we may APPROVE. Venues
    /// that need both roles get proposed twice.
    function proposeSwapTarget(address target, bool asApproval) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        uint64 eta = uint64(block.timestamp + TIMELOCK);
        if (asApproval) pendingApprovalTargetEta[target] = eta;
        else pendingCallTargetEta[target] = eta;
        emit SwapTargetProposed(target, asApproval, eta);
    }

    /// @notice Activate a queued swap target after its 48h wait.
    function applySwapTarget(address target, bool asApproval) external onlyOwner {
        uint64 eta = asApproval ? pendingApprovalTargetEta[target] : pendingCallTargetEta[target];
        if (eta == 0) revert NothingPending();
        if (block.timestamp < eta) revert TimelockPending(eta);
        if (asApproval) {
            approvalTargetAllowed[target] = true;
            delete pendingApprovalTargetEta[target];
        } else {
            callTargetAllowed[target] = true;
            delete pendingCallTargetEta[target];
        }
        emit SwapTargetAdded(target, asApproval);
    }

    /// @notice Remove a swap target immediately (also cancels any pending add).
    /// Instant on purpose: cutting a compromised venue must not wait.
    function removeSwapTarget(address target, bool asApproval) external onlyOwner {
        if (asApproval) {
            approvalTargetAllowed[target] = false;
            delete pendingApprovalTargetEta[target];
        } else {
            callTargetAllowed[target] = false;
            delete pendingCallTargetEta[target];
        }
        emit SwapTargetRemoved(target, asApproval);
    }

    function setManager(address manager_) external onlyOwner {
        manager = manager_;
        emit ManagerUpdated(manager_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    /// @notice Guardian circuit breaker. Blocks buy/managedBuy/managedRebalance
    /// ONLY — exit, closePosition, revokeAuto and user rebalance keep working.
    function setPaused(bool paused_) external {
        if (msg.sender != guardian) revert NotGuardian(msg.sender);
        paused = paused_;
        emit PauseSet(paused_);
    }

    // ---------------------------------------------------------------- user flows

    /// @notice Buy into a grove. Pulls the summed USDG from the caller, executes
    /// each leg against whitelisted targets, verifies every output by balance delta,
    /// and forwards the stock to the caller — all in this transaction. Zero fee.
    function buy(uint256 groveId, SwapLeg[] calldata legs, uint256 deadline) external nonReentrant notPaused {
        _checkDeadline(deadline);
        _buy(msg.sender, groveId, legs, false);
    }

    /// @notice Sell position legs back to USDG and realize the one fee: feeBps of
    /// profit over the pro-rata cost basis withdrawn. Loss = zero fee; the remaining
    /// basis is reduced pro-rata (the basis is the high-water mark). Deliberately
    /// NOT pause-gated — exits are sacred.
    /// @param fractionBps How much of the cost basis this exit withdraws (1..10000).
    function exit(uint256 groveId, SwapLeg[] calldata legs, uint16 fractionBps, uint256 deadline)
        external
        nonReentrant
    {
        _checkDeadline(deadline);
        Grove storage g = _requireGrove(groveId);
        _checkLegCount(legs.length);
        if (fractionBps == 0 || fractionBps > BPS) revert BadFraction(fractionBps);
        Position storage p = _positions[msg.sender][groveId];
        if (p.costBasisUsdg == 0) revert NoPosition(msg.sender, groveId);

        uint256 basisWithdrawn = (p.costBasisUsdg * fractionBps) / BPS;
        uint256 proceeds;
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            if (leg.tokenOut != address(usdg)) revert LegTokenNotUsdg(i);
            uint256 held = p.amountOf[leg.tokenIn];
            if (held < leg.amountIn) revert InsufficientPositionAmount(leg.tokenIn, leg.amountIn, held);
            p.amountOf[leg.tokenIn] = held - leg.amountIn;
            proceeds += _executeLeg(leg, msg.sender);
        }

        uint256 fee;
        if (proceeds > basisWithdrawn) {
            fee = ((proceeds - basisWithdrawn) * g.feeBps) / BPS;
        }
        if (fee > 0) usdg.safeTransfer(treasury, fee);
        usdg.safeTransfer(msg.sender, proceeds - fee);

        p.costBasisUsdg -= basisWithdrawn;
        g.totalCostBasisUsdg -= basisWithdrawn;
        g.cumulativeProceedsUsdg += proceeds;
        g.cumulativeFeesUsdg += fee;
        if (fractionBps == BPS) {
            // A full-basis withdrawal must be a full liquidation: every tracked
            // token has to be sold to zero in these legs. Otherwise the fee could be
            // front-loaded onto a sold winner (100% of the pooled basis withdrawn)
            // while appreciated tokens are abandoned fee-free and the accounting is
            // cleared. If a user cannot sell everything, closePosition is the hatch.
            for (uint256 i = 0; i < p.tokens.length; i++) {
                uint256 remaining = p.amountOf[p.tokens[i]];
                if (remaining != 0) revert IncompleteFullExit(p.tokens[i], remaining);
            }
            _clearPosition(p);
            g.activeUserCount -= 1;
        }
        emit Exited(msg.sender, groveId, proceeds, fee, fractionBps);
    }

    /// @notice Swap between grove components without fees and without touching the
    /// cost basis. Sell legs (stock -> USDG) accumulate proceeds inside the contract
    /// for the duration of the call; buy legs (USDG -> stock) must consume them
    /// EXACTLY — any residue reverts, because a rebalance may not send USDG to
    /// anyone. Works while paused (only new money in is pause-gated).
    function rebalance(uint256 groveId, SwapLeg[] calldata legs, uint256 deadline) external nonReentrant {
        _checkDeadline(deadline);
        _rebalance(msg.sender, groveId, legs, false);
    }

    /// @notice The emergency hatch: zero the caller's accounting for a grove without
    /// any swap. No fee is taken (accepted leakage — the tokens are already in the
    /// user's wallet, and nothing may ever block an exit, not even a broken venue
    /// whitelist). Works while paused.
    function closePosition(uint256 groveId) external nonReentrant {
        Grove storage g = _requireGrove(groveId);
        Position storage p = _positions[msg.sender][groveId];
        uint256 basis = p.costBasisUsdg;
        if (basis == 0) revert NoPosition(msg.sender, groveId);
        p.costBasisUsdg = 0;
        _clearPosition(p);
        g.totalCostBasisUsdg -= basis;
        g.activeUserCount -= 1;
        emit PositionClosed(msg.sender, groveId, basis);
    }

    // ---------------------------------------------------------------- auto-manage

    /// @notice Opt in to manager-driven flows for one grove, with hard caps the
    /// contract enforces on every manager call. Calling again overwrites the caps
    /// and resets the cumulative spend counter — only the user can call this, so a
    /// fresh call is explicit consent to a fresh budget.
    function enableAuto(uint256 groveId, uint256 maxPerBuyUsdg, uint256 maxTotalUsdg, uint256 minSecondsBetween)
        external
        nonReentrant
    {
        _requireGrove(groveId);
        if (minSecondsBetween < MIN_COOLDOWN) revert CooldownTooShort(minSecondsBetween);
        if (maxPerBuyUsdg == 0 || maxTotalUsdg < maxPerBuyUsdg) revert BadAutoCaps();
        AutoConfig storage a = autoConfigs[msg.sender][groveId];
        a.enabled = true;
        a.maxPerBuyUsdg = maxPerBuyUsdg;
        a.maxTotalUsdg = maxTotalUsdg;
        a.managerSpentUsdg = 0;
        a.minSecondsBetween = minSecondsBetween;
        emit AutoEnabled(msg.sender, groveId, maxPerBuyUsdg, maxTotalUsdg, minSecondsBetween);
    }

    /// @notice Revoke auto-manage instantly. No cooldown, no timelock, works while
    /// paused — consent withdrawal is immediate by design.
    function revokeAuto(uint256 groveId) external nonReentrant {
        autoConfigs[msg.sender][groveId].enabled = false;
        emit AutoRevoked(msg.sender, groveId);
    }

    /// @notice Manager buys into a grove FOR a user, spending only the user's own
    /// USDG allowance, within the user's per-buy and cumulative caps, respecting the
    /// user's cooldown. Everything else is identical to a user buy.
    function managedBuy(address user, uint256 groveId, SwapLeg[] calldata legs, uint256 deadline)
        external
        nonReentrant
        onlyManager
        notPaused
    {
        _checkDeadline(deadline);
        AutoConfig storage a = _checkAutoAndCooldown(user, groveId);
        // managed=true: every leg must carry minOut > 0 (see _buy) so a redirected
        // output (out == 0) can never pass the delta check.
        uint256 totalIn = _buy(user, groveId, legs, true);
        if (totalIn > a.maxPerBuyUsdg) revert PerBuyCapExceeded(totalIn, a.maxPerBuyUsdg);
        uint256 spent = a.managerSpentUsdg + totalIn;
        if (spent > a.maxTotalUsdg) revert TotalCapExceeded(spent, a.maxTotalUsdg);
        a.managerSpentUsdg = spent;
    }

    /// @notice Manager rebalances a user's position within the opted-in grove.
    /// Net-zero USDG (enforced by the shared rebalance path). It consumes the
    /// cooldown, requires minOut > 0 on every leg, and is bounded in VALUE: the USDG
    /// turnover (sum of sell-leg proceeds) may not exceed the user's maxPerBuyUsdg,
    /// so a compromised manager key cannot churn the whole position out per cooldown.
    function managedRebalance(address user, uint256 groveId, SwapLeg[] calldata legs, uint256 deadline)
        external
        nonReentrant
        onlyManager
        notPaused
    {
        _checkDeadline(deadline);
        AutoConfig storage a = _checkAutoAndCooldown(user, groveId);
        uint256 turnover = _rebalance(user, groveId, legs, true);
        if (turnover > a.maxPerBuyUsdg) revert RebalanceTurnoverCapExceeded(turnover, a.maxPerBuyUsdg);
    }

    // ---------------------------------------------------------------- views

    /// @notice A user's position in a grove: cost basis plus every token amount
    /// bought through the contract (amounts may be zero after sells).
    function positionOf(address user, uint256 groveId)
        external
        view
        returns (uint256 costBasisUsdg, address[] memory tokens, uint256[] memory amounts)
    {
        Position storage p = _positions[user][groveId];
        costBasisUsdg = p.costBasisUsdg;
        tokens = p.tokens;
        amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amounts[i] = p.amountOf[tokens[i]];
        }
    }

    /// @notice A grove's composition at a given version (historical versions stay).
    function groveComposition(uint256 groveId, uint32 version) external view returns (Component[] memory) {
        return _composition[groveId][version];
    }

    /// @notice The queued composition change for a grove, if any (eta 0 = none).
    function pendingComposition(uint256 groveId) external view returns (uint64 eta, Component[] memory components) {
        PendingComposition storage pend = _pendingComposition[groveId];
        return (pend.eta, pend.components);
    }

    // ---------------------------------------------------------------- internals

    function _checkDeadline(uint256 deadline) internal view {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
    }

    function _checkLegCount(uint256 n) internal pure {
        if (n == 0 || n > MAX_LEGS) revert BadLegCount(n);
    }

    function _requireGrove(uint256 groveId) internal view returns (Grove storage g) {
        g = groves[groveId];
        if (g.version == 0) revert GroveUnknown(groveId);
    }

    function _checkAutoAndCooldown(address user, uint256 groveId) internal returns (AutoConfig storage a) {
        a = autoConfigs[user][groveId];
        if (!a.enabled) revert AutoNotEnabled(user, groveId);
        uint256 readyAt = a.lastManagerAction + a.minSecondsBetween;
        if (a.lastManagerAction != 0 && block.timestamp < readyAt) revert CooldownActive(readyAt);
        a.lastManagerAction = block.timestamp;
    }

    /// @dev Shared buy path for buy() and managedBuy(). Pulls the summed USDG from
    /// `user`, runs the legs, forwards each verified output to `user`. `managed`
    /// tightens two rules for manager-initiated buys: every leg must clear the dust
    /// floor (also enforced for user buys) and must carry minOut > 0 so a redirected
    /// output cannot pass the delta check with out == 0.
    function _buy(address user, uint256 groveId, SwapLeg[] calldata legs, bool managed)
        internal
        returns (uint256 totalIn)
    {
        Grove storage g = _requireGrove(groveId);
        _checkLegCount(legs.length);
        uint32 v = g.version;
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].tokenIn != address(usdg)) revert LegTokenNotUsdg(i);
            if (legs[i].amountIn < MIN_BUY_USDG) revert BuyLegTooSmall(i, legs[i].amountIn);
            if (managed && legs[i].minOut == 0) revert ManagerMinOutRequired(i);
            if (_weightOf[groveId][v][legs[i].tokenOut] == 0) revert TokenNotInComposition(legs[i].tokenOut);
            totalIn += legs[i].amountIn;
        }
        if (totalIn == 0) revert ZeroAmount();

        usdg.safeTransferFrom(user, address(this), totalIn);
        Position storage p = _positions[user][groveId];
        bool wasEmpty = p.costBasisUsdg == 0;
        for (uint256 i = 0; i < legs.length; i++) {
            uint256 out = _executeLeg(legs[i], address(0));
            _creditToken(p, legs[i].tokenOut, out);
            IERC20(legs[i].tokenOut).safeTransfer(user, out);
        }

        p.costBasisUsdg += totalIn;
        g.totalCostBasisUsdg += totalIn;
        g.cumulativeInflowUsdg += totalIn;
        if (wasEmpty) g.activeUserCount += 1;
        emit Bought(user, groveId, totalIn, legs.length);
    }

    /// @dev Shared rebalance path for rebalance() and managedRebalance(). Sell legs
    /// fill an in-memory USDG pool; buy legs drain it; a non-zero residue reverts.
    /// `managed` requires minOut > 0 on every leg (so a manager cannot redirect a
    /// sell or buy leg's output to a third party with out == 0). Returns the total
    /// USDG turnover (sum of sell-leg proceeds) so the manager path can bound it.
    function _rebalance(address user, uint256 groveId, SwapLeg[] calldata legs, bool managed)
        internal
        returns (uint256 turnover)
    {
        Grove storage g = _requireGrove(groveId);
        _checkLegCount(legs.length);
        Position storage p = _positions[user][groveId];
        if (p.costBasisUsdg == 0) revert NoPosition(user, groveId);
        uint32 v = g.version;

        uint256 pool;
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            if (managed && leg.minOut == 0) revert ManagerMinOutRequired(i);
            if (leg.tokenOut == address(usdg)) {
                // Sell leg: stock (pulled from the user) -> USDG held transiently.
                uint256 held = p.amountOf[leg.tokenIn];
                if (held < leg.amountIn) revert InsufficientPositionAmount(leg.tokenIn, leg.amountIn, held);
                p.amountOf[leg.tokenIn] = held - leg.amountIn;
                uint256 got = _executeLeg(leg, user);
                pool += got;
                turnover += got;
            } else if (leg.tokenIn == address(usdg)) {
                // Buy leg: transient USDG -> stock forwarded to the user.
                if (leg.amountIn > pool) revert RebalanceInsufficientUsdg(leg.amountIn, pool);
                if (_weightOf[groveId][v][leg.tokenOut] == 0) revert TokenNotInComposition(leg.tokenOut);
                pool -= leg.amountIn;
                uint256 out = _executeLeg(leg, address(0));
                _creditToken(p, leg.tokenOut, out);
                IERC20(leg.tokenOut).safeTransfer(user, out);
            } else {
                revert BadRebalanceLeg(i);
            }
        }
        if (pool != 0) revert RebalanceUsdgResidue(pool);
        emit Rebalanced(user, groveId);
    }

    /// @dev Execute one whitelisted swap and verify it with our own balance deltas.
    /// `pullFrom` != 0 pulls amountIn of tokenIn from that address first (exit/sell
    /// legs); 0 means the input is already held here (buy legs). Approves the exact
    /// amount to the approval target and resets it to zero after — no dangling
    /// approvals, ever. Reverts unless the router delivered >= minOut AND consumed
    /// exactly amountIn (a partially-consuming or lying router fails the whole tx).
    function _executeLeg(SwapLeg calldata leg, address pullFrom) internal returns (uint256 out) {
        if (!callTargetAllowed[leg.callTarget]) revert TargetNotAllowed(leg.callTarget);
        if (!approvalTargetAllowed[leg.approvalTarget]) revert ApprovalTargetNotAllowed(leg.approvalTarget);
        // Never let a "swap" be a direct call into a token contract.
        if (leg.callTarget == leg.tokenIn || leg.callTarget == leg.tokenOut || leg.callTarget == address(usdg)) {
            revert TargetIsToken(leg.callTarget);
        }
        if (leg.amountIn == 0) revert ZeroAmount();

        IERC20 tokenIn = IERC20(leg.tokenIn);
        IERC20 tokenOut = IERC20(leg.tokenOut);
        if (pullFrom != address(0)) tokenIn.safeTransferFrom(pullFrom, address(this), leg.amountIn);

        tokenIn.forceApprove(leg.approvalTarget, leg.amountIn);
        uint256 inBefore = tokenIn.balanceOf(address(this));
        uint256 outBefore = tokenOut.balanceOf(address(this));

        (bool ok, bytes memory ret) = leg.callTarget.call(leg.data);
        if (!ok) {
            if (ret.length > 0) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
            revert SwapCallFailed(leg.callTarget);
        }
        tokenIn.forceApprove(leg.approvalTarget, 0);

        out = tokenOut.balanceOf(address(this)) - outBefore;
        uint256 spent = inBefore - tokenIn.balanceOf(address(this));
        if (out < leg.minOut) revert OutputBelowMin(leg.tokenOut, out, leg.minOut);
        if (spent != leg.amountIn) revert SpendMismatch(leg.tokenIn, leg.amountIn, spent);
    }

    function _creditToken(Position storage p, address token, uint256 amount) internal {
        if (!p.tracked[token]) {
            p.tracked[token] = true;
            p.tokens.push(token);
        }
        p.amountOf[token] += amount;
    }

    /// @dev Zero all per-token accounting for a closed position. Loops only the
    /// user's OWN token list (bounded by composition history, never other users).
    function _clearPosition(Position storage p) internal {
        for (uint256 i = 0; i < p.tokens.length; i++) {
            delete p.amountOf[p.tokens[i]];
            delete p.tracked[p.tokens[i]];
        }
        delete p.tokens;
    }

    function _validateComposition(Component[] calldata components) internal view {
        if (components.length < MIN_COMPONENTS || components.length > MAX_COMPONENTS) revert BadComposition();
        uint256 sum;
        for (uint256 i = 0; i < components.length; i++) {
            address token = components[i].token;
            if (token == address(0) || token == address(usdg)) revert BadComposition();
            if (components[i].weightBps == 0) revert BadComposition();
            // O(n^2) duplicate check is fine at n <= 30, and calldata-only.
            for (uint256 j = 0; j < i; j++) {
                if (components[j].token == token) revert BadComposition();
            }
            sum += components[i].weightBps;
        }
        if (sum != BPS) revert BadComposition();
    }

    function _storeComposition(uint256 groveId, uint32 version, Component[] calldata components) internal {
        _validateComposition(components);
        address[] memory tokens = new address[](components.length);
        uint16[] memory weights = new uint16[](components.length);
        for (uint256 i = 0; i < components.length; i++) {
            _composition[groveId][version].push(components[i]);
            _weightOf[groveId][version][components[i].token] = components[i].weightBps;
            tokens[i] = components[i].token;
            weights[i] = components[i].weightBps;
        }
        emit CompositionUpdated(groveId, version, tokens, weights);
    }

    /// @dev Memory twin of _storeComposition for the timelock path (pending
    /// components live in storage, surfaced as memory). Already validated at
    /// propose time; membership/weight writes are identical.
    function _storeCompositionMem(uint256 groveId, uint32 version, Component[] memory components) internal {
        address[] memory tokens = new address[](components.length);
        uint16[] memory weights = new uint16[](components.length);
        for (uint256 i = 0; i < components.length; i++) {
            _composition[groveId][version].push(components[i]);
            _weightOf[groveId][version][components[i].token] = components[i].weightBps;
            tokens[i] = components[i].token;
            weights[i] = components[i].weightBps;
        }
        emit CompositionUpdated(groveId, version, tokens, weights);
    }
}
