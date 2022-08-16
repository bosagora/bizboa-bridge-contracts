// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    uint8 public decimal;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimal_
    ) ERC20(name_, symbol_) {
        decimal = decimal_;
        uint256 supply = 100000000 * 10**decimal_;
        _mint(msg.sender, supply);
    }

    function decimals() public view virtual override returns (uint8) {
        return decimal;
    }
}
