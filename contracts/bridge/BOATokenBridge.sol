// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./ManagerAccessControl.sol";

contract BOATokenBridge is ManagerAccessControl {
    address private swapTokenAddress;
    address private feeManagerAddress;
    bool private collectFee;
    uint256 private depositTimeLock;
    uint256 private withdrawTimeLock;

    constructor(
        address _tokenAddress,
        uint256 _timeLock,
        address _feeManagerAddress,
        bool _collectFee
    ) {
        swapTokenAddress = _tokenAddress;
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

    event ChangeFeeManager(address newManager, uint256 liquidBalance);

    function setFeeManager(address _feeManagerAddress) public onlyOwner {
        liquidBalance[_feeManagerAddress] = SafeMath.add(
            liquidBalance[_feeManagerAddress],
            liquidBalance[feeManagerAddress]
        );
        liquidBalance[feeManagerAddress] = uint256(0);
        feeManagerAddress = _feeManagerAddress;

        emit ChangeFeeManager(feeManagerAddress, liquidBalance[feeManagerAddress]);
    }

    function getFeeManager() public view returns (address) {
        return feeManagerAddress;
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
        address traderAddress;
        address withdrawAddress;
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
        require(depositBoxStates[_boxID] == States.INVALID, "Already open deposit.|ALREADY_OPEN_DEPOSIT");
        _;
    }

    modifier onlyOpenDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.OPEN, "Not open deposit.|NOT_OPEN_DEPOSIT");
        _;
    }

    modifier onlyClosedDepositBoxes(bytes32 _boxID) {
        require(depositBoxStates[_boxID] == States.CLOSED, "Not close deposit.|NOT_CLOSE_DEPOSIT");
        _;
    }

    modifier onlyExpirableDepositBoxes(bytes32 _boxID) {
        require(
            depositBoxes[_boxID].timeLock + depositBoxes[_boxID].createTimestamp <= block.timestamp,
            "Not expired deposit.|NOT_EXPIRED_DEPOSIT"
        );
        _;
    }

    modifier onlyWithSecretKeyDepositBoxes(bytes32 _boxID, bytes memory _secretKey) {
        require(depositBoxes[_boxID].secretLock == sha256(_secretKey), "Not key deposit.|NOT_KEY_DEPOSIT");
        _;
    }

    function openDeposit(
        bytes32 _boxID,
        uint256 _amount,
        uint256 _swapFee,
        uint256 _txFee,
        address _withdrawAddress,
        bytes32 _secretLock
    ) public onlyInvalidDepositBoxes(_boxID) {
        uint256 totalFee = SafeMath.add(_swapFee, _txFee);
        require(totalFee < _amount, "Insufficient fee.|INSUFFICIENT_FEE");

        IERC20 token = IERC20(swapTokenAddress);
        require(
            _amount <= token.allowance(msg.sender, address(this)),
            "Not allowed open deposit.|NOT_ALLOWED_OPEN_DEPOSIT"
        );
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "Error transfer open deposit.|ERROR_TRANSFER_OPEN_DEPOSIT"
        );

        // Store the details of the box.
        DepositLockBox memory box = DepositLockBox({
            timeLock: depositTimeLock,
            amount: _amount,
            swapFee: _swapFee,
            txFee: _txFee,
            traderAddress: msg.sender,
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
            liquidBalance[feeManagerAddress] = SafeMath.add(
                liquidBalance[feeManagerAddress],
                SafeMath.add(box.txFee, box.swapFee)
            );
        }
        depositBoxes[_boxID].secretKey = _secretKey;
        depositBoxStates[_boxID] = States.CLOSED;

        emit CloseDeposit(_boxID, _secretKey);
    }

    function expireDeposit(bytes32 _boxID) public onlyOpenDepositBoxes(_boxID) onlyExpirableDepositBoxes(_boxID) {
        DepositLockBox memory box = depositBoxes[_boxID];
        depositBoxStates[_boxID] = States.EXPIRED;
        IERC20 token = IERC20(swapTokenAddress);
        require(
            token.transfer(box.traderAddress, box.amount),
            "Error transfer expire deposit.|ERROR_TRANSFER_EXPIRE_DEPOSIT"
        );

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
        address traderAddress;
        address withdrawAddress;
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
        require(withdrawBoxStates[_boxID] == States.INVALID, "Already open withdraw.|ALREADY_OPEN_WITHDRAW");
        _;
    }

    modifier onlyOpenWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.OPEN, "Not open withdraw.|NOT_OPEN_WITHDRAW");
        _;
    }

    modifier onlyClosedWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.CLOSED, "Not close withdraw.|NOT_CLOSE_WITHDRAW");
        _;
    }

    modifier onlyExpirableWithdrawBoxes(bytes32 _boxID) {
        require(
            withdrawBoxes[_boxID].timeLock + withdrawBoxes[_boxID].createTimestamp <= block.timestamp,
            "Not expired withdraw.|NOT_EXPIRED_WITHDRAW"
        );
        _;
    }

    modifier onlyWithSecretKeyWithdrawBoxes(bytes32 _boxID, bytes memory _secretKey) {
        require(withdrawBoxes[_boxID].secretLock == sha256(_secretKey), "Not key withdraw.|NOT_KEY_WITHDRAW");
        _;
    }

    function openWithdraw(
        bytes32 _boxID,
        uint256 _amount,
        uint256 _swapFee,
        uint256 _txFee,
        address _traderAddress,
        address _withdrawAddress,
        bytes32 _secretLock
    ) public onlyManager onlyInvalidWithdrawBoxes(_boxID) {
        uint256 totalFee = SafeMath.add(_swapFee, _txFee);
        require(totalFee < _amount, "Insufficient fee.|INSUFFICIENT_FEE");
        uint256 sendAmount = SafeMath.sub(_amount, totalFee);

        // Transfer value from the ERC20 trader to this contract.
        IERC20 token = IERC20(swapTokenAddress);
        require(sendAmount <= token.balanceOf(address(this)), "Insufficient liquidity.|INSUFFICIENT_LIQUIDITY");

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
            liquidBalance[feeManagerAddress] = SafeMath.add(
                liquidBalance[feeManagerAddress],
                SafeMath.add(box.txFee, box.swapFee)
            );
        }

        IERC20 token = IERC20(swapTokenAddress);
        require(
            sendAmount <= token.balanceOf(address(this)),
            "Insufficient liquidity close withdraw.|INSUFFICIENT_LIQUIDITY_CLOSE_WITHDRAW"
        );

        // Close the box.
        withdrawBoxes[_boxID].secretKey = _secretKey;
        withdrawBoxStates[_boxID] = States.CLOSED;

        // Transfer the ERC20 funds from this contract to the withdrawing trader.
        token.transfer(box.withdrawAddress, sendAmount);

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

    function increaseLiquidity(address _provider, uint256 _amount) public {
        require(_amount > 0, "Invalid amount decrease.|INVALID_AMOUNT_INCREASE");
        IERC20 token = IERC20(swapTokenAddress);
        require(
            _amount <= token.allowance(_provider, address(this)),
            "Not allowance increase liquidity.|NOT_ALLOWANCE_INCREASE"
        );

        token.transferFrom(_provider, address(this), _amount);
        uint256 liquid = liquidBalance[_provider];
        liquid = SafeMath.add(liquid, _amount);
        liquidBalance[_provider] = liquid;
        emit IncreasedLiquidity(_provider, _amount);
    }

    function decreaseLiquidity(uint256 _amount) public {
        require(_amount > 0, "Invalid amount decrease.|INVALID_AMOUNT_DECREASE");
        uint256 liquid = liquidBalance[msg.sender];
        require(_amount <= liquid, "Insufficient user's  liquidity.|INSUFFICIENT_BALANCE_DECREASE");
        IERC20 token = IERC20(swapTokenAddress);
        require(
            _amount <= token.balanceOf(address(this)),
            "The liquidity is insufficient.|INSUFFICIENT_LIQUIDITY_DECREASE"
        );
        token.transfer(msg.sender, _amount);
        liquid = SafeMath.sub(liquid, _amount);
        liquidBalance[msg.sender] = liquid;
        emit DecreasedLiquidity(msg.sender, _amount);
    }

    function balanceOfLiquidity(address _provider) public view returns (uint256 amount) {
        return liquidBalance[_provider];
    }
}
