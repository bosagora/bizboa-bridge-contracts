// contracts/swap/access/SwapLimitPerDay.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ManagerControl.sol";

contract SwapLimitPerDay is ManagerControl {
    bool private useSwapLimitPerDay;
    uint256 private swapLimitAmountPerDay = 0;
    mapping(uint256 => uint256) private swapTotalAmountToday;

    constructor() {
        useSwapLimitPerDay = false;
    }

    modifier checkTodaySwapLimit(uint256 _amount) {
        if (useSwapLimitPerDay) {
            require(
                swapLimitAmountPerDay >= (swapTotalAmountToday[today()] + _amount),
                "SwapControl: Daily Swap Limit Exceeded."
            );
        }
        _;
    }

    function _checkTodaySwapLimit(uint256 _amount) internal view virtual {
        if (useSwapLimitPerDay && swapLimitAmountPerDay < (swapTotalAmountToday[today()] + _amount)) {
            revert(string(abi.encodePacked("SwapControl: Daily Swap Limit Exceeded.")));
        }
    }

    event ChangeSwapLimitPerDayAmount(uint256 amount);
    event ResetTodaySwapLimitAmount(uint256 amount);
    event EnabledSwapLimitPerDay();
    event DisabledSwapLimitPerDay();

    function possibleSwapToday(uint256 _amount) internal view virtual {
        if (useSwapLimitPerDay && swapLimitAmountPerDay < (swapTotalAmountToday[today()] + _amount)) {
            revert(string(abi.encodePacked("SwapLimitPerDay: Daily Swap Limit Exceeded.")));
        }
    }

    function today() internal view virtual returns (uint256) {
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
        return swapLimitAmountPerDay - swappedAmount;
    }

    function resetTodaySwapAmount() public virtual onlyRole(MANAGER_ROLE) {
        swapTotalAmountToday[today()] = 0;
        emit ResetTodaySwapLimitAmount(swapTotalAmountToday[today()]);
    }
}
