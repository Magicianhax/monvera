// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title VeraRecord
/// @notice Monvera's on-chain trust layer on Robinhood Chain. Trading itself
/// settles through the Arcus spot RFQ (each leg signed by the user's EOA via
/// Permit2), so no contract routes funds — but every AI recommendation is still
/// verified and recorded here, in the same batched transaction as the buys:
///
///   1. VERIFY: the plan carries Vera's EIP-712 `RiskInference` signature; it is
///      rejected unless the signature is hers, assessedRisk <= maxRisk, and the
///      inference hasn't expired. The risk gate is checked on-chain, not by us.
///   2. RECORD: emits the same `RecommendationCommitted` / `AllocationExecuted`
///      events Monvera's readers already index — a permanent, uneditable track
///      record for the agent.
///
/// planIds are single-use, so a signed plan can't be replayed to pad the record.
contract VeraRecord is EIP712, Ownable {
    /// @dev The trusted off-chain agent signer (Vera's signing key).
    address public agentSigner;

    /// @dev RiskInference: risk values are basis points (0..10000).
    bytes32 public constant RISK_TYPEHASH =
        keccak256("RiskInference(bytes32 planId,uint16 assessedRisk,uint16 maxRisk,uint256 expiry)");

    /// @dev Replay guard — each signed plan can be recorded exactly once.
    mapping(bytes32 => bool) public committed;

    event AgentSignerUpdated(address indexed signer);
    event RecommendationCommitted(
        bytes32 indexed planId, address indexed user, bytes32 recHash, uint16 riskScore, uint256 agentId
    );
    event AllocationExecuted(bytes32 indexed planId, address indexed user, uint256 usdcSpent, uint256 legCount);

    error InferenceExpired();
    error RiskCeilingBreached(uint16 assessed, uint16 maxRisk);
    error BadSigner(address recovered);
    error PlanAlreadyRecorded(bytes32 planId);

    constructor(address _agentSigner) EIP712("VeraRecord", "1") Ownable(msg.sender) {
        agentSigner = _agentSigner;
        emit AgentSignerUpdated(_agentSigner);
    }

    function setAgentSigner(address _signer) external onlyOwner {
        agentSigner = _signer;
        emit AgentSignerUpdated(_signer);
    }

    /// @notice View-only check that `signature` is a valid, fresh, within-ceiling
    /// agent signature over the inference (kept API-compatible with the old verifier).
    function verify(
        bytes32 planId,
        uint16 assessedRisk,
        uint16 maxRisk,
        uint256 expiry,
        bytes calldata signature
    ) public view returns (bool) {
        if (block.timestamp > expiry) revert InferenceExpired();
        if (assessedRisk > maxRisk) revert RiskCeilingBreached(assessedRisk, maxRisk);
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(RISK_TYPEHASH, planId, assessedRisk, maxRisk, expiry)));
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != agentSigner) revert BadSigner(recovered);
        return true;
    }

    /// @notice Verify Vera's signed inference and write the permanent record.
    /// Called inside the same batched transaction as the Arcus settlements, so
    /// the record and the actual buys land atomically. `user` is the investing
    /// EOA (the batch is relayed, so msg.sender is the account-abstraction
    /// relayer, not the user); trust derives from the agent signature + the
    /// single-use planId, not from the submitter.
    function record(
        bytes32 planId,
        bytes32 recHash,
        uint16 assessedRisk,
        uint16 maxRisk,
        uint256 expiry,
        bytes calldata signature,
        address user,
        uint256 agentId,
        uint256 usdSpent,
        uint256 legCount
    ) external {
        if (committed[planId]) revert PlanAlreadyRecorded(planId);
        verify(planId, assessedRisk, maxRisk, expiry, signature);
        committed[planId] = true;
        emit RecommendationCommitted(planId, user, recHash, assessedRisk, agentId);
        emit AllocationExecuted(planId, user, usdSpent, legCount);
    }
}
