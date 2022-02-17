import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
import { AtomicSwap, TestERC20 } from "../typechain";
import { createKey, sha256, BufferToString, createLockBoxID } from "./Utility";

chai.use(solidity);

import * as assert from "assert";

describe("Cross Chain HTLC Atomic Swap with ERC20", () => {
    let swapEthereum: AtomicSwap;
    let tokenEthereum: TestERC20;
    let swapLuniverse: AtomicSwap;
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
    const depositTimeLock = 60 * 60 * 24;
    const withdrawTimeLock = depositTimeLock * 2;

    before(async () => {
        const AtomicSwapFactory = await ethers.getContractFactory("AtomicSwap");
        const TestERC20Factory = await ethers.getContractFactory("TestERC20");

        tokenEthereum = await TestERC20Factory.deploy("BOSAGORA Token", "BOA1");
        await tokenEthereum.deployed();
        swapEthereum = (await AtomicSwapFactory.deploy(
            tokenEthereum.address,
            depositTimeLock,
            withdrawTimeLock
        )) as AtomicSwap;
        await swapEthereum.deployed();

        tokenLuniverse = await TestERC20Factory.deploy("BOSAGORA Token", "BOA2");
        await tokenLuniverse.deployed();
        swapLuniverse = await AtomicSwapFactory.deploy(tokenLuniverse.address, depositTimeLock, withdrawTimeLock);
        await swapLuniverse.deployed();
    });

    context("Ethereum: User -> Contract, Luniverse : Contract -> User", async () => {
        before("Distribute the fund", async () => {
            await tokenEthereum.connect(adminSigner).transfer(user.address, swapAmount);
        });

        before("Send liquidity", async () => {
            await tokenEthereum.connect(adminSigner).approve(swapEthereum.address, liquidityAmount);
            await swapEthereum.connect(adminSigner).increaseLiquidity(admin.address, liquidityAmount);
            await tokenLuniverse.connect(adminSigner).approve(swapLuniverse.address, liquidityAmount);
            await swapLuniverse.connect(adminSigner).increaseLiquidity(admin.address, liquidityAmount);
        });

        it("Add a manager", async () => {
            await swapEthereum.connect(adminSigner).addManager(manager.address);
            await swapLuniverse.connect(adminSigner).addManager(manager.address);
        });

        it("Check the balance", async () => {
            const user_balance = await tokenLuniverse.balanceOf(user.address);
            assert.strictEqual(user_balance.toNumber(), 0);
        });

        it("Create key by User", () => {
            const key_buffer = createKey();
            const lock_buffer = sha256(key_buffer);
            key = BufferToString(key_buffer);
            lock = BufferToString(lock_buffer);
            lockBoxID = BufferToString(createLockBoxID());
        });

        it("Open the lock box in Ethereum by User", async () => {
            await tokenEthereum.connect(userSigner).approve(swapEthereum.address, swapAmount);
            expect(await swapEthereum.connect(userSigner).openDeposit(lockBoxID, swapAmount, lock)).to.emit(
                swapEthereum,
                "OpenDeposit"
            );
        });

        it("Check the lock box in Ethereum by Manager", async () => {
            const result = await swapEthereum.checkDeposit(lockBoxID);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toNumber(), swapAmount);
            assert.strictEqual(result[3].toString(), tokenEthereum.address);
            assert.strictEqual(result[4].toString(), lock);
        });

        it("Open the lock box in Luniverse by Manager", async () => {
            expect(
                await swapLuniverse.connect(managerSigner).openWithdraw(lockBoxID, swapAmount, user.address, lock)
            ).to.emit(swapLuniverse, "OpenWithdraw");
        });

        it("Check the lock box in Luniverse by User", async () => {
            const result = await swapLuniverse.connect(userSigner).checkWithdraw(lockBoxID);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toNumber(), swapAmount);
            assert.strictEqual(result[3].toString(), tokenLuniverse.address);
            assert.strictEqual(result[4].toString(), user.address);
            assert.strictEqual(result[5].toString(), lock);
        });

        it("Close the lock box in Luniverse by User", async () => {
            expect(await swapLuniverse.connect(userSigner).closeWithdraw(lockBoxID, key)).to.emit(
                swapLuniverse,
                "CloseWithdraw"
            );
            const user_balance = await tokenLuniverse.balanceOf(user.address);
            assert.strictEqual(user_balance.toNumber(), swapAmount);
            const swapLuniverse_balance = await tokenLuniverse.balanceOf(swapLuniverse.address);
            assert.strictEqual(swapLuniverse_balance.toNumber(), liquidityAmount - swapAmount);
        });

        it("Close the lock box in Ethereum by Manager", async () => {
            const secretKey = await swapLuniverse.checkSecretKeyWithdraw(lockBoxID);
            expect(await swapEthereum.closeDeposit(lockBoxID, secretKey)).to.emit(swapEthereum, "CloseDeposit");
            const swapEthereum_balance = await tokenEthereum.balanceOf(swapEthereum.address);
            assert.strictEqual(swapEthereum_balance.toNumber(), liquidityAmount + swapAmount);
        });

        it("Only the manager can open the withdraw lock box", async () => {
            const boxID = BufferToString(createLockBoxID());
            await assert.rejects(swapLuniverse.connect(userSigner).openWithdraw(boxID, swapAmount, user.address, lock));
        });
    });

    context("Expiry Deposit Lock Box", async () => {
        const swapAmount = 10000;
        const lockBox_expiry = BufferToString(createLockBoxID());

        before("Distribute the fund", async () => {
            await tokenEthereum.connect(adminSigner).transfer(user.address, swapAmount);
        });

        before("Set time lock", async () => {
            const timeout = 2;
            await swapEthereum.connect(managerSigner).changeDepositTimeLock(timeout);
        });

        it("Open Deposit Lock Box", async () => {
            await tokenEthereum.connect(userSigner).approve(swapEthereum.address, swapAmount);
            await swapEthereum.connect(userSigner).openDeposit(lockBox_expiry, swapAmount, lock);
        });

        it("No Expiry", async () => {
            await assert.rejects(swapEthereum.connect(userSigner).expireDeposit(lockBox_expiry));
        });

        it("Expiry", async () => {
            await new Promise<void>((resolve, reject) =>
                setTimeout(async () => {
                    try {
                        await swapEthereum.connect(userSigner).expireDeposit(lockBox_expiry);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }, 2 * 1000)
            );
        });
    });

    context("Expiry Withdraw Lock Box", async () => {
        const swapAmount = 10000;
        const lockBox_expiry = BufferToString(createLockBoxID());

        before("Distribute the fund", async () => {
            await tokenEthereum.connect(adminSigner).transfer(user.address, swapAmount);
        });

        before("Set time lock", async () => {
            const timeout = 2;
            await swapEthereum.connect(managerSigner).changeWithdrawTimeLock(timeout);
        });

        it("Open Withdraw Lock Box", async () => {
            await swapEthereum.connect(managerSigner).openWithdraw(lockBox_expiry, swapAmount, user.address, lock);
        });

        it("No Expiry", async () => {
            await assert.rejects(swapEthereum.connect(managerSigner).expireWithdraw(lockBox_expiry));
        });

        it("Expiry", async () => {
            new Promise<void>((resolve, reject) =>
                setTimeout(async () => {
                    try {
                        await swapEthereum.connect(managerSigner).expireWithdraw(lockBox_expiry);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }, 2 * 1000)
            );
        });
    });
});
