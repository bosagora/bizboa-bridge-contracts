// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./ManagerAccessControl.sol";

contract BOACoinBridge is ManagerAccessControl {
    address private feeManagerAddress;
    bool private collectFee;
    uint256 private depositTimeLock;
    uint256 private withdrawTimeLock;

    /// @dev Add `root` to the manager role as a member.
    constructor(
        uint256 _timeLock,
        address _feeManagerAddress,
        bool _collectFee
    ) {
        depositTimeLock = _timeLock * 2;
        withdrawTimeLock = _timeLock;
        feeManagerAddress = _feeManagerAddress;
        collectFee = _collectFee;
    }

    event ChangeTimeLock(uint256 _timeLock);

    function changeTimeLock(uint256 _timeLock) public onlyManager {
        depositTimeLock = _timeLock * 2;
        withdrawTimeLock = _timeLock;
        emit ChangeTimeLock(depositTimeLock);
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
        uint256 swapFee;
        uint256 txFee;
        address payable traderAddress;
        address payable withdrawAddress;
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
        require(depositBoxStates[_boxID] == States.INVALID, "The deposit box already exists.|ALREADY_OPEN_DEPOSIT");
        _;
    }

    modifier onlyOpenDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.OPEN, "The deposit box is not open.|NOT_OPEN_DEPOSIT");
        _;
    }

    modifier onlyClosedDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.CLOSED, "The deposit box is not close.|NOT_CLOSE_DEPOSIT");
        _;
    }

    modifier onlyExpirableDepositBoxes(bytes32 _boxID) {
        require(
            depositBoxes[_boxID].timeLock + depositBoxes[_boxID].createTimestamp <= block.timestamp,
            "The deposit box cannot be expired.|NOT_EXPIRED_DEPOSIT"
        );
        _;
    }

    modifier onlyWithSecretKeyDepositBoxes(bytes32 _boxID, bytes memory _secretKey) {
        require(
            depositBoxes[_boxID].secretLock == sha256(_secretKey),
            "It's not the key to the deposit box.|NOT_KEY_DEPOSIT"
        );
        _;
    }

    function openDeposit(
        bytes32 _boxID,
        uint256 _swapFee,
        uint256 _txFee,
        address payable _withdrawAddress,
        bytes32 _secretLock
    ) public payable onlyInvalidDepositBoxes(_boxID) {
        require(depositBoxStates[_boxID] == States.INVALID, "The deposit box already exists.|ALREADY_OPEN_DEPOSIT");

        uint256 totalFee = SafeMath.add(_swapFee, _txFee);
        require(totalFee < msg.value, "The fee is insufficient.|INSUFFICIENT_FEE");

        // Store the details of the box.
        DepositLockBox memory box = DepositLockBox({
            timeLock: depositTimeLock,
            amount: msg.value,
            swapFee: _swapFee,
            txFee: _txFee,
            traderAddress: payable(msg.sender),
            withdrawAddress: _withdrawAddress,
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
        if (collectFee) {
            DepositLockBox memory box = depositBoxes[_boxID];
            uint256 totalFee = SafeMath.add(box.swapFee, box.txFee);
            uint256 liquid = liquidBalance[feeManagerAddress];
            liquidBalance[feeManagerAddress] = SafeMath.add(liquid, totalFee);
        }

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

        box.traderAddress.transfer(box.amount);

        emit ExpireDeposit(_boxID);
    }

    function checkDeposit(bytes32 _boxID)
        public
        view
        returns (
            States states,
            uint256 timeLock,
            uint256 amount,
            uint256 swapFee,
            uint256 txFee,
            address traderAddress,
            address withdrawAddress,
            bytes32 secretLock,
            uint256 createTimestamp
        )
    {
        DepositLockBox memory box = depositBoxes[_boxID];
        States state = depositBoxStates[_boxID];
        return (
            state,
            box.timeLock,
            box.amount,
            box.swapFee,
            box.txFee,
            box.traderAddress,
            box.withdrawAddress,
            box.secretLock,
            box.createTimestamp
        );
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
        uint256 swapFee;
        uint256 txFee;
        address payable traderAddress;
        address payable withdrawAddress;
        bytes32 secretLock;
        bytes secretKey;
        uint256 createTimestamp;
    }

    mapping(bytes32 => WithdrawLockBox) private withdrawBoxes;
    mapping(bytes32 => States) private withdrawBoxStates;

    event OpenWithdraw(bytes32 _boxID, bytes32 _secretLock);
    event ExpireWithdraw(bytes32 _boxID);
    event CloseWithdraw(bytes32 _boxID, bytes _secretKey);

    modifier onlyInvalidWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.INVALID, "The withdraw box already exists.|ALREADY_OPEN_WITHDRAW");
        _;
    }

    modifier onlyOpenWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.OPEN, "The withdraw box is not open.|NOT_OPEN_WITHDRAW");
        _;
    }

    modifier onlyClosedWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.CLOSED, "The withdraw box is not close.|NOT_CLOSE_WITHDRAW");
        _;
    }

    modifier onlyExpirableWithdrawBoxes(bytes32 _boxID) {
        require(
            withdrawBoxes[_boxID].timeLock + withdrawBoxes[_boxID].createTimestamp <= block.timestamp,
            "The withdraw box cannot be expired.|NOT_EXPIRED_WITHDRAW"
        );
        _;
    }

    modifier onlyWithSecretKeyWithdrawBoxes(bytes32 _boxID, bytes memory _secretKey) {
        require(
            withdrawBoxes[_boxID].secretLock == sha256(_secretKey),
            "It's not the key to the withdraw box.|NOT_KEY_WITHDRAW"
        );
        _;
    }

    function openWithdraw(
        bytes32 _boxID,
        uint256 _amount,
        uint256 _swapFee,
        uint256 _txFee,
        address payable _traderAddress,
        address payable _withdrawAddress,
        bytes32 _secretLock
    ) public onlyManager onlyInvalidWithdrawBoxes(_boxID) {
        require(withdrawBoxStates[_boxID] == States.INVALID, "The withdraw box already exists.|ALREADY_OPEN_WITHDRAW");

        uint256 totalFee = SafeMath.add(_swapFee, _txFee);
        require(totalFee < _amount, "The fee is insufficient.|INSUFFICIENT_FEE");
        uint256 sendAmount = SafeMath.sub(_amount, totalFee);

        // Transfer value from the ERC20 trader to this contract.
        require(
            sendAmount <= address(this).balance,
            "The liquidity of the withdrawal box is insufficient.|NOT_ALLOWED_OPEN_WITHDRAW"
        );

        // Store the details of the box.
        WithdrawLockBox memory box = WithdrawLockBox({
            timeLock: withdrawTimeLock,
            amount: _amount,
            swapFee: _swapFee,
            txFee: _txFee,
            traderAddress: _traderAddress,
            withdrawAddress: _withdrawAddress,
            secretLock: _secretLock,
            secretKey: new bytes(0),
            createTimestamp: block.timestamp
        });
        withdrawBoxes[_boxID] = box;
        withdrawBoxStates[_boxID] = States.OPEN;
        emit OpenWithdraw(_boxID, _secretLock);
    }

    function closeWithdraw(bytes32 _boxID, bytes memory _secretKey)
        public
        onlyOpenWithdrawBoxes(_boxID)
        onlyWithSecretKeyWithdrawBoxes(_boxID, _secretKey)
    {
        WithdrawLockBox memory box = withdrawBoxes[_boxID];

        uint256 totalFee = SafeMath.add(box.swapFee, box.txFee);
        uint256 sendAmount = SafeMath.sub(box.amount, totalFee);

        if (collectFee) {
            uint256 liquid = liquidBalance[feeManagerAddress];
            liquidBalance[feeManagerAddress] = SafeMath.add(liquid, totalFee);
        }

        require(
            sendAmount <= address(this).balance,
            "The liquidity of the withdraw box is insufficient.|INSUFFICIENT_LIQUIDITY_CLOSE_WITHDRAW"
        );

        // Close the box.
        withdrawBoxes[_boxID].secretKey = _secretKey;
        withdrawBoxStates[_boxID] = States.CLOSED;

        // Transfer the coin funds from this contract to the withdrawing trader.
        box.withdrawAddress.transfer(sendAmount);

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
            uint256 swapFee,
            uint256 txFee,
            address traderAddress,
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
            box.swapFee,
            box.txFee,
            box.traderAddress,
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
