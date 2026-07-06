// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title InferenceVerifier
/// @notice Verifies the Stax AI agent's signed risk inference on-chain (EIP-712).
/// Execution of an allocation is gated on a fresh, signed inference whose assessed
/// risk does not exceed the user's stated ceiling. This is the "AI inference
/// verified on-chain" leg required by the hackathon rubric. The trusted signer can
/// later be swapped for an Allora consumer contract if/when it is live on Mantle.
contract InferenceVerifier is EIP712, Ownable {
    /// @dev The trusted off-chain agent signer (the model's signing key).
    address public agentSigner;

    /// @dev RiskInference: risk values are basis points (0..10000).
    bytes32 public constant RISK_TYPEHASH =
        keccak256("RiskInference(bytes32 planId,uint16 assessedRisk,uint16 maxRisk,uint256 expiry)");

    event AgentSignerUpdated(address indexed signer);

    error InferenceExpired();
    error RiskCeilingBreached(uint16 assessed, uint16 maxRisk);
    error BadSigner(address recovered);

    constructor(address _agentSigner) EIP712("StaxInferenceVerifier", "1") Ownable(msg.sender) {
        agentSigner = _agentSigner;
        emit AgentSignerUpdated(_agentSigner);
    }

    function setAgentSigner(address _signer) external onlyOwner {
        agentSigner = _signer;
        emit AgentSignerUpdated(_signer);
    }

    /// @notice Reverts unless `signature` is a valid agent signature over the inference,
    /// AND assessedRisk <= maxRisk, AND not expired. Returns true on success.
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
}
