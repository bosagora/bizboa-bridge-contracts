// contracts/swap/GameSwap.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./access/ManagerControl.sol";

contract MetaSwap is Ownable, ManagerControl, Pausable {
    uint256 private BOA_UNIT_PER_COIN = 1_000_000_000_000_000_000;

    constructor() {}

    enum States {
        INVALID,
        OPEN,
        CLOSED
    }

    struct LockBox {
        address payable traderAddress;
        uint256 amount;
        uint256 withdraw_amount;
        uint256 createTimestamp;
    }

    event OpenDeposit(bytes32 boxID, address requestor, uint256 amount);
    event CloseDeposit(bytes32 boxID, address requestor, uint256 amount);

    mapping(bytes32 => LockBox) private depositBoxes;
    mapping(bytes32 => States) private depositBoxStates;

    modifier onlyOpenDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.OPEN, "The deposit box is not open.|NOT_OPEN_DEPOSIT");
        _;
    }

    modifier onlyEmptyDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.INVALID, "The deposit box already exists.|ALREADY_OPEN_DEPOSIT");
        _;
    }

    function pause() public onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    function openDepositBOA2Point(bytes32 _boxID) public payable onlyEmptyDepositBoxes(_boxID) whenNotPaused {
        LockBox memory box = LockBox({
            amount: msg.value,
            withdraw_amount: 0,
            traderAddress: payable(msg.sender),
            createTimestamp: block.timestamp
        });

        depositBoxes[_boxID] = box;
        depositBoxStates[_boxID] = States.OPEN;
        emit OpenDeposit(_boxID, msg.sender, msg.value);
    }

    function closeDepositBOA2Point(bytes32 _boxID)
        public
        onlyRole(MANAGER_ROLE)
        onlyOpenDepositBoxes(_boxID)
        whenNotPaused
    {
        depositBoxStates[_boxID] = States.CLOSED;
        LockBox memory box = depositBoxes[_boxID];
        emit CloseDeposit(_boxID, box.traderAddress, box.amount);
    }

    function checkDepositBOA2Point(bytes32 _boxID)
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
        require(withdrawBoxStates[_boxID] == States.OPEN, "The withdraw box is not open.|NOT_OPEN_WITHDRAW");
        _;
    }

    modifier onlyEmptyWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.INVALID, "The withdraw box already exists.|ALREADY_OPEN_WITHDRAW");
        _;
    }

    function openWithdrawPoint2BOA(
        bytes32 _boxID,
        address _beneficiary,
        uint256 _amount,
        uint256 _boa_price
    ) public onlyRole(MANAGER_ROLE) onlyEmptyWithdrawBoxes(_boxID) whenNotPaused {
        uint256 point_amount = _amount;
        uint256 boa_amount = SafeMath.div(SafeMath.mul(point_amount, BOA_UNIT_PER_COIN), _boa_price);

        require(
            boa_amount <= address(this).balance,
            "The liquidity of the withdrawal box is insufficient.|NOT_ALLOWED_OPEN_WITHDRAW"
        );

        LockBox memory box = LockBox({
            amount: _amount,
            withdraw_amount: boa_amount,
            traderAddress: payable(_beneficiary),
            createTimestamp: block.timestamp
        });

        withdrawBoxes[_boxID] = box;
        withdrawBoxStates[_boxID] = States.OPEN;
        emit OpenWithdraw(_boxID, _beneficiary, _amount);
    }

    function closeWithdrawPoint2BOA(bytes32 _boxID, uint256 _boa_price)
        public
        onlyRole(MANAGER_ROLE)
        onlyOpenWithdrawBoxes(_boxID)
        whenNotPaused
    {
        require(_boa_price != 0, "The coin price was entered incorrectly.|INCORRECT_COIN_PRICE");

        LockBox memory box = withdrawBoxes[_boxID];

        uint256 point_amount = box.amount;
        uint256 boa_amount = SafeMath.div(SafeMath.mul(point_amount, BOA_UNIT_PER_COIN), _boa_price);

        require(
            boa_amount <= address(this).balance,
            "The liquidity of the withdraw box is insufficient.|INSUFFICIENT_LIQUIDITY_CLOSE_WITHDRAW"
        );

        box.traderAddress.transfer(boa_amount);

        withdrawBoxes[_boxID].withdraw_amount = boa_amount;
        withdrawBoxStates[_boxID] = States.CLOSED;

        emit CloseWithdraw(_boxID, box.traderAddress, boa_amount);
    }

    function checkWithdrawPoint2BOA(bytes32 _boxID)
        public
        view
        returns (
            States states,
            address traderAddress,
            uint256 amount,
            uint256 createTimestamp,
            uint256 withdraw_amount
        )
    {
        LockBox memory box = withdrawBoxes[_boxID];
        States state = withdrawBoxStates[_boxID];
        return (state, box.traderAddress, box.amount, box.createTimestamp, box.withdraw_amount);
    }

    mapping(address => uint256) public liquidBalance;

    event IncreasedLiquidity(address provider, uint256 amount);
    event DecreasedLiquidity(address provider, uint256 amount);

    function increaseLiquidity() public payable {
        uint256 liquid = liquidBalance[msg.sender];
        liquid = SafeMath.add(liquid, msg.value);
        liquidBalance[msg.sender] = liquid;

        emit IncreasedLiquidity(msg.sender, msg.value);
    }

    function decreaseLiquidity(uint256 _amount) public {
        require(_amount > 0, "The amount must be greater than zero.|INVALID_AMOUNT_DECREASE");
        uint256 liquid = liquidBalance[msg.sender];

        require(_amount <= liquid, "The liquidity of user is insufficient.|INSUFFICIENT_BALANCE_DECREASE");
        require(_amount <= address(this).balance, "The liquidity is insufficient.|INSUFFICIENT_LIQUIDITY_DECREASE");

        payable(msg.sender).transfer(_amount);
        liquid = SafeMath.sub(liquid, _amount);
        liquidBalance[msg.sender] = liquid;

        emit DecreasedLiquidity(msg.sender, _amount);
    }

    function balanceOfLiquidity(address _provider) public view returns (uint256 amount) {
        return liquidBalance[_provider];
    }
}
