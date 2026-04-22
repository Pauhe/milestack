// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { MockFailingTransferERC20 } from "test/mocks/MockFailingTransferERC20.sol";

contract MockFailingTransferERC20Test is Test {
    address internal constant FROM = address(0xA11CE);
    address internal constant TO = address(0xB0B);
    uint256 internal constant MINT_AMOUNT = 1_000e6;

    MockFailingTransferERC20 internal token;

    function setUp() public {
        token = new MockFailingTransferERC20();
    }

    function testTransferFromRevertsOnInsufficientAllowance() public {
        token.mint(FROM, MINT_AMOUNT);

        vm.prank(FROM);
        token.approve(address(this), 400e6);

        vm.expectRevert(bytes("insufficient allowance"));
        token.transferFrom(FROM, TO, 500e6);
    }

    function testTransferFromRevertsOnInsufficientBalance() public {
        token.mint(FROM, 300e6);

        vm.prank(FROM);
        token.approve(address(this), 500e6);

        vm.expectRevert(bytes("insufficient balance"));
        token.transferFrom(FROM, TO, 500e6);
    }

    function testTransferFromMovesBalanceAndDecrementsAllowance() public {
        token.mint(FROM, MINT_AMOUNT);

        vm.prank(FROM);
        token.approve(address(this), 700e6);

        bool ok = token.transferFrom(FROM, TO, 500e6);

        assertTrue(ok, "transferFrom should return true on success");
        assertEq(token.balanceOf(FROM), 500e6, "sender balance should decrement");
        assertEq(token.balanceOf(TO), 500e6, "recipient balance should increment");
        assertEq(token.allowance(FROM, address(this)), 200e6, "allowance should decrement");
    }

    function testApproveReturnsTrueAndStoresAllowance() public {
        vm.prank(FROM);
        bool ok = token.approve(address(this), 321e6);

        assertTrue(ok, "approve should return true");
        assertEq(token.allowance(FROM, address(this)), 321e6, "approve should set allowance");
    }

    function testTransferAlwaysReturnsFalse() public {
        bool ok = token.transfer(TO, 1);

        assertFalse(ok, "transfer should always return false for this mock");
    }
}
