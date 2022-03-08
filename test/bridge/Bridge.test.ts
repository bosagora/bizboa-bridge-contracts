import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, waffle } from "hardhat";
import { BOABridge, TestERC20 } from "../../typechain";
import { ContractUtils } from "../ContractUtils";

import * as assert from "assert";

chai.use(solidity);

describe("Cross Chain HTLC Atomic Swap with ERC20", () => {
    let bridgeEthereum: BOABridge;
    let tokenEthereum: TestERC20;
    let bridgeLuniverse: BOABridge;
    let tokenLuniverse: TestERC20;

    const provider = waffle.provider;
    const [admin, user, manager] = provider.getWallets();
    const adminSigner = provider.getSigner(admin.address);
    const userSigner = provider.getSigner(user.address);
    const managerSigner = provider.getSigner(manager.address);

    let lock: string;
    let key: string;

    let lockBoxID: string;

    const liquidityAmount = 1000000;
    const swapAmount = 10000;
    const timeLock = 60 * 60 * 24;

    before(async () => {
        const BOABridgeFactory = await ethers.getContractFactory("BOABridge");
        const TestERC20Factory = await ethers.getContractFactory("TestERC20");

        tokenEthereum = await TestERC20Factory.deploy("BOSAGORA Token", "BOA1");
        await tokenEthereum.deployed();
        bridgeEthereum = (await BOABridgeFactory.deploy(tokenEthereum.address, timeLock)) as BOABridge;
        await bridgeEthereum.deployed();

        tokenLuniverse = await TestERC20Factory.deploy("BOSAGORA Token", "BOA2");
        await tokenLuniverse.deployed();
        bridgeLuniverse = await BOABridgeFactory.deploy(tokenLuniverse.address, timeLock);
        await bridgeLuniverse.deployed();
    });

    context("Ethereum: User -> Contract, Luniverse : Contract -> User", async () => {
        before("Distribute the fund", async () => {
            await tokenEthereum.connect(adminSigner).transfer(user.address, swapAmount);
        });

        before("Send liquidity", async () => {
            await tokenEthereum.connect(adminSigner).approve(bridgeEthereum.address, liquidityAmount);
            await bridgeEthereum.connect(adminSigner).increaseLiquidity(admin.address, liquidityAmount);
            await tokenLuniverse.connect(adminSigner).approve(bridgeLuniverse.address, liquidityAmount);
            await bridgeLuniverse.connect(adminSigner).increaseLiquidity(admin.address, liquidityAmount);
        });

        it("Add a manager", async () => {
            await bridgeEthereum.connect(adminSigner).addManager(manager.address);
            await bridgeLuniverse.connect(adminSigner).addManager(manager.address);
        });

        it("Check the balance", async () => {
            const user_balance = await tokenLuniverse.balanceOf(user.address);
            assert.strictEqual(user_balance.toNumber(), 0);
        });

        it("Create key by User", () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in Ethereum by User", async () => {
            await tokenEthereum.connect(userSigner).approve(bridgeEthereum.address, swapAmount);
            expect(
                await bridgeEthereum.connect(userSigner).openDeposit(lockBoxID, swapAmount, user.address, lock)
            ).to.emit(bridgeEthereum, "OpenDeposit");
        });

        it("Check the lock box in Ethereum by Manager", async () => {
            const result = await bridgeEthereum.checkDeposit(lockBoxID);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toNumber(), swapAmount);
            assert.strictEqual(result[3].toString(), user.address);
            assert.strictEqual(result[4].toString(), user.address);
            assert.strictEqual(result[5].toString(), lock);
        });

        it("Open the lock box in Luniverse by Manager", async () => {
            expect(
                await bridgeLuniverse
                    .connect(managerSigner)
                    .openWithdraw(lockBoxID, swapAmount, user.address, user.address, lock)
            ).to.emit(bridgeLuniverse, "OpenWithdraw");
        });

        it("Check the lock box in Luniverse by User", async () => {
            const result = await bridgeLuniverse.connect(userSigner).checkWithdraw(lockBoxID);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toNumber(), swapAmount);
            assert.strictEqual(result[3].toString(), user.address);
            assert.strictEqual(result[4].toString(), user.address);
            assert.strictEqual(result[5].toString(), lock);
        });

        it("Close the lock box in Luniverse by Manager", async () => {
            expect(await bridgeLuniverse.connect(managerSigner).closeWithdraw(lockBoxID, key)).to.emit(
                bridgeLuniverse,
                "CloseWithdraw"
            );
            const user_balance = await tokenLuniverse.balanceOf(user.address);
            assert.strictEqual(user_balance.toNumber(), swapAmount);
            const bridgeLuniverse_balance = await tokenLuniverse.balanceOf(bridgeLuniverse.address);
            assert.strictEqual(bridgeLuniverse_balance.toNumber(), liquidityAmount - swapAmount);
        });

        it("Close the lock box in Ethereum by Manager", async () => {
            const secretKey = await bridgeLuniverse.checkSecretKeyWithdraw(lockBoxID);
            expect(await bridgeEthereum.connect(managerSigner).closeDeposit(lockBoxID, secretKey)).to.emit(
                bridgeEthereum,
                "CloseDeposit"
            );
            const bridgeEthereum_balance = await tokenEthereum.balanceOf(bridgeEthereum.address);
            assert.strictEqual(bridgeEthereum_balance.toNumber(), liquidityAmount + swapAmount);
        });

        it("Only the manager can open the withdraw lock box", async () => {
            const boxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
            await assert.rejects(
                bridgeLuniverse.connect(userSigner).openWithdraw(boxID, swapAmount, user.address, user.address, lock)
            );
        });
    });

    context("Expiry Deposit Lock Box", async () => {
        const lockBox_expiry = ContractUtils.BufferToString(ContractUtils.createLockBoxID());

        before("Distribute the fund", async () => {
            await tokenEthereum.connect(adminSigner).transfer(user.address, swapAmount);
        });

        before("Set time lock", async () => {
            const timeout = 1;
            await bridgeEthereum.connect(managerSigner).changeTimeLock(timeout);
        });

        it("Open Deposit Lock Box", async () => {
            await tokenEthereum.connect(userSigner).approve(bridgeEthereum.address, swapAmount);
            await bridgeEthereum.connect(userSigner).openDeposit(lockBox_expiry, swapAmount, user.address, lock);
        });

        it("No Expiry", async () => {
            await assert.rejects(bridgeEthereum.connect(userSigner).expireDeposit(lockBox_expiry));
        });

        it("Expiry", async () => {
            await new Promise<void>((resolve, reject) =>
                setTimeout(async () => {
                    try {
                        await bridgeEthereum.connect(userSigner).expireDeposit(lockBox_expiry);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }, 2 * 1000)
            );
        });
    });

    context("Expiry Withdraw Lock Box", async () => {
        const lockBox_expiry = ContractUtils.BufferToString(ContractUtils.createLockBoxID());

        before("Distribute the fund", async () => {
            await tokenEthereum.connect(adminSigner).transfer(user.address, swapAmount);
        });

        before("Set time lock", async () => {
            const timeout = 2;
            await bridgeEthereum.connect(managerSigner).changeTimeLock(timeout);
        });

        it("Open Withdraw Lock Box", async () => {
            await bridgeEthereum
                .connect(managerSigner)
                .openWithdraw(lockBox_expiry, swapAmount, user.address, user.address, lock);
        });

        it("No Expiry", async () => {
            await assert.rejects(bridgeEthereum.connect(managerSigner).expireWithdraw(lockBox_expiry));
        });

        it("Expiry", async () => {
            return new Promise<void>((resolve, reject) =>
                setTimeout(async () => {
                    try {
                        await bridgeEthereum.connect(managerSigner).expireWithdraw(lockBox_expiry);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }, 2 * 1000)
            );
        });
    });
});
