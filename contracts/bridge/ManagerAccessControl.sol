// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ManagerAccessControl is AccessControl, Ownable {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @dev Add `root` to the manager role as a member.
    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setRoleAdmin(MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    /// @dev Return `true` if the `account` is owner
    function isOwner(address account) public view virtual returns (bool) {
        return owner() == account;
    }

    /// @dev Restricted to manager.
    modifier onlyManager() {
        require(isManager(msg.sender), "Only managers can call.|NOT_MANAGER_ROLL");
        _;
    }

    /// @dev Return `true` if the `account` is manager
    function isManager(address account) public view virtual returns (bool) {
        return hasRole(MANAGER_ROLE, account);
    }

    /// @dev Add a manager.
    function addManager(address account) public virtual onlyOwner {
        grantRole(MANAGER_ROLE, account);
    }

    /// @dev Remove a manager.
    function removeManager(address account) public virtual onlyOwner {
        revokeRole(MANAGER_ROLE, account);
    }
}
