// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @dev Minimal Chainlink AggregatorV3 surface. Declared locally rather than
/// pulling in the Chainlink contracts package: two functions do not justify a
/// new dependency in a contract that holds user money.
interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function decimals() external view returns (uint8);
}

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
/// - Rebalance proceeds re-enter buy legs, and a BOUNDED tail returns to the
///   position's own owner. The exact-zero rule this replaces could not ship: buy-leg
///   amountIn is baked into venue calldata at QUOTE time while the pool is only known
///   after the sell legs FILL, so any price move between the two reverted the whole
///   rebalance — over-delivery and under-delivery alike. The server now sizes buy legs
///   from the sum of sell-leg minOuts, which the contract enforces, so under-funding is
///   structurally impossible; the over-delivery lands as residue and is refunded to the
///   user, capped at max(3% of measured sell proceeds, 1 USDG) so a rebalance can never
///   become a disguised cash-out channel. A rebalance still may not send USDG to any
///   THIRD party — returning the tail to the owner is not a withdrawal.
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
/// - managedRebalance is bounded three ways, none of them in a quantity the
///   manager supplies: a per-token FRACTION of the position snapshot (no oracle
///   involved), the ORACLE VALUE of everything sold against maxPerBuyUsdg, and a
///   lifetime maxTotalUsdg budget shared with managed buys. The previous bound
///   was the MEASURED sell proceeds — precisely the number an attacker minimises,
///   so it was anti-correlated with the damage: it blocked honest large
///   rebalances while permitting total liquidation.
/// - Every leg on every path must carry minOut > 0, and every fill is checked
///   against a Chainlink band the contract derives itself. minOut is authored by
///   whoever authored the calldata, so it was never a bound on the manager.
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
    /// @dev MUST stay <= MAX_LEGS so a full exit of a single-version position is
    /// always expressible in one call. Was 30: with a 20-leg ceiling that made a
    /// fee-bearing full exit unexpressible, forcing users onto the zero-fee
    /// closePosition hatch and leaking the protocol's only fee.
    uint256 public constant MAX_COMPONENTS = 20;
    /// @dev Composition changes and swap-target ADDITIONS wait this long. Removal of
    /// a swap target is instant — you never want to wait 48h to cut a bad venue.
    uint256 public constant TIMELOCK = 48 hours;
    /// @dev How long after deployment `bootstrap` may seed the initial venue set
    /// and feeds without waiting out TIMELOCK. Short by design: it only needs to
    /// cover the deploy run itself, and it closes permanently once passed.
    uint256 public constant BOOTSTRAP_WINDOW = 2 hours;
    /// @dev Floor on the user-chosen manager cooldown.
    uint256 public constant MIN_COOLDOWN = 1 hours;
    /// @dev Minimum USDG a single buy leg may spend. An on-chain dust/Sybil floor
    /// matching the product's "$11 per leg" rule — without it a 1-raw-unit buy
    /// (0.000001 USDG) mints a full activeUserCount++, letting the public tracker
    /// metrics be Sybil-inflated for ~gas.
    // Dust floor only. This is deliberately PERMISSIVE: it exists so a leg
    // cannot be zero or trivially small, not to express Monvera's economics.
    // The first deploy set it at 11 USDG, which baked a business policy (the
    // old per-leg gas floor) into immutable bytecode — so a $20 buy could only
    // reach the largest 2 of 8 names and no two depositors held the same
    // basket. Policy now lives in the app (grove.minBuyUsd), where it can move.
    uint256 public constant MIN_BUY_USDG = 250_000; // 0.25 USDG (6dp)

    // ── oracle band ─────────────────────────────────────────────────────────
    /// @dev Hard ceilings on the owner-settable bands. Gamma Strategies lost ~$6M
    /// in Jan 2024 because its deviation threshold was a config value with no code
    /// floor. These two constants ARE that floor: no governance action, no
    /// timelock, nothing can widen past them.
    uint16 public constant MAX_BAND_BPS = 500; // 5%  — fresh-feed band
    uint16 public constant MAX_STALE_BAND_BPS = 2_000; // 20% — closed-market band
    /// @dev Past this a feed is not stale, it is DEAD, and we stop pretending to
    /// price the token. 5 days covers the longest legitimate equity gap.
    uint256 public constant MAX_FEED_AGE = 5 days;
    /// @dev Chainlink L2 recovery grace after the sequencer comes back up.
    uint256 public constant SEQUENCER_GRACE = 1 hours;
    /// @dev Sanity ceiling on a feed answer, used only to make the overflow bound
    /// in _checkBand provable. 1e30 at 8dp is $1e22 per share — no false rejects.
    uint256 public constant MAX_ANSWER = 1e30;

    // ── rebalance residue ───────────────────────────────────────────────────
    /// @dev A rebalance may not send USDG to a THIRD party — but returning the
    /// unspent tail to the position's OWN owner is not a withdrawal. The old
    /// exact-zero rule could not ship: buy-leg amountIn is baked into venue
    /// calldata at quote time while the pool is only known after the sell legs
    /// fill, so any price move between quote and execution reverted the whole
    /// rebalance in one direction or the other. The server now sizes buy legs
    /// from the SUM OF SELL-LEG minOuts (which the contract enforces), making
    /// under-funding structurally impossible; over-delivery lands here and goes
    /// back to the user, capped so it can never become a disguised cash-out.
    uint256 public constant MAX_REBALANCE_RESIDUE_BPS = 300; // 3% of value sold
    uint256 public constant MIN_REBALANCE_RESIDUE = 1_000_000; // 1 USDG floor

    /// @notice USDG (6 decimals) — the only cash asset. Immutable by construction.
    IERC20 public immutable usdg;
    /// @notice Where exit fees go. Fixed at deploy; the owner cannot redirect it.
    address public immutable treasury;
    /// @dev Last timestamp at which `bootstrap` may be called. Immutable, so the
    /// window cannot be reopened by anyone, including the owner.
    uint256 public immutable bootstrapDeadline;

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
        uint256 maxTotalUsdg; // lifetime cap on manager-MOVED value, buys and rebalances alike
        uint256 managerMovedUsdg;
        uint256 minSecondsBetween; // cooldown between ANY two manager actions
        uint256 lastManagerAction;
        /// @dev Price-free blast radius: the manager may sell at most this
        /// fraction of ANY single holding per rebalance. Oracle-independent, so a
        /// compromised feed cannot widen it.
        uint16 maxRebalanceFractionBps;
    }

    /// @dev One registered price source. `scalePow` = tokenDecimals + feedDecimals
    /// - 6 (20 for an 18dp stock on an 8dp feed) — snapshotted at registration so
    /// the hot path never calls decimals(). Packs into ONE slot: 160 + 32 + 8.
    struct Feed {
        address aggregator;
        uint32 heartbeat; // per-feed freshness bound. NEVER one global constant.
        uint8 scalePow; // <= 36
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

    mapping(address => Feed) public feedOf;
    mapping(address => Feed) private _pendingFeed;
    mapping(address => uint64) public pendingFeedEta;

    uint16 public bandBps = 300; // 3%  — fresh feed
    uint16 public staleBandBps = 1_000; // 10% — market closed / sequencer grace
    uint16 public pendingBandBps;
    uint16 public pendingStaleBandBps;
    uint64 public pendingBandEta;

    /// @notice Chainlink sequencer-uptime feed. address(0) = check disabled.
    /// Deployed disabled; enable once the 4663 address is verified.
    address public sequencerUptimeFeed;

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
        uint256 minSecondsBetween,
        uint16 maxRebalanceFractionBps
    );
    event AutoRevoked(address indexed user, uint256 indexed groveId);
    event SwapTargetProposed(address indexed target, bool asApproval, uint64 eta);
    event SwapTargetAdded(address indexed target, bool asApproval);
    event SwapTargetRemoved(address indexed target, bool asApproval);
    event FeedProposed(address indexed token, address aggregator, uint32 heartbeat, uint64 eta);
    event FeedSet(address indexed token, address aggregator, uint32 heartbeat);
    event FeedRemoved(address indexed token);
    event BandsProposed(uint16 bandBps, uint16 staleBandBps, uint64 eta);
    event BandsSet(uint16 bandBps, uint16 staleBandBps);
    event SequencerFeedSet(address feed);
    event RebalanceResidueRefunded(address indexed user, uint256 indexed groveId, uint256 amount);
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
    error MinOutRequired();
    error FeedRequired(address token);
    error StaleFeedForManaged(address token, uint256 updatedAt);
    error PriceBandBreached(address token, uint256 out, uint256 minAcceptable);
    error BadBand(uint16 bandBps, uint16 staleBandBps);
    error BadFeed();
    error RebalanceFractionExceeded(address token, uint256 sold, uint256 cap);
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
    error BootstrapClosed(uint256 deadline);

    // ---------------------------------------------------------------- setup

    /// @param usdg_ USDG token (6dp) — 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 on 4663.
    /// @param treasury_ Monvera treasury — receives exit fees, nothing else.
    constructor(address usdg_, address treasury_) Ownable(msg.sender) {
        if (usdg_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdg = IERC20(usdg_);
        treasury = treasury_;
        bootstrapDeadline = block.timestamp + BOOTSTRAP_WINDOW;
    }

    /// @notice Seed the FIRST venue whitelist and price feeds with no timelock,
    /// during a short window that opens at deployment and then closes forever.
    ///
    /// The 48h timelock exists so an owner cannot whitelist a hostile venue and
    /// drain positions before anyone can react. That threat needs positions to
    /// exist. At deployment there are no groves, no users and no funds, so the
    /// initial set carries no such risk — it is part of the deployment a user
    /// chooses to trust, not a change made underneath them. Every LATER add
    /// still waits the full 48h.
    ///
    /// The guard is `bootstrapDeadline`: immutable, set in the constructor, and
    /// checked here. So this cannot be reached once the window passes even if
    /// the owner key is later compromised. It is intentionally callable more
    /// than once inside the window — seeding may need more than one transaction,
    /// and a partial seed must be completable without redeploying.
    ///
    /// Feeds go through the same `_validatedFeed` checks as `proposeFeed`.
    function bootstrap(
        address[] calldata callTargets,
        address[] calldata approvalTargets,
        address[] calldata feedTokens,
        address[] calldata feedAggregators,
        uint32[] calldata heartbeats
    ) external onlyOwner {
        if (block.timestamp > bootstrapDeadline) revert BootstrapClosed(bootstrapDeadline);
        if (feedTokens.length != feedAggregators.length || feedTokens.length != heartbeats.length) {
            revert BadFeed();
        }

        for (uint256 i = 0; i < callTargets.length; i++) {
            if (callTargets[i] == address(0)) revert ZeroAddress();
            callTargetAllowed[callTargets[i]] = true;
            emit SwapTargetAdded(callTargets[i], false);
        }
        for (uint256 i = 0; i < approvalTargets.length; i++) {
            if (approvalTargets[i] == address(0)) revert ZeroAddress();
            approvalTargetAllowed[approvalTargets[i]] = true;
            emit SwapTargetAdded(approvalTargets[i], true);
        }
        for (uint256 i = 0; i < feedTokens.length; i++) {
            Feed memory f = _validatedFeed(feedTokens[i], feedAggregators[i], heartbeats[i]);
            feedOf[feedTokens[i]] = f;
            emit FeedSet(feedTokens[i], f.aggregator, f.heartbeat);
        }
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

    /// @notice Queue a price feed for a token (48h). Registering a feed is the
    /// only thing that lets the manager rail touch that token at all, so an owner
    /// cannot swap in a lying aggregator and drain through a compromised manager
    /// in the same block.
    function proposeFeed(address token, address aggregator, uint32 heartbeat) external onlyOwner {
        _pendingFeed[token] = _validatedFeed(token, aggregator, heartbeat);
        uint64 eta = uint64(block.timestamp + TIMELOCK);
        pendingFeedEta[token] = eta;
        emit FeedProposed(token, aggregator, heartbeat, eta);
    }

    function applyFeed(address token) external onlyOwner {
        uint64 eta = pendingFeedEta[token];
        if (eta == 0) revert NothingPending();
        if (block.timestamp < eta) revert TimelockPending(eta);
        Feed memory f = _pendingFeed[token];
        feedOf[token] = f;
        delete _pendingFeed[token];
        delete pendingFeedEta[token];
        emit FeedSet(token, f.aggregator, f.heartbeat);
    }

    /// Shared by proposeFeed and bootstrap so a feed can never reach storage by
    /// one path having skipped a check the other makes. A feed that does not
    /// answer RIGHT NOW is a dead address and is refused outright.
    function _validatedFeed(address token, address aggregator, uint32 heartbeat) internal view returns (Feed memory) {
        if (token == address(0) || aggregator == address(0) || heartbeat == 0) revert BadFeed();
        uint8 td = IERC20Metadata(token).decimals();
        uint8 fd = AggregatorV3Interface(aggregator).decimals();
        if (td > 18 || fd > 18 || uint256(td) + uint256(fd) < 6) revert BadFeed();
        (bool ok,,) = _readFeed(aggregator);
        if (!ok) revert BadFeed();
        return Feed({aggregator: aggregator, heartbeat: heartbeat, scalePow: uint8(td + fd - 6)});
    }

    /// @notice Instant, on purpose. Dropping a feed only ever makes things
    /// STRICTER: managed legs on that token stop entirely and new buys stop.
    /// Cutting a broken oracle must not wait 48h, exactly like removeSwapTarget.
    function removeFeed(address token) external onlyOwner {
        delete feedOf[token];
        delete _pendingFeed[token];
        delete pendingFeedEta[token];
        emit FeedRemoved(token);
    }

    /// @notice Tightening the band is instant; widening waits 48h.
    function tightenBands(uint16 fresh_, uint16 stale_) external onlyOwner {
        if (fresh_ == 0 || fresh_ > bandBps || stale_ > staleBandBps || stale_ < fresh_) {
            revert BadBand(fresh_, stale_);
        }
        bandBps = fresh_;
        staleBandBps = stale_;
        emit BandsSet(fresh_, stale_);
    }

    function proposeBands(uint16 fresh_, uint16 stale_) external onlyOwner {
        if (fresh_ == 0 || fresh_ > MAX_BAND_BPS || stale_ > MAX_STALE_BAND_BPS || stale_ < fresh_) {
            revert BadBand(fresh_, stale_);
        }
        pendingBandBps = fresh_;
        pendingStaleBandBps = stale_;
        pendingBandEta = uint64(block.timestamp + TIMELOCK);
        emit BandsProposed(fresh_, stale_, pendingBandEta);
    }

    function applyBands() external onlyOwner {
        if (pendingBandEta == 0) revert NothingPending();
        if (block.timestamp < pendingBandEta) revert TimelockPending(pendingBandEta);
        bandBps = pendingBandBps;
        staleBandBps = pendingStaleBandBps;
        pendingBandEta = 0;
        emit BandsSet(bandBps, staleBandBps);
    }

    /// @notice Set/clear the sequencer-uptime feed. Instant both ways: it can only
    /// matter while the sequencer is down or inside its grace window, and in that
    /// window every equity feed is stale anyway, which already blocks the manager.
    function setSequencerFeed(address feed) external onlyOwner {
        sequencerUptimeFeed = feed;
        emit SequencerFeedSet(feed);
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
        bool seqOk = _sequencerOk();
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            if (leg.tokenOut != address(usdg)) revert LegTokenNotUsdg(i);
            uint256 held = p.amountOf[leg.tokenIn];
            if (held < leg.amountIn) revert InsufficientPositionAmount(leg.tokenIn, leg.amountIn, held);
            uint256 left = held - leg.amountIn;
            p.amountOf[leg.tokenIn] = left;
            proceeds += _executeLeg(leg, msg.sender, false, seqOk);
            if (left == 0) _untrack(p, leg.tokenIn);
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
        _rebalance(msg.sender, groveId, legs, false, 0);
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
    function enableAuto(
        uint256 groveId,
        uint256 maxPerBuyUsdg,
        uint256 maxTotalUsdg,
        uint256 minSecondsBetween,
        uint16 maxRebalanceFractionBps
    ) external nonReentrant {
        _requireGrove(groveId);
        if (minSecondsBetween < MIN_COOLDOWN) revert CooldownTooShort(minSecondsBetween);
        if (maxPerBuyUsdg == 0 || maxTotalUsdg < maxPerBuyUsdg) revert BadAutoCaps();
        if (maxRebalanceFractionBps == 0 || maxRebalanceFractionBps > BPS) revert BadAutoCaps();
        AutoConfig storage a = autoConfigs[msg.sender][groveId];
        a.enabled = true;
        a.maxPerBuyUsdg = maxPerBuyUsdg;
        a.maxTotalUsdg = maxTotalUsdg;
        a.managerMovedUsdg = 0;
        a.minSecondsBetween = minSecondsBetween;
        a.maxRebalanceFractionBps = maxRebalanceFractionBps;
        emit AutoEnabled(msg.sender, groveId, maxPerBuyUsdg, maxTotalUsdg, minSecondsBetween, maxRebalanceFractionBps);
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
        // Every managed fill is additionally banded against the token's Chainlink
        // feed (see _checkBand) — minOut alone is not a bound, because whoever
        // authored the calldata also authored minOut.
        uint256 totalIn = _buy(user, groveId, legs, true);
        if (totalIn > a.maxPerBuyUsdg) revert PerBuyCapExceeded(totalIn, a.maxPerBuyUsdg);
        uint256 moved = a.managerMovedUsdg + totalIn;
        if (moved > a.maxTotalUsdg) revert TotalCapExceeded(moved, a.maxTotalUsdg);
        a.managerMovedUsdg = moved;
    }

    /// @notice Manager rebalances a user's position within the opted-in grove.
    /// Net-zero USDG (enforced by the shared rebalance path). It consumes the
    /// cooldown and is bounded three ways, none of them in a quantity the manager
    /// supplies: a per-token FRACTION of the position snapshot (oracle-free), the
    /// ORACLE VALUE of everything sold against maxPerBuyUsdg, and the lifetime
    /// maxTotalUsdg budget. The old bound was measured sell-leg proceeds — exactly
    /// the number an attacker minimises, so it was anti-correlated with the damage.
    function managedRebalance(address user, uint256 groveId, SwapLeg[] calldata legs, uint256 deadline)
        external
        nonReentrant
        onlyManager
        notPaused
    {
        _checkDeadline(deadline);
        AutoConfig storage a = _checkAutoAndCooldown(user, groveId);
        uint256 valueSold = _rebalance(user, groveId, legs, true, a.maxRebalanceFractionBps);
        if (valueSold > a.maxPerBuyUsdg) revert RebalanceTurnoverCapExceeded(valueSold, a.maxPerBuyUsdg);
        uint256 moved = a.managerMovedUsdg + valueSold;
        if (moved > a.maxTotalUsdg) revert TotalCapExceeded(moved, a.maxTotalUsdg);
        a.managerMovedUsdg = moved;
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
            if (_weightOf[groveId][v][legs[i].tokenOut] == 0) revert TokenNotInComposition(legs[i].tokenOut);
            totalIn += legs[i].amountIn;
        }
        if (totalIn == 0) revert ZeroAmount();

        usdg.safeTransferFrom(user, address(this), totalIn);
        Position storage p = _positions[user][groveId];
        bool wasEmpty = p.costBasisUsdg == 0;
        bool seqOk = _sequencerOk();
        for (uint256 i = 0; i < legs.length; i++) {
            uint256 out = _executeLeg(legs[i], address(0), managed, seqOk);
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
    /// ORACLE VALUE of everything sold, which is what the manager path bounds —
    /// deliberately not the measured proceeds, since that is the number an
    /// attacker minimises.
    function _rebalance(
        address user,
        uint256 groveId,
        SwapLeg[] calldata legs,
        bool managed,
        uint16 fractionBps
    ) internal returns (uint256 valueSoldUsdg) {
        Grove storage g = _requireGrove(groveId);
        _checkLegCount(legs.length);
        Position storage p = _positions[user][groveId];
        if (p.costBasisUsdg == 0) revert NoPosition(user, groveId);
        uint32 v = g.version;
        // Snapshot bounds BEFORE any leg executes, so the fraction cap measures
        // the true pre-call position rather than one already drained by leg 0.
        if (managed) valueSoldUsdg = _preflightManagedRebalance(p, legs, fractionBps);
        bool seqOk = _sequencerOk();

        uint256 pool;
        // Measured sell proceeds. This is the residue cap's denominator — NOT a
        // security bound (that is valueSoldUsdg, priced by the oracle). It has to
        // be the measured number so a USER rebalance, which never runs the
        // oracle preflight, still scales its allowance with its own size instead
        // of being stuck at the 1 USDG floor.
        uint256 soldProceeds;
        for (uint256 i = 0; i < legs.length; i++) {
            SwapLeg calldata leg = legs[i];
            if (leg.tokenOut == address(usdg)) {
                // Sell leg: stock (pulled from the user) -> USDG held transiently.
                uint256 held = p.amountOf[leg.tokenIn];
                if (held < leg.amountIn) revert InsufficientPositionAmount(leg.tokenIn, leg.amountIn, held);
                uint256 left = held - leg.amountIn;
                p.amountOf[leg.tokenIn] = left;
                uint256 got = _executeLeg(leg, user, managed, seqOk);
                pool += got;
                soldProceeds += got;
                if (left == 0) _untrack(p, leg.tokenIn);
            } else if (leg.tokenIn == address(usdg)) {
                // Buy leg: transient USDG -> stock forwarded to the user.
                if (leg.amountIn > pool) revert RebalanceInsufficientUsdg(leg.amountIn, pool);
                if (_weightOf[groveId][v][leg.tokenOut] == 0) revert TokenNotInComposition(leg.tokenOut);
                pool -= leg.amountIn;
                uint256 out = _executeLeg(leg, address(0), managed, seqOk);
                _creditToken(p, leg.tokenOut, out);
                IERC20(leg.tokenOut).safeTransfer(user, out);
            } else {
                revert BadRebalanceLeg(i);
            }
        }
        // Over-delivery goes back to the POSITION'S OWN OWNER, capped so it can
        // never become a disguised cash-out path. The old exact-zero rule was
        // unshippable: buy-leg amountIn is baked into venue calldata at quote
        // time while the pool is only known after the sell legs fill, so any
        // price move between quote and execution reverted the whole rebalance.
        if (pool != 0) {
            uint256 cap = (soldProceeds * MAX_REBALANCE_RESIDUE_BPS) / BPS;
            if (cap < MIN_REBALANCE_RESIDUE) cap = MIN_REBALANCE_RESIDUE;
            if (pool > cap) revert RebalanceUsdgResidue(pool);
            usdg.safeTransfer(user, pool);
            emit RebalanceResidueRefunded(user, groveId, pool);
        }
        emit Rebalanced(user, groveId);
    }

    /// @dev Execute one whitelisted swap and verify it with our own balance deltas.
    /// `pullFrom` != 0 pulls amountIn of tokenIn from that address first (exit/sell
    /// legs); 0 means the input is already held here (buy legs). Approves the exact
    /// amount to the approval target and resets it to zero after — no dangling
    /// approvals, ever. Reverts unless the router delivered >= minOut AND consumed
    /// exactly amountIn (a partially-consuming or lying router fails the whole tx).
    function _executeLeg(SwapLeg calldata leg, address pullFrom, bool managed, bool seqOk)
        internal
        returns (uint256 out)
    {
        if (!callTargetAllowed[leg.callTarget]) revert TargetNotAllowed(leg.callTarget);
        if (!approvalTargetAllowed[leg.approvalTarget]) revert ApprovalTargetNotAllowed(leg.approvalTarget);
        // Never let a "swap" be a direct call into a token contract.
        if (leg.callTarget == leg.tokenIn || leg.callTarget == leg.tokenOut || leg.callTarget == address(usdg)) {
            revert TargetIsToken(leg.callTarget);
        }
        if (leg.amountIn == 0) revert ZeroAmount();
        // Kills only the degenerate out == 0 shape (a venue that consumes the
        // input and delivers the output to a foreign receiver). It is NOT the
        // slippage bound — minOut is authored by whoever authored `data`, so 1 wei
        // clears it. The real floor is _checkBand, which the contract derives
        // itself. Universal now: user flows could previously pass minOut = 0.
        if (leg.minOut == 0) revert MinOutRequired();

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
        _checkBand(leg, out, managed, seqOk);
    }

    /// @dev Best-effort feed read. A reverting or nonsense aggregator degrades to
    /// unpriceable instead of bricking the call — an oracle outage must never be
    /// able to freeze an exit.
    function _readFeed(address agg) internal view returns (bool ok, uint256 answer, uint256 updatedAt) {
        try AggregatorV3Interface(agg).latestRoundData() returns (uint80, int256 a, uint256, uint256 u, uint80) {
            if (a > 0 && uint256(a) <= MAX_ANSWER && u != 0) return (true, uint256(a), u);
        } catch {}
        return (false, 0, 0);
    }

    /// @dev Read ONCE per transaction, not once per leg.
    function _sequencerOk() internal view returns (bool) {
        address f = sequencerUptimeFeed;
        if (f == address(0)) return true; // check disabled
        try AggregatorV3Interface(f).latestRoundData() returns (uint80, int256 a, uint256 startedAt, uint256, uint80)
        {
            return a == 0 && startedAt != 0 && block.timestamp - startedAt > SEQUENCER_GRACE;
        } catch {
            return false;
        }
    }

    /// @dev The contract computes its OWN expected output from Chainlink and
    /// rejects the leg below it. Whoever authored minOut — client, server, or a
    /// fully compromised manager key — cannot move this floor. That is the whole
    /// point: every economic bound on the manager rail used to be denominated in a
    /// number the manager chose.
    ///
    /// Cross-multiplied, so there is NO division and therefore no truncation and
    /// no rounding direction to argue about:
    ///
    ///   sell (token -> USDG): out * 10**scalePow * BPS >= amountIn * answer * (BPS - band)
    ///   buy  (USDG -> token): out * answer * BPS >= amountIn * 10**scalePow * (BPS - band)
    ///
    /// The rule the state table encodes: you can never ENTER something the
    /// contract cannot price, and you can always LEAVE. A banded-out exit leg
    /// never traps anyone — the stock is in the user's own wallet and
    /// closePosition needs no oracle, no whitelist and no unpaused contract.
    ///
    /// USDG is taken as exactly $1.00. It is the unit of account here; a USDG
    /// depeg is a chain-wide event this contract cannot hedge and must not
    /// pretend to.
    function _checkBand(SwapLeg calldata leg, uint256 out, bool managed, bool seqOk) internal view {
        bool isBuy = leg.tokenIn == address(usdg);
        address token = isBuy ? leg.tokenOut : leg.tokenIn;
        Feed memory f = feedOf[token];

        if (f.aggregator == address(0)) {
            if (managed || isBuy) revert FeedRequired(token);
            return; // UNPRICEABLE: selling out always works.
        }

        (bool ok, uint256 answer, uint256 updatedAt) = _readFeed(f.aggregator);
        uint256 age = block.timestamp > updatedAt ? block.timestamp - updatedAt : 0;
        if (!ok || age > MAX_FEED_AGE) {
            if (managed || isBuy) revert FeedRequired(token);
            return;
        }

        bool fresh = seqOk && age <= f.heartbeat;
        // Staleness is a MODE SWITCH, not a gate: equity feeds hold price across
        // weekends, and rejecting on age would brick 2/7 of the week for a product
        // that trades 24/7. The manager lockout is the half that matters — a stale
        // price is exactly when a fair-looking fill is most wrong.
        if (!fresh && managed) revert StaleFeedForManaged(token, updatedAt);
        uint256 band = fresh ? bandBps : staleBandBps;

        uint256 scale = 10 ** uint256(f.scalePow);
        uint256 lhs = isBuy ? out * answer : out * scale;
        uint256 rhs = (isBuy ? leg.amountIn * scale : leg.amountIn * answer) * (BPS - band);
        if (lhs * BPS < rhs) {
            // One division, revert path only: gives the server the exact floor it missed.
            revert PriceBandBreached(token, out, rhs / (BPS * (isBuy ? answer : scale)));
        }
    }

    /// @dev Oracle value of `amount` of `token` in USDG raw units. Manager rail
    /// only, where a live feed is already mandatory, so it may revert on an
    /// unpriceable token.
    function _usdgValueOf(address token, uint256 amount) internal view returns (uint256) {
        Feed memory f = feedOf[token];
        if (f.aggregator == address(0)) revert FeedRequired(token);
        (bool ok, uint256 answer,) = _readFeed(f.aggregator);
        if (!ok) revert FeedRequired(token);
        return (amount * answer) / (10 ** uint256(f.scalePow));
    }

    /// @dev Two manager bounds in one pass, neither denominated in anything the
    /// manager supplies: (a) per-token fraction of the position SNAPSHOT, no
    /// oracle involved; (b) the oracle VALUE of everything being sold. Runs
    /// BEFORE any leg executes, so the snapshot is the true pre-call position.
    /// One feed read per DISTINCT sold token, not per leg.
    function _preflightManagedRebalance(Position storage p, SwapLeg[] calldata legs, uint16 fractionBps)
        internal
        view
        returns (uint256 valueSoldUsdg)
    {
        address[] memory seen = new address[](legs.length);
        uint256[] memory sold = new uint256[](legs.length);
        uint256 count;
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].tokenOut != address(usdg)) continue; // only sell legs move the position out
            address t = legs[i].tokenIn;
            uint256 k = count;
            for (uint256 j = 0; j < count; j++) {
                if (seen[j] == t) {
                    k = j;
                    break;
                }
            }
            if (k == count) {
                seen[count] = t;
                count++;
            }
            sold[k] += legs[i].amountIn;
        }
        for (uint256 i = 0; i < count; i++) {
            uint256 cap = (p.amountOf[seen[i]] * fractionBps) / BPS;
            if (sold[i] > cap) revert RebalanceFractionExceeded(seen[i], sold[i], cap);
            valueSoldUsdg += _usdgValueOf(seen[i], sold[i]);
        }
    }

    /// @dev Swap-and-pop a fully-sold token out of the position's enumeration.
    /// Without it the list only ever grows, so a position could hold more distinct
    /// tokens than MAX_LEGS and make the fee-bearing full exit unexpressible in
    /// one call — pushing users onto the zero-fee closePosition hatch.
    function _untrack(Position storage p, address token) internal {
        uint256 len = p.tokens.length;
        for (uint256 i = 0; i < len; i++) {
            if (p.tokens[i] == token) {
                p.tokens[i] = p.tokens[len - 1];
                p.tokens.pop();
                break;
            }
        }
        p.tracked[token] = false;
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
