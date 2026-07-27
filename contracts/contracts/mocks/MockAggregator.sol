// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAggregator — a controllable Chainlink AggregatorV3 for tests.
/// @notice Lets a test drive every branch of GroveManager._checkBand: a fair
/// price, a price the fill misses, a stale round (past heartbeat but inside
/// MAX_FEED_AGE), a dead round (past MAX_FEED_AGE), a non-positive answer, and
/// a reverting aggregator. Also serves as the sequencer-uptime feed, where the
/// convention is inverted: answer 0 means UP.
contract MockAggregator {
    uint8 public decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    uint256 private _startedAt;
    bool private _reverts;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        _answer = answer_;
        _updatedAt = block.timestamp;
        _startedAt = block.timestamp;
    }

    function setAnswer(int256 answer_) external {
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    /// @notice Age the round without changing the price — the "market closed" case.
    function setUpdatedAt(uint256 t) external {
        _updatedAt = t;
    }

    function setStartedAt(uint256 t) external {
        _startedAt = t;
    }

    /// @notice Make latestRoundData revert, to prove the contract degrades to
    /// "unpriceable" rather than bricking exits.
    function setReverts(bool r) external {
        _reverts = r;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!_reverts, "feed down");
        return (1, _answer, _startedAt, _updatedAt, 1);
    }
}
