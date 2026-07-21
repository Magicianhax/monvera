// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IMonveraStaking {
    function stakedOf(address user) external view returns (uint256);
}

/// @title GroveCuratorRegistry — the public commitment behind curator vaults.
/// @notice Stakers above the curator threshold can have a Grove published under
/// their name and earn a share of that Grove's exit performance fees. Grove
/// creation itself stays on GroveManager (owner-run, adversarially hardened —
/// deliberately untouched); this registry is the ON-CHAIN, indexable record of
/// WHO curates each grove and WHAT share they are owed, so the split is a
/// published promise rather than a private spreadsheet:
///
///   - `curatorOf(groveId)` + `CuratorSet` events let anyone verify the terms
///     the treasury pays out under. Fees arrive at GroveManager's immutable
///     treasury; the treasury pays curators per THIS registry. Discrepancies
///     are publicly provable from two event streams.
///   - shareBps is capped at 50% — the treasury can never promise away more
///     than half of a grove's fees, keeping seasons + buyback funded.
///   - `curatorEligible` reads the staking contract, making the stake gate a
///     public rule instead of an app-side whim. The threshold is settable
///     (owner) because tiers are a product decision — but every change emits.
///
/// No funds ever touch this contract.
contract GroveCuratorRegistry is Ownable2Step {
    uint16 public constant BPS = 10_000;
    /// @dev The treasury may never owe curators more than half a grove's fees.
    uint16 public constant MAX_SHARE_BPS = 5_000;

    /// @notice The staking contract whose balances gate curator eligibility.
    IMonveraStaking public immutable staking;
    /// @notice Minimum staked $MONVERA to be curator-eligible.
    uint256 public minCuratorStake;

    struct Entry {
        address curator;
        uint16 shareBps;
    }

    mapping(uint256 => Entry) private _entries;

    event MinCuratorStakeSet(uint256 minStake);
    event CuratorSet(uint256 indexed groveId, address indexed curator, uint16 shareBps);
    event CuratorCleared(uint256 indexed groveId, address indexed curator);

    error ZeroAddress();
    error ShareTooHigh(uint16 shareBps);
    error CuratorNotEligible(address curator, uint256 staked, uint256 required);

    constructor(address staking_, uint256 minCuratorStake_) Ownable(msg.sender) {
        if (staking_ == address(0)) revert ZeroAddress();
        staking = IMonveraStaking(staking_);
        minCuratorStake = minCuratorStake_;
        emit MinCuratorStakeSet(minCuratorStake_);
    }

    /// @notice Set the stake threshold for curator eligibility.
    function setMinCuratorStake(uint256 minStake) external onlyOwner {
        minCuratorStake = minStake;
        emit MinCuratorStakeSet(minStake);
    }

    /// @notice Commit a grove's curator and fee share. The curator must clear
    /// the stake gate AT ASSIGNMENT; later unstaking doesn't retro-revoke the
    /// entry (the owner clears entries as a product decision — dropping below
    /// the gate is grounds, not automation).
    function setCurator(uint256 groveId, address curator, uint16 shareBps) external onlyOwner {
        if (curator == address(0)) revert ZeroAddress();
        if (shareBps > MAX_SHARE_BPS) revert ShareTooHigh(shareBps);
        uint256 staked = staking.stakedOf(curator);
        if (staked < minCuratorStake) revert CuratorNotEligible(curator, staked, minCuratorStake);
        _entries[groveId] = Entry({curator: curator, shareBps: shareBps});
        emit CuratorSet(groveId, curator, shareBps);
    }

    /// @notice Remove a grove's curator entry (delisting, gate breach, etc.).
    function clearCurator(uint256 groveId) external onlyOwner {
        address curator = _entries[groveId].curator;
        delete _entries[groveId];
        emit CuratorCleared(groveId, curator);
    }

    // ---------------------------------------------------------------- views

    /// @notice A grove's committed curator terms (zeroes if none).
    function curatorOf(uint256 groveId) external view returns (address curator, uint16 shareBps) {
        Entry storage e = _entries[groveId];
        return (e.curator, e.shareBps);
    }

    /// @notice Whether an address currently clears the curator stake gate.
    function curatorEligible(address who) external view returns (bool) {
        return staking.stakedOf(who) >= minCuratorStake;
    }
}
