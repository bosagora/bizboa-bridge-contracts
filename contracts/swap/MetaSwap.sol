// contracts/swap/GameSwap.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./access/ManagerControl.sol";

contract MetaSwap is Ownable, ManagerControl, Pausable {
    address private swapTokenAddress;

    uint256 private BOA_UNIT_PER_COIN = 10_000_000;

    constructor(address _tokenAddress) {
        swapTokenAddress = _tokenAddress;
    }

    enum States {
        INVALID,
        OPEN,
        CLOSED
    }

    struct LockBox {
        address traderAddress;
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

    function openDepositToken2Point(bytes32 _boxID, uint256 _amount)
        public
        onlyEmptyDepositBoxes(_boxID)
        whenNotPaused
    {
        IERC20 token = IERC20(swapTokenAddress);

        require(
            _amount <= token.allowance(msg.sender, address(this)),
            "The specified amount is not allowed to be transferred to the deposit box.|NOT_ALLOWED_OPEN_DEPOSIT"
        );
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "An error occurred during transfer to the deposit box.|ERROR_TRANSFER_OPEN_DEPOSIT"
        );

        LockBox memory box = LockBox({
            amount: _amount,
            withdraw_amount: 0,
            traderAddress: msg.sender,
            createTimestamp: block.timestamp
        });

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
        depositBoxStates[_boxID] = States.CLOSED;
        LockBox memory box = depositBoxes[_boxID];
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
        require(withdrawBoxStates[_boxID] == States.OPEN, "The withdraw box is not open.|NOT_OPEN_WITHDRAW");
        _;
    }

    modifier onlyEmptyWithdrawBoxes(bytes32 _boxID) {
        require(withdrawBoxStates[_boxID] == States.INVALID, "The withdraw box already exists.|ALREADY_OPEN_WITHDRAW");
        _;
    }

    function openWithdrawPoint2Token(
        bytes32 _boxID,
        address _beneficiary,
        uint256 _amount,
        uint256 token_price
    ) public onlyRole(MANAGER_ROLE) onlyEmptyWithdrawBoxes(_boxID) whenNotPaused {
        IERC20 token = IERC20(swapTokenAddress);

        uint256 point_amount = _amount;
        uint256 token_amount = SafeMath.div(SafeMath.mul(point_amount, BOA_UNIT_PER_COIN), token_price);

        require(
            token_amount <= token.balanceOf(address(this)),
            "The liquidity of the withdrawal box is insufficient.|NOT_ALLOWED_OPEN_WITHDRAW"
        );

        LockBox memory box = LockBox({
            amount: _amount,
            withdraw_amount: token_amount,
            traderAddress: _beneficiary,
            createTimestamp: block.timestamp
        });

        withdrawBoxes[_boxID] = box;
        withdrawBoxStates[_boxID] = States.OPEN;
        emit OpenWithdraw(_boxID, _beneficiary, _amount);
    }

    function closeWithdrawPoint2Token(bytes32 _boxID, uint256 token_price)
        public
        onlyRole(MANAGER_ROLE)
        onlyOpenWithdrawBoxes(_boxID)
        whenNotPaused
    {
        require(token_price != 0, "The token price was entered incorrectly.|INCORRECT_TOKEN_PRICE");

        IERC20 token = IERC20(swapTokenAddress);
        LockBox memory box = withdrawBoxes[_boxID];

        uint256 point_amount = box.amount;
        uint256 token_amount = SafeMath.div(SafeMath.mul(point_amount, BOA_UNIT_PER_COIN), token_price);

        require(
            token_amount <= token.balanceOf(address(this)),
            "The liquidity of the withdraw box is insufficient.|INSUFFICIENT_LIQUIDITY_CLOSE_WITHDRAW"
        );

        require(
            token.transfer(box.traderAddress, token_amount),
            "An error occurred during refund to the user from the withdraw box.|ERROR_TRANSFER_CLOSE_WITHDRAW"
        );

        withdrawBoxes[_boxID].withdraw_amount = token_amount;
        withdrawBoxStates[_boxID] = States.CLOSED;

        emit CloseWithdraw(_boxID, box.traderAddress, token_amount);
    }

    function checkWithdrawPoint2Token(bytes32 _boxID)
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

    function increaseLiquidity(address _provider, uint256 _amount) public {
        require(_amount > 0, "The amount must be greater than zero.|INVALID_AMOUNT_INCREASE");

        IERC20 token = IERC20(swapTokenAddress);

        require(
            _amount <= token.allowance(_provider, address(this)),
            "The specified amount is not allowed to be transferred to the liquidity.|NOT_ALLOWANCE_INCREASE"
        );

        require(
            token.transferFrom(_provider, address(this), _amount),
            "An error occurred during transfer to the liquidity.|ERROR_TRANSFER_INCREASE"
        );

        uint256 liquid = liquidBalance[_provider];

        liquid = SafeMath.add(liquid, _amount);

        liquidBalance[_provider] = liquid;

        emit IncreasedLiquidity(_provider, _amount);
    }

    function decreaseLiquidity(address _provider, uint256 _amount) public {
        require(_amount > 0, "The amount must be greater than zero.|INVALID_AMOUNT_DECREASE");

        uint256 liquid = liquidBalance[_provider];

        require(_amount <= liquid, "The liquidity of user is insufficient.|INSUFFICIENT_BALANCE_DECREASE");

        IERC20 token = IERC20(swapTokenAddress);

        require(
            _amount <= token.balanceOf(address(this)),
            "The liquidity is insufficient.|INSUFFICIENT_LIQUIDITY_DECREASE"
        );

        require(
            token.transfer(_provider, _amount),
            "An error occurred during refund to the user from the liquidity.|ERROR_TRANSFER_DECREASE"
        );

        liquid = SafeMath.sub(liquid, _amount);

        liquidBalance[_provider] = liquid;

        emit DecreasedLiquidity(_provider, _amount);
    }

    function balanceOfLiquidity(address _provider) public view returns (uint256 amount) {
        return liquidBalance[_provider];
    }
}
