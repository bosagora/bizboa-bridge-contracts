import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, waffle } from "hardhat";
import { BOABridge, TestERC20 } from "../../typechain";
import { ContractUtils } from "../ContractUtils";

import * as assert from "assert";

chai.use(solidity);

describe("Test of Increase Liquidity & Decrease Liquidity", () => {
    let bridgeContract: BOABridge;
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
    const timeLock = 60 * 60 * 24;

    before(async () => {
        const BOABridgeFactory = await ethers.getContractFactory("BOABridge");
        const TestERC20Factory = await ethers.getContractFactory("TestERC20");

        tokenContract = await TestERC20Factory.deploy("BOSAGORA Token", "BOA2");
        await tokenContract.deployed();

        bridgeContract = await BOABridgeFactory.deploy(tokenContract.address, timeLock);
        await bridgeContract.deployed();
    });

    before("Distribute the fund", async () => {
        await tokenContract.connect(adminSigner).transfer(liquidProvider.address, liquidityAmount);
        assert.strictEqual((await tokenContract.balanceOf(bridgeContract.address)).toNumber(), 0);
    });

    context("Basic Test", async () => {
        it("Increase liquidity", async () => {
            await tokenContract.connect(liquidProviderSigner).approve(bridgeContract.address, liquidityAmount);
            await bridgeContract
                .connect(liquidProviderSigner)
                .increaseLiquidity(liquidProvider.address, liquidityAmount);

            const liquidBalance = await bridgeContract
                .connect(liquidProviderSigner)
                .liquidBalance(liquidProvider.address);

            assert.strictEqual(liquidBalance.toNumber(), liquidityAmount);
            assert.strictEqual((await tokenContract.balanceOf(liquidProvider.address)).toNumber(), 0);
        });

        it("Decrease liquidity", async () => {
            await bridgeContract
                .connect(liquidProviderSigner)
                .decreaseLiquidity(liquidProvider.address, liquidityAmount);

            const liquidBalance = await bridgeContract
                .connect(liquidProviderSigner)
                .liquidBalance(liquidProvider.address);

            assert.strictEqual(liquidBalance.toNumber(), 0);
            assert.strictEqual((await tokenContract.balanceOf(liquidProvider.address)).toNumber(), liquidityAmount);
        });
    });

    context("Insufficient balance", async () => {
        it("Second increase liquidity", async () => {
            await tokenContract.connect(liquidProviderSigner).approve(bridgeContract.address, liquidityAmount);
            await bridgeContract
                .connect(liquidProviderSigner)
                .increaseLiquidity(liquidProvider.address, liquidityAmount);
        });

        it("Add a manager", async () => {
            await bridgeContract.connect(adminSigner).addManager(manager.address);
        });

        it("Create key by User", () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in Luniverse by Manager", async () => {
            expect(
                await bridgeContract
                    .connect(managerSigner)
                    .openWithdraw(lockBoxID, swapAmount, 0, 0, user.address, user.address, lock)
            ).to.emit(bridgeContract, "OpenWithdraw");
        });

        it("Close the lock box in Luniverse by User", async () => {
            expect(await bridgeContract.connect(userSigner).closeWithdraw(lockBoxID, key)).to.emit(
                bridgeContract,
                "CloseWithdraw"
            );
            const user_balance = await tokenContract.balanceOf(user.address);
            assert.strictEqual(user_balance.toNumber(), swapAmount);
            const swapLuniverse_balance = await tokenContract.balanceOf(bridgeContract.address);
            assert.strictEqual(swapLuniverse_balance.toNumber(), liquidityAmount - swapAmount);
        });

        it("Error occurs when the overall liquidity decreases - insufficient balance", async () => {
            await assert.rejects(
                bridgeContract.connect(liquidProviderSigner).decreaseLiquidity(liquidProvider.address, liquidityAmount)
            );
        });

        it("Decrease some of the liquidity", async () => {
            await bridgeContract
                .connect(liquidProviderSigner)
                .decreaseLiquidity(liquidProvider.address, liquidityAmount - swapAmount);

            const liquidBalance = await bridgeContract
                .connect(liquidProviderSigner)
                .liquidBalance(liquidProvider.address);

            assert.strictEqual(liquidBalance.toNumber(), swapAmount);
        });
    });
});
