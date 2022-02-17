import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
import { AtomicSwap, TestERC20 } from "../typechain";
import { createKey, sha256, BufferToString, createLockBoxID } from "./Utility";

chai.use(solidity);

import * as assert from "assert";

describe("Test of Increase Liquidity & Decrease Liquidity", () => {
    let swapContract: AtomicSwap;
    let tokenContract: TestERC20;

    const provider = waffle.provider;
    const [admin, user, manager, liquidProvider] = provider.getWallets();
    const adminSigner = provider.getSigner(admin.address);
    const userSigner = provider.getSigner(user.address);
    const managerSigner = provider.getSigner(manager.address);
    const liquidProviderSigner = provider.getSigner(liquidProvider.address);

    let lock: string;
    let key: string;

    let lockBoxID: string;

    const liquidityAmount = 1000000;
    const swapAmount = 10000;
    const depositTimeLock = 60 * 60 * 24;
    const withdrawTimeLock = depositTimeLock * 2;

    before(async () => {
        const AtomicSwapFactory = await ethers.getContractFactory("AtomicSwap");
        const TestERC20Factory = await ethers.getContractFactory("TestERC20");

        tokenContract = await TestERC20Factory.deploy("BOSAGORA Token", "BOA2");
        await tokenContract.deployed();

        swapContract = await AtomicSwapFactory.deploy(tokenContract.address, depositTimeLock, withdrawTimeLock);
        await swapContract.deployed();
    });

    before("Distribute the fund", async () => {
        await tokenContract.connect(adminSigner).transfer(liquidProvider.address, liquidityAmount);
        assert.strictEqual((await tokenContract.balanceOf(swapContract.address)).toNumber(), 0);
    });

    context("Basic Test", async () => {
        it("Increase liquidity", async () => {
            await tokenContract.connect(liquidProviderSigner).approve(swapContract.address, liquidityAmount);
            await swapContract.connect(liquidProviderSigner).increaseLiquidity(liquidProvider.address, liquidityAmount);

            const liquidBalance = await swapContract
                .connect(liquidProviderSigner)
                .liquidBalance(liquidProvider.address);

            assert.strictEqual(liquidBalance.toNumber(), liquidityAmount);
            assert.strictEqual((await tokenContract.balanceOf(liquidProvider.address)).toNumber(), 0);
        });

        it("Decrease liquidity", async () => {
            await swapContract.connect(liquidProviderSigner).decreaseLiquidity(liquidProvider.address, liquidityAmount);

            const liquidBalance = await swapContract
                .connect(liquidProviderSigner)
                .liquidBalance(liquidProvider.address);

            assert.strictEqual(liquidBalance.toNumber(), 0);
            assert.strictEqual((await tokenContract.balanceOf(liquidProvider.address)).toNumber(), liquidityAmount);
        });
    });

    context("Insufficient balance", async () => {
        it("Second increase liquidity", async () => {
            await tokenContract.connect(liquidProviderSigner).approve(swapContract.address, liquidityAmount);
            await swapContract.connect(liquidProviderSigner).increaseLiquidity(liquidProvider.address, liquidityAmount);
        });

        it("Add a manager", async () => {
            await swapContract.connect(adminSigner).addManager(manager.address);
        });

        it("Create key by User", () => {
            const key_buffer = createKey();
            const lock_buffer = sha256(key_buffer);
            key = BufferToString(key_buffer);
            lock = BufferToString(lock_buffer);
            lockBoxID = BufferToString(createLockBoxID());
        });

        it("Open the lock box in Luniverse by Manager", async () => {
            expect(
                await swapContract.connect(managerSigner).openWithdraw(lockBoxID, swapAmount, user.address, lock)
            ).to.emit(swapContract, "OpenWithdraw");
        });

        it("Close the lock box in Luniverse by User", async () => {
            expect(await swapContract.connect(userSigner).closeWithdraw(lockBoxID, key)).to.emit(
                swapContract,
                "CloseWithdraw"
            );
            const user_balance = await tokenContract.balanceOf(user.address);
            assert.strictEqual(user_balance.toNumber(), swapAmount);
            const swapLuniverse_balance = await tokenContract.balanceOf(swapContract.address);
            assert.strictEqual(swapLuniverse_balance.toNumber(), liquidityAmount - swapAmount);
        });

        it("Error occurs when the overall liquidity decreases - insufficient balance", async () => {
            await assert.rejects(
                swapContract.connect(liquidProviderSigner).decreaseLiquidity(liquidProvider.address, liquidityAmount)
            );
        });

        it("Decrease some of the liquidity", async () => {
            await swapContract
                .connect(liquidProviderSigner)
                .decreaseLiquidity(liquidProvider.address, liquidityAmount - swapAmount);

            const liquidBalance = await swapContract
                .connect(liquidProviderSigner)
                .liquidBalance(liquidProvider.address);

            assert.strictEqual(liquidBalance.toNumber(), swapAmount);
        });
    });
});
