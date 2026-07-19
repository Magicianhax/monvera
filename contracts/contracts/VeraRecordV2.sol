// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title VeraRecordV2 — verifiable AI recommendation ledger (X Layer).
/// @notice Every paid recommendation Vera sells on OKX.AI is committed here so
///         her track record is publicly auditable.
/// @dev V2 closes the V1 gap: the agent signature binds payer, usdSpent and
///      legCount (V1 signed only planId/risk/expiry), so a third party cannot
///      attach forged spend or payer data to a genuine signature.
contract VeraRecordV2 is EIP712, Ownable {
    bytes32 public constant RECOMMENDATION_TYPEHASH = keccak256(
        "RecommendationV2(bytes32 planId,bytes32 recHash,uint16 assessedRisk,uint16 maxRisk,uint256 expiry,address payer,uint256 usdSpent,uint16 legCount)"
    );

    address public agentSigner;
    mapping(bytes32 => bool) public used;

    event RecommendationCommitted(
        bytes32 indexed planId,
        address indexed payer,
        bytes32 recHash,
        uint16 assessedRisk,
        uint16 maxRisk,
        uint256 usdSpent,
        uint16 legCount,
        uint256 expiry
    );

    constructor(address _agentSigner) EIP712("VeraRecordV2", "1") Ownable(msg.sender) {
        agentSigner = _agentSigner;
    }

    function setAgentSigner(address s) external onlyOwner {
        agentSigner = s;
    }

    function record(
        bytes32 planId,
        bytes32 recHash,
        uint16 assessedRisk,
        uint16 maxRisk,
        uint256 expiry,
        address payer,
        uint256 usdSpent,
        uint16 legCount,
        bytes calldata signature
    ) external {
        require(!used[planId], "planId used");
        require(block.timestamp <= expiry, "expired");
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECOMMENDATION_TYPEHASH,
                    planId,
                    recHash,
                    assessedRisk,
                    maxRisk,
                    expiry,
                    payer,
                    usdSpent,
                    legCount
                )
            )
        );
        require(ECDSA.recover(digest, signature) == agentSigner, "bad signature");
        used[planId] = true;
        emit RecommendationCommitted(planId, payer, recHash, assessedRisk, maxRisk, usdSpent, legCount, expiry);
    }

    /// @notice View-only verification for indexers and auditors.
    function verify(
        bytes32 planId,
        bytes32 recHash,
        uint16 assessedRisk,
        uint16 maxRisk,
        uint256 expiry,
        address payer,
        uint256 usdSpent,
        uint16 legCount,
        bytes calldata signature
    ) external view returns (bool) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECOMMENDATION_TYPEHASH,
                    planId,
                    recHash,
                    assessedRisk,
                    maxRisk,
                    expiry,
                    payer,
                    usdSpent,
                    legCount
                )
            )
        );
        return ECDSA.recover(digest, signature) == agentSigner;
    }
}
