// contracts/swap/GameSwap.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./access/ManagerControl.sol";
import "./GameToken.sol";

contract GameSwap is Ownable, ManagerControl, Pausable {
    constructor(address _tokenAddress) {
        swapTokenAddress = _tokenAddress;
        useSwapLimitPerDay = false;
    }

    address private swapTokenAddress;

    bool private useSwapLimitPerDay;

    uint256 private swapLimitAmountPerDay = 0;

    mapping(uint256 => uint256) private swapTotalAmountToday;

    enum States {
        INVALID,
        OPEN,
        CLOSED
    }

    struct LockBox {
        address traderAddress;
        uint256 amount;
        uint256 createTimestamp;
    }

    event ChangeSwapLimitPerDayAmount(uint256 amount);
    event ResetTodaySwapLimitAmount(uint256 amount);
    event EnabledSwapLimitPerDay();
    event DisabledSwapLimitPerDay();

    function today() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function enableSwapLimitPerDay() public onlyRole(MANAGER_ROLE) {
        useSwapLimitPerDay = true;
        emit EnabledSwapLimitPerDay();
    }

    function disableSwapLimitPerDay() public onlyRole(MANAGER_ROLE) {
        useSwapLimitPerDay = false;
        emit DisabledSwapLimitPerDay();
    }

    function isSwapLimitPerDay() public view returns (bool) {
        return useSwapLimitPerDay;
    }

    function setSwapLimitPerDayAmount(uint256 amount) public virtual onlyRole(MANAGER_ROLE) {
        swapLimitAmountPerDay = amount;
        emit ChangeSwapLimitPerDayAmount(swapLimitAmountPerDay);
    }

    function getTodaySwappedAmount() public view virtual returns (uint256) {
        return swapTotalAmountToday[today()];
    }

    function getTodaySwappableAmount() public view virtual returns (uint256) {
        uint256 swappedAmount = swapTotalAmountToday[today()];
        if (swapLimitAmountPerDay < swappedAmount) return 0;
        return SafeMath.sub(swapLimitAmountPerDay, swappedAmount);
    }

    function resetTodaySwapAmount() public virtual onlyRole(MANAGER_ROLE) {
        swapTotalAmountToday[today()] = 0;
        emit ResetTodaySwapLimitAmount(swapTotalAmountToday[today()]);
    }

    event OpenDeposit(bytes32 boxID, address requestor, uint256 amount);
    event CloseDeposit(bytes32 boxID, address requestor, uint256 amount);

    mapping(bytes32 => LockBox) private depositBoxes;
    mapping(bytes32 => States) private depositBoxStates;

    modifier onlyOpenDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.OPEN);
        _;
    }

    modifier onlyEmptyDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.INVALID);
        _;
    }

    function pause() public onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    function openDepositToken2Point(bytes32 _boxID, uint256 _amount)
        public
        onlyEmptyDepositBoxes(_boxID)
        whenNotPaused
    {
        GameToken token = GameToken(swapTokenAddress);

        require(_amount <= token.allowance(msg.sender, address(this)));
        require(token.transferFrom(msg.sender, address(this), _amount));

        LockBox memory box = LockBox({ amount: _amount, traderAddress: msg.sender, createTimestamp: block.timestamp });

        depositBoxes[_boxID] = box;
        depositBoxStates[_boxID] = States.OPEN;
        emit OpenDeposit(_boxID, msg.sender, _amount);
    }

    function closeDepositToken2Point(bytes32 _boxID)
        public
        onlyRole(MANAGER_ROLE)
        onlyOpenDepositBoxes(_boxID)
        whenNotPaused
    {
        GameToken token = GameToken(swapTokenAddress);
        LockBox memory box = depositBoxes[_boxID];

        require(box.amount <= token.balanceOf(address(this)), "insufficient close amounts.");
        token.burn(address(this), box.amount);

        depositBoxStates[_boxID] = States.CLOSED;
        emit CloseDeposit(_boxID, box.traderAddress, box.amount);
    }

    function checkDepositToken2Point(bytes32 _boxID)
        public
        view
        returns (
            States states,
            address traderAddress,
            uint256 amount,
            uint256 createTimestamp
        )
    {
        LockBox memory box = depositBoxes[_boxID];
        States state = depositBoxStates[_boxID];
        return (state, box.traderAddress, box.amount, box.createTimestamp);
    }

    event OpenWithdraw(bytes32 boxID, address requestor, uint256 amount);
    event CloseWithdraw(bytes32 boxID, address requestor, uint256 amount);

    mapping(bytes32 => LockBox) private withdrawBoxes;
    mapping(bytes32 => States) private withdrawBoxStates;

    modifier onlyOpenWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.OPEN);
        _;
    }

    modifier onlyEmptyWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.INVALID);
        _;
    }

    function openWithdrawPoint2Token(
        bytes32 _boxID,
        address _beneficiary,
        uint256 _amount
    ) public onlyRole(MANAGER_ROLE) onlyEmptyWithdrawBoxes(_boxID) whenNotPaused {
        GameToken token = GameToken(swapTokenAddress);

        if (useSwapLimitPerDay && swapLimitAmountPerDay < SafeMath.add(swapTotalAmountToday[today()], _amount)) {
            revert(string(abi.encodePacked("SwapControl: Daily Swap Limit Exceeded.")));
        }
        swapTotalAmountToday[today()] = SafeMath.add(swapTotalAmountToday[today()], _amount);
        token.mint(address(this), _amount);

        LockBox memory box = LockBox({
            amount: _amount,
            traderAddress: _beneficiary,
            createTimestamp: block.timestamp
        });

        withdrawBoxes[_boxID] = box;
        withdrawBoxStates[_boxID] = States.OPEN;
        emit OpenWithdraw(_boxID, _beneficiary, _amount);
    }

    function closeWithdrawPoint2Token(bytes32 _boxID)
        public
        onlyRole(MANAGER_ROLE)
        onlyOpenWithdrawBoxes(_boxID)
        whenNotPaused
    {
        GameToken token = GameToken(swapTokenAddress);
        LockBox memory box = withdrawBoxes[_boxID];

        require(box.amount <= token.balanceOf(address(this)), "insufficient close amounts.");
        token.transfer(box.traderAddress, box.amount);

        withdrawBoxStates[_boxID] = States.CLOSED;
        emit CloseWithdraw(_boxID, box.traderAddress, box.amount);
    }

    function checkWithdrawPoint2Token(bytes32 _boxID)
        public
        view
        returns (
            States states,
            address traderAddress,
            uint256 amount,
            uint256 createTimestamp
        )
    {
        LockBox memory box = withdrawBoxes[_boxID];
        States state = withdrawBoxStates[_boxID];
        return (state, box.traderAddress, box.amount, box.createTimestamp);
    }
}
