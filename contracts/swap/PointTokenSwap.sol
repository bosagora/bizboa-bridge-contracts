// contracts/swap/PointTokenSwap.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./access/SwapLimitPerDay.sol";
import "./PointToken.sol";
import "./GameToken.sol";

contract PointTokenSwap is SwapLimitPerDay, Pausable {
    uint256 private TOKEN_UNIT;
    address private pointContractAddress;
    address private tokenContractAddress;

    constructor(address _tokenContractAddress, address _pointContractAddress) {
        tokenContractAddress = _tokenContractAddress;
        pointContractAddress = _pointContractAddress;
        TOKEN_UNIT = 10**GameToken(tokenContractAddress).decimals();
    }

    function pause() public onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    function swapToPoint(uint256 _amount) public virtual whenNotPaused {
        GameToken token = GameToken(tokenContractAddress);
        PointToken point = PointToken(pointContractAddress);

        require(_amount <= token.allowance(msg.sender, address(this)), "Do not approve for SwapContract");
        require(token.transferFrom(msg.sender, address(this), _amount), "Failed to get token into SwapContract");

        uint256 pointAmount = _amount / TOKEN_UNIT;

        token.burn(address(this), _amount);
        point.mint(msg.sender, pointAmount);
    }

    function swapToToken(uint256 _amount) public virtual whenNotPaused checkTodaySwapLimit(_amount) {
        GameToken token = GameToken(tokenContractAddress);
        PointToken point = PointToken(pointContractAddress);

        require(_amount <= point.allowance(msg.sender, address(this)), "Do not approve for SwapContract");
        require(point.transferFrom(msg.sender, address(this), _amount), "Failed to get token into SwapContract");

        uint256 tokenAmount = _amount * TOKEN_UNIT;

        point.burn(address(this), _amount);
        token.mint(msg.sender, tokenAmount);
    }
}
