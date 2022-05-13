// contracts/swap/PointCoinSwap.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./access/ManagerControl.sol";
import "hardhat/console.sol";

contract PointCoinSwap is ManagerControl, Pausable {
    uint256 private BOA_UNIT_PER_COIN = 1_000_000_000_000_000_000;
    address private swapFeeManagerAddress;
    address private pointAddress;
    uint256 private boaPrice;
    uint256 private swapFeeRate;

    /**
     * @dev
     * Requirements:
     *
     * - PointToken Contract Address
     * - Swap Fee Manager Address
     * - Swap Fee Rate * 100
     */
    constructor(
        address _pointContractAddress,
        address _swapFeeManagerAddress,
        uint256 _defaultSwapFeeRate
    ) {
        pointAddress = _pointContractAddress;
        swapFeeManagerAddress = _swapFeeManagerAddress;
        swapFeeRate = _defaultSwapFeeRate;
    }

    function setBoaPrice(uint256 _boaPrice) public onlyManager {
        boaPrice = _boaPrice;
    }

    function getBoaPrice() public view returns (uint256) {
        return boaPrice;
    }

    function setSwapFeeRate(uint256 _swapFeeRate) public onlyManager {
        swapFeeRate = _swapFeeRate;
    }

    function getSwapFeeRate() public view returns (uint256) {
        return swapFeeRate;
    }

    function calcSwapFee(uint256 amount) internal view virtual returns (uint256) {
        return (amount * swapFeeRate) / 10000;
    }

    function pause() public onlyManager {
        _pause();
    }

    function unpause() public onlyManager {
        _unpause();
    }

    event ChangeSwapFeeManager(address newManager, uint256 liquidBalance);

    function setSwapFeeManager(address _swapFeeManagerAddress) public onlyOwner {
        liquidCoinBalance[_swapFeeManagerAddress] =
            liquidCoinBalance[_swapFeeManagerAddress] +
            liquidCoinBalance[swapFeeManagerAddress];
        liquidCoinBalance[swapFeeManagerAddress] = uint256(0);
        swapFeeManagerAddress = _swapFeeManagerAddress;

        emit ChangeSwapFeeManager(swapFeeManagerAddress, liquidCoinBalance[swapFeeManagerAddress]);
    }

    function getSwapFeeManager() public view returns (address) {
        return swapFeeManagerAddress;
    }

    function swapToPoint() public payable virtual {
        IERC20 point = IERC20(pointAddress);

        uint256 swapFee = calcSwapFee(msg.value);
        uint256 sendPoint = ((msg.value - swapFee) * boaPrice) / BOA_UNIT_PER_COIN;

        require(sendPoint <= point.balanceOf(address(this)), "The point liquidity is insufficient.");
        liquidCoinBalance[swapFeeManagerAddress] = liquidCoinBalance[swapFeeManagerAddress] + swapFee;
        point.transfer(msg.sender, sendPoint);
    }

    function swapToCoin(uint256 _point_amount) public virtual {
        IERC20 point = IERC20(pointAddress);
        require(_point_amount <= point.allowance(msg.sender, address(this)));
        require(point.transferFrom(msg.sender, address(this), _point_amount));

        uint256 swapFee = calcSwapFee(_point_amount);
        uint256 sendCoin = ((_point_amount - swapFee) / boaPrice) * BOA_UNIT_PER_COIN;

        require(sendCoin <= address(this).balance, "The coin liquidity is insufficient.");
        liquidPointBalance[swapFeeManagerAddress] = liquidPointBalance[swapFeeManagerAddress] + swapFee;
        payable(msg.sender).transfer(sendCoin);
    }

    mapping(address => uint256) public liquidCoinBalance;
    event IncreasedCoinLiquidity(address provider, uint256 amount);
    event DecreasedCoinLiquidity(address provider, uint256 amount);

    function increaseCoinLiquidity() public payable {
        uint256 liquid = liquidCoinBalance[msg.sender];
        liquid = liquid + msg.value;
        liquidCoinBalance[msg.sender] = liquid;

        emit IncreasedCoinLiquidity(msg.sender, msg.value);
    }

    function decreaseCoinLiquidity(uint256 _amount) public {
        require(_amount > 0, "The amount must be greater than zero.");
        uint256 liquid = liquidCoinBalance[msg.sender];

        require(_amount <= liquid, "The liquidity of user is insufficient.");
        require(_amount <= address(this).balance, "The liquidity is insufficient.");

        payable(msg.sender).transfer(_amount);
        liquid = liquid - _amount;
        liquidCoinBalance[msg.sender] = liquid;

        emit DecreasedCoinLiquidity(msg.sender, _amount);
    }

    function balanceOfCoinLiquidity(address _provider) public view returns (uint256 amount) {
        return liquidCoinBalance[_provider];
    }

    mapping(address => uint256) public liquidPointBalance;
    event IncreasedPointLiquidity(address provider, uint256 amount);
    event DecreasedPointLiquidity(address provider, uint256 amount);

    function increasePointLiquidity(uint256 _amount) public {
        require(_amount > 0, "The amount must be greater than zero.");
        IERC20 point = IERC20(pointAddress);
        require(
            _amount <= point.allowance(msg.sender, address(this)),
            "The specified amount is not allowed to be transferred to the liquidity."
        );
        require(
            point.transferFrom(msg.sender, address(this), _amount),
            "An error occurred during transfer to the liquidity."
        );
        uint256 liquid = liquidPointBalance[msg.sender];
        liquid = liquid + _amount;
        liquidPointBalance[msg.sender] = liquid;
        emit IncreasedPointLiquidity(msg.sender, _amount);
    }

    function decreasePointLiquidity(uint256 _amount) public {
        require(_amount > 0, "The amount must be greater than zero.");
        uint256 liquid = liquidPointBalance[msg.sender];
        require(_amount <= liquid, "The liquidity of user is insufficient.");
        IERC20 point = IERC20(pointAddress);
        require(_amount <= point.balanceOf(address(this)), "The liquidity is insufficient.");
        require(point.transfer(msg.sender, _amount), "An error occurred during refund to the user from the liquidity.");
        liquid = liquid - _amount;
        liquidPointBalance[msg.sender] = liquid;
        emit DecreasedPointLiquidity(msg.sender, _amount);
    }

    function balanceOfPointLiquidity(address _provider) public view returns (uint256 amount) {
        return liquidPointBalance[_provider];
    }
}
