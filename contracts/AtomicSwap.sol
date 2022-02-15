// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ManagerAccessControl.sol";

contract AtomicSwap is ManagerAccessControl {
    address private swapTokenAddress;
    uint256 private depositTimeLock;
    uint256 private withdrawTimeLock;

    /// @dev Add `root` to the manager role as a member.
    constructor(
        address _tokenAddress,
        uint256 _depositTimeLock,
        uint256 _withdrawTimeLock
    ) {
        swapTokenAddress = _tokenAddress;
        depositTimeLock = _depositTimeLock;
        withdrawTimeLock = _withdrawTimeLock;
    }

    event ChangeDepositTimeLock(uint256 _timeLock);
    event ChangeWithdrawTimeLock(uint256 _timeLock);

    function changeDepositTimeLock(uint256 _depositTimeLock) public onlyManager {
        depositTimeLock = _depositTimeLock;
        emit ChangeDepositTimeLock(depositTimeLock);
    }

    function changeWithdrawTimeLock(uint256 _withdrawTimeLock) public onlyManager {
        withdrawTimeLock = _withdrawTimeLock;
        emit ChangeWithdrawTimeLock(withdrawTimeLock);
    }

    enum States {
        INVALID,
        OPEN,
        CLOSED,
        EXPIRED
    }

    struct DepositLockBox {
        uint256 timeLock;
        uint256 amount;
        address traderAddress;
        bytes32 secretLock;
        bytes secretKey;
        uint256 createTimestamp;
    }

    mapping(bytes32 => DepositLockBox) private depositBoxes;
    mapping(bytes32 => States) private depositBoxStates;

    event OpenDeposit(bytes32 _boxID, bytes32 _secretLock);
    event ExpireDeposit(bytes32 _boxID);
    event CloseDeposit(bytes32 _boxID, bytes _secretKey);

    modifier onlyInvalidDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.INVALID);
        _;
    }

    modifier onlyOpenDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.OPEN);
        _;
    }

    modifier onlyClosedDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.CLOSED);
        _;
    }

    modifier onlyExpirableDepositBoxes(bytes32 _boxID) {
        require(depositBoxes[_boxID].timeLock + depositBoxes[_boxID].createTimestamp <= block.timestamp);
        _;
    }

    modifier onlyWithSecretKeyDepositBoxes(bytes32 _boxID, bytes memory _secretKey) {
        require(depositBoxes[_boxID].secretLock == sha256(_secretKey));
        _;
    }

    function openDeposit(
        bytes32 _boxID,
        uint256 _amount,
        bytes32 _secretLock
    ) public onlyInvalidDepositBoxes(_boxID) {
        require(depositBoxStates[_boxID] == States.INVALID);
        // Transfer value from the ERC20 trader to this contract.
        IERC20 token = IERC20(swapTokenAddress);
        require(_amount <= token.allowance(msg.sender, address(this)));
        require(token.transferFrom(msg.sender, address(this), _amount));

        // Store the details of the box.
        DepositLockBox memory box = DepositLockBox({
            timeLock: depositTimeLock,
            amount: _amount,
            traderAddress: msg.sender,
            secretLock: _secretLock,
            secretKey: new bytes(0),
            createTimestamp: block.timestamp
        });

        depositBoxes[_boxID] = box;
        depositBoxStates[_boxID] = States.OPEN;
        emit OpenDeposit(_boxID, _secretLock);
    }

    function closeDeposit(bytes32 _boxID, bytes memory _secretKey)
        public
        onlyOpenDepositBoxes(_boxID)
        onlyWithSecretKeyDepositBoxes(_boxID, _secretKey)
    {
        // Close the box.
        depositBoxes[_boxID].secretKey = _secretKey;
        depositBoxStates[_boxID] = States.CLOSED;

        // No Transfer

        emit CloseDeposit(_boxID, _secretKey);
    }

    function expireDeposit(bytes32 _boxID) public onlyOpenDepositBoxes(_boxID) onlyExpirableDepositBoxes(_boxID) {
        // Expire the box.
        DepositLockBox memory box = depositBoxes[_boxID];
        depositBoxStates[_boxID] = States.EXPIRED;

        // Transfer the ERC20 value from this contract back to the ERC20 trader.
        IERC20 token = IERC20(swapTokenAddress);
        require(token.transfer(box.traderAddress, box.amount));

        emit ExpireDeposit(_boxID);
    }

    function checkDeposit(bytes32 _boxID)
        public
        view
        returns (
            States states,
            uint256 timeLock,
            uint256 amount,
            address tokenAddress,
            bytes32 secretLock,
            uint256 createTimestamp
        )
    {
        DepositLockBox memory box = depositBoxes[_boxID];
        States state = depositBoxStates[_boxID];
        return (state, box.timeLock, box.amount, swapTokenAddress, box.secretLock, box.createTimestamp);
    }

    function checkSecretKeyDeposit(bytes32 _boxID)
        public
        view
        onlyClosedDepositBoxes(_boxID)
        returns (bytes memory secretKey)
    {
        DepositLockBox memory box = depositBoxes[_boxID];
        return box.secretKey;
    }

    struct WithdrawLockBox {
        uint256 timeLock;
        uint256 amount;
        address withdrawAddress;
        bytes32 secretLock;
        bytes secretKey;
        uint256 createTimestamp;
    }

    mapping(bytes32 => WithdrawLockBox) private withdrawBoxes;
    mapping(bytes32 => States) private withdrawBoxStates;

    event OpenWithdraw(bytes32 _boxID, address _withdrawAddress, bytes32 _secretLock);
    event ExpireWithdraw(bytes32 _boxID);
    event CloseWithdraw(bytes32 _boxID, bytes _secretKey);

    modifier onlyInvalidWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.INVALID);
        _;
    }

    modifier onlyOpenWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.OPEN);
        _;
    }

    modifier onlyClosedWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.CLOSED);
        _;
    }

    modifier onlyExpirableWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxes[_boxID].timeLock + withdrawBoxes[_boxID].createTimestamp <= block.timestamp);
        _;
    }

    modifier onlyWithSecretKeyWithdrawBoxes(bytes32 _boxID, bytes memory _secretKey) {
        require(withdrawBoxes[_boxID].secretLock == sha256(_secretKey));
        _;
    }

    function openWithdraw(
        bytes32 _boxID,
        uint256 _amount,
        address _withdrawAddress,
        bytes32 _secretLock
    ) public onlyManager onlyInvalidWithdrawBoxes(_boxID) {
        require(withdrawBoxStates[_boxID] == States.INVALID);
        // Transfer value from the ERC20 trader to this contract.
        IERC20 token = IERC20(swapTokenAddress);
        require(_amount <= token.balanceOf(address(this)), "ERC20: insufficient liquidity");

        // Store the details of the box.
        WithdrawLockBox memory box = WithdrawLockBox({
            timeLock: withdrawTimeLock,
            amount: _amount,
            withdrawAddress: _withdrawAddress,
            secretLock: _secretLock,
            secretKey: new bytes(0),
            createTimestamp: block.timestamp
        });
        withdrawBoxes[_boxID] = box;
        withdrawBoxStates[_boxID] = States.OPEN;
        emit OpenWithdraw(_boxID, _withdrawAddress, _secretLock);
    }

    function closeWithdraw(bytes32 _boxID, bytes memory _secretKey)
        public
        onlyOpenWithdrawBoxes(_boxID)
        onlyWithSecretKeyWithdrawBoxes(_boxID, _secretKey)
    {
        WithdrawLockBox memory box = withdrawBoxes[_boxID];
        IERC20 token = IERC20(swapTokenAddress);
        require(box.amount <= token.balanceOf(address(this)), "ERC20: insufficient liquidity");

        // Close the box.
        withdrawBoxes[_boxID].secretKey = _secretKey;
        withdrawBoxStates[_boxID] = States.CLOSED;

        // Transfer the ERC20 funds from this contract to the withdrawing trader.
        require(token.transfer(box.withdrawAddress, box.amount));

        emit CloseWithdraw(_boxID, _secretKey);
    }

    function expireWithdraw(bytes32 _boxID) public onlyOpenWithdrawBoxes(_boxID) onlyExpirableWithdrawBoxes(_boxID) {
        // Expire the box.
        withdrawBoxStates[_boxID] = States.EXPIRED;

        emit ExpireWithdraw(_boxID);
    }

    function checkWithdraw(bytes32 _boxID)
        public
        view
        returns (
            States states,
            uint256 timeLock,
            uint256 amount,
            address tokenAddress,
            address withdrawAddress,
            bytes32 secretLock,
            uint256 createTimestamp
        )
    {
        WithdrawLockBox memory box = withdrawBoxes[_boxID];
        States state = withdrawBoxStates[_boxID];
        return (
            state,
            box.timeLock,
            box.amount,
            swapTokenAddress,
            box.withdrawAddress,
            box.secretLock,
            box.createTimestamp
        );
    }

    function checkSecretKeyWithdraw(bytes32 _boxID)
        public
        view
        onlyClosedWithdrawBoxes(_boxID)
        returns (bytes memory secretKey)
    {
        WithdrawLockBox memory box = withdrawBoxes[_boxID];
        return box.secretKey;
    }
}
