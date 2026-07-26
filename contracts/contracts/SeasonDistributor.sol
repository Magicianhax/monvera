// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title SeasonDistributor — merkle claims for Monvera staking seasons.
/// @notice Each season is a snapshot computation everyone can reproduce from the
/// published off-chain builder (src/lib/season/compute.ts): the pool is split
/// into one FLAT daily bucket per season day, and each day's bucket is divided by
/// that day's stake-time (token-seconds) —
/// reward_i = Σ_days ( dayPool × yourTokenSeconds_day / everyonesTokenSeconds_day ),
/// with an empty day's bucket rolled forward to the next. Token-seconds come from
/// MonveraStaking's event stream, so a published root is CHECKABLE, not trusted.
/// The owner's only powers are to
/// open a season (root + funded pool) and to sweep leftovers after a season's
/// claim window closes — an open window's funds cannot be touched:
///
///   - A season's root and pool are immutable once opened.
///   - claim() is permissionless, pays exactly the leaf amount, once.
///   - sweep() works only after the season's claimDeadline, and only for
///     whatever remains unclaimed of THAT season's accounted pool. Funds of
///     other seasons are never sweepable — per-season accounting, not
///     balance-of sweeps.
contract SeasonDistributor is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice The reward token ($MONVERA). Fixed at deploy.
    IERC20 public immutable token;

    struct Season {
        bytes32 root;
        uint256 pool; // total funded for this season
        uint256 claimed; // running total of claims paid
        uint64 claimDeadline; // after this, owner may sweep the remainder
    }

    uint256 public seasonCount;
    mapping(uint256 => Season) public seasons;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event SeasonOpened(uint256 indexed seasonId, bytes32 root, uint256 pool, uint64 claimDeadline);
    event Claimed(uint256 indexed seasonId, address indexed account, uint256 amount);
    event Swept(uint256 indexed seasonId, uint256 amount);

    error ZeroAddress();
    error ZeroPool();
    error BadDeadline();
    error SeasonUnknown(uint256 seasonId);
    error AlreadyClaimed(uint256 seasonId, address account);
    error InvalidProof();
    error PoolExhausted(uint256 seasonId);
    error WindowStillOpen(uint64 claimDeadline);
    error RenounceDisabled();

    constructor(address token_) Ownable(msg.sender) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
    }

    /// @notice Open a season: pulls `pool` tokens from the caller and locks
    /// the root. Claims run until `claimDeadline` (min 30 days out, so a
    /// too-short window can't be set even by mistake).
    function openSeason(bytes32 root, uint256 pool, uint64 claimDeadline)
        external
        onlyOwner
        returns (uint256 seasonId)
    {
        if (pool == 0) revert ZeroPool();
        if (root == bytes32(0)) revert InvalidProof();
        if (claimDeadline < block.timestamp + 30 days) revert BadDeadline();
        token.safeTransferFrom(msg.sender, address(this), pool);
        seasonId = seasonCount++;
        seasons[seasonId] = Season({root: root, pool: pool, claimed: 0, claimDeadline: claimDeadline});
        emit SeasonOpened(seasonId, root, pool, claimDeadline);
    }

    /// @notice Claim `amount` for `account` in `seasonId` with a merkle proof
    /// over leaf keccak256(abi.encodePacked(seasonId, account, amount)).
    /// Anyone may submit for any account; funds always go to the account.
    function claim(uint256 seasonId, address account, uint256 amount, bytes32[] calldata proof) external {
        Season storage s = seasons[seasonId];
        if (s.root == bytes32(0)) revert SeasonUnknown(seasonId);
        if (hasClaimed[seasonId][account]) revert AlreadyClaimed(seasonId, account);
        bytes32 leaf = keccak256(abi.encodePacked(seasonId, account, amount));
        if (!MerkleProof.verify(proof, s.root, leaf)) revert InvalidProof();
        uint256 claimedAfter = s.claimed + amount;
        if (claimedAfter > s.pool) revert PoolExhausted(seasonId);
        hasClaimed[seasonId][account] = true;
        s.claimed = claimedAfter;
        token.safeTransfer(account, amount);
        emit Claimed(seasonId, account, amount);
    }

    /// @notice After a season's claim window closes, return its unclaimed
    /// remainder to the owner (back to the treasury for the next season).
    function sweep(uint256 seasonId) external onlyOwner {
        Season storage s = seasons[seasonId];
        if (s.root == bytes32(0)) revert SeasonUnknown(seasonId);
        if (block.timestamp <= s.claimDeadline) revert WindowStillOpen(s.claimDeadline);
        uint256 remainder = s.pool - s.claimed;
        s.claimed = s.pool;
        if (remainder > 0) token.safeTransfer(owner(), remainder);
        emit Swept(seasonId, remainder);
    }

    /// @notice Renounce is disabled. This contract is immutable with no re-init
    /// path, so dropping ownership to address(0) would permanently brick
    /// openSeason and sweep and strand every future season's remainder. Ownership
    /// can still be TRANSFERRED (Ownable2Step) — it just can never be abandoned.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }
}
