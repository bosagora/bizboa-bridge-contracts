// contracts/access/MinterControl.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MinterControl is AccessControl, Ownable {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor () {
        _setupRole(MINTER_ROLE, msg.sender);
        _setRoleAdmin(MINTER_ROLE, DEFAULT_ADMIN_ROLE);
    }


    /// @dev Return `true` if the `account` is minter
    function isMinter(address account) public view virtual returns (bool) {
        return hasRole(MINTER_ROLE, account);
    }

    /// @dev Add a minter.
    function addMinter(address account) public virtual onlyOwner {
        grantRole(MINTER_ROLE, account);
    }

    /// @dev Remove a minter.
    function removeMinter(address account) public virtual onlyOwner {
        revokeRole(MINTER_ROLE, account);
    }


}
