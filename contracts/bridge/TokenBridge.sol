// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./ManagerAccessControl.sol";

/// @notice Bridge where any token can be exchanged
contract TokenBridge is ManagerAccessControl {
    /// @notice It is a data type to determine whether a token is registered or not
    enum TokenStatus {
        NotRegistered,
        Registered
    }

    /// @notice Information about registered a token
    struct TokenInfo {
        ERC20 token;
        address tokenAddress;
        TokenStatus status;
    }

    /// @notice Information about registered tokens
    mapping(bytes32 => TokenInfo) public tokens;

    /// @notice Events that occur when a new token is registered
    event TokenRegistered(bytes32 tokenId, address tokenAddress);

    /// @notice Information about registered tokens
    /// @param _tokenId Unique ID of the token
    /// @param _tokenAddress The address of the smart contact of the token
    function registerToken(bytes32 _tokenId, address _tokenAddress) external onlyManager {
        require(_tokenAddress != address(0));
        ERC20 token = ERC20(_tokenAddress);

        bytes32 tokenId = sha256(abi.encodePacked(address(this), token.name(), token.symbol()));

        require(tokenId == _tokenId);

        require(tokens[_tokenId].status == TokenStatus.NotRegistered);

        tokens[_tokenId] = TokenInfo(token, _tokenAddress, TokenStatus.Registered);

        emit TokenRegistered(_tokenId, _tokenAddress);
    }
}
