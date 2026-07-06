// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title IdentityRegistry (ERC-8004-style)
/// @notice Minimal on-chain identity for AI agents: each agent is an ERC-721 whose
/// tokenURI points to its "agent card" (capabilities, endpoint). Stax registers its
/// allocation agent here and stamps the resulting agentId into every recommendation,
/// making each piece of advice provably attributable to a reputation-bearing on-chain
/// agent. Aligned with the ERC-8004 Identity + Reputation registry pattern, kept minimal.
contract IdentityRegistry is ERC721, Ownable {
    uint256 public nextAgentId = 1;

    mapping(uint256 => string) private _agentCard; // agentId => agent card URI (capabilities/endpoint)
    mapping(uint256 => uint256) public reputationScore; // agentId => aggregate feedback

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentCard);
    event FeedbackGiven(uint256 indexed agentId, uint16 score, bytes32 indexed planId);

    constructor() ERC721("Stax Agent Identity", "STAXID") Ownable(msg.sender) {}

    /// @notice Register a new agent identity; returns its agentId (the ERC-721 tokenId).
    function register(address agentOwner, string calldata agentCard)
        external
        onlyOwner
        returns (uint256 agentId)
    {
        agentId = nextAgentId++;
        _safeMint(agentOwner, agentId);
        _agentCard[agentId] = agentCard;
        emit AgentRegistered(agentId, agentOwner, agentCard);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _agentCard[agentId];
    }

    function exists(uint256 agentId) external view returns (bool) {
        return _ownerOf(agentId) != address(0);
    }

    /// @notice Lightweight reputation: aggregate post-execution feedback for an agent.
    function giveFeedback(uint256 agentId, uint16 score, bytes32 planId) external onlyOwner {
        _requireOwned(agentId);
        reputationScore[agentId] += score;
        emit FeedbackGiven(agentId, score, planId);
    }
}
