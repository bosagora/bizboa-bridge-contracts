import assert from "assert";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";
import { ContractUtils } from "../ContractUtils";

describe("Test of GameSwap Contract", () => {
    let gameToken: Contract;
    let gameSwap: Contract;
    let depositLockBoxID: string;
    let withdrawLockBoxID: string;

    const provider = waffle.provider;
    const [owner, manager, user01, user02] = provider.getWallets();
    const ownerSigner = provider.getSigner(owner.address);
    const managerSigner = provider.getSigner(manager.address);
    const user01Signer = provider.getSigner(user01.address);
    const user02Signer = provider.getSigner(user02.address);

    before(async () => {
        const GameToken = await ethers.getContractFactory("GameToken");
        gameToken = await GameToken.deploy("BOSAGORA", "GBOA", 7, 1000000000000000);
        await gameToken.deployed();
        const GameSwap = await ethers.getContractFactory("GameSwap");
        // @ts-ignore
        gameSwap = await GameSwap.deploy(gameToken.address);
        await gameSwap.deployed();
    });

    before("Create Key", async () => {
        depositLockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        withdrawLockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
    });

    it("Check the game token status", async () => {
        expect(await gameToken.name()).to.equal("BOSAGORA");
        expect(await gameToken.symbol()).to.equal("GBOA");
        expect(await gameToken.decimals()).to.equal(7);
        expect(await gameToken.balanceOf(owner.address)).to.equal(1000000000000000);
    });

    it("Register gameswap contract as token manager.", async () => {
        const token = await gameToken.connect(ownerSigner);
        expect(await token.isMinter(gameSwap.address)).to.equal(false);
        await token.addMinter(gameSwap.address);
        expect(await token.isMinter(gameSwap.address)).to.equal(true);

        expect(await token.isManager(gameSwap.address)).to.equal(false);
        await token.addManager(gameSwap.address);
        expect(await token.isManager(gameSwap.address)).to.equal(true);

        const swap = await gameSwap.connect(ownerSigner);
        expect(await swap.isManager(manager.address)).to.equal(false);
        await swap.addManager(manager.address);
        expect(await swap.isManager(manager.address)).to.equal(true);
    });

    it("Open the lock withdraw box to swap points for tokens.", async () => {
        expect(await gameToken.connect(user01Signer).balanceOf(user01.address)).to.equal(0);
        const swap = await gameSwap.connect(managerSigner);
        await expect(swap.openWithdrawPoint2Token(withdrawLockBoxID, user01.address, 100)).to.emit(
            swap,
            "OpenWithdraw"
        );
        expect(await gameToken.connect(user01Signer).balanceOf(user01.address)).to.equal(0);
    });

    it("Check the open withdraw lock box.", async () => {
        const result = await gameSwap.checkWithdrawPoint2Token(withdrawLockBoxID);
        assert.strictEqual(result[0].toString(), "1");
        assert.strictEqual(result[1].toString(), user01.address);
        assert.strictEqual(result[2].toNumber(), 100);
    });

    it("Check the open withdraw box with duplicate lockBoxID", async () => {
        await expect(gameSwap.connect(managerSigner).openWithdrawPoint2Token(withdrawLockBoxID, user02.address, 100)).to
            .be.reverted;
    });

    it("Close the withdraw lock box", async () => {
        await expect(gameSwap.connect(user01Signer).closeDepositToken2Point(withdrawLockBoxID)).to.be.reverted;
        await expect(gameSwap.connect(user02Signer).closeDepositToken2Point(withdrawLockBoxID)).to.be.reverted;
        await expect(gameSwap.connect(managerSigner).closeWithdrawPoint2Token(withdrawLockBoxID)).to.emit(
            gameSwap,
            "CloseWithdraw"
        );

        expect(await gameToken.connect(user01Signer).balanceOf(user01.address)).to.equal(100);
    });

    it("Open deposit lock box to swap tokens for points.", async () => {
        const token = await gameToken.connect(user01Signer);
        expect(await token.balanceOf(user01.address)).to.equal(100);
        token.approve(gameSwap.address, 100);
        expect(await token.allowance(user01.address, gameSwap.address)).to.eq(100);
        await expect(gameSwap.connect(user01Signer).openDepositToken2Point(depositLockBoxID, 100)).to.emit(
            gameSwap,
            "OpenDeposit"
        );
    });

    it("Check the open deposit lock box.", async () => {
        const result = await gameSwap.checkDepositToken2Point(depositLockBoxID);
        assert.strictEqual(result[0].toString(), "1");
        assert.strictEqual(result[1].toString(), user01.address);
        assert.strictEqual(result[2].toNumber(), 100);
    });

    it("Check the open deposit box with duplicate lockBoxID", async () => {
        await expect(gameSwap.connect(managerSigner).openDepositToken2Point(depositLockBoxID, 100)).to.be.reverted;
    });

    it("Close the deposit lock box", async () => {
        await expect(gameSwap.connect(user01Signer).closeDepositToken2Point(depositLockBoxID)).to.be.reverted;
        await expect(gameSwap.connect(user02Signer).closeDepositToken2Point(depositLockBoxID)).to.be.reverted;
        await expect(gameSwap.connect(managerSigner).closeDepositToken2Point(depositLockBoxID)).to.emit(
            gameSwap,
            "CloseDeposit"
        );

        expect(await gameToken.connect(user01Signer).balanceOf(user01.address)).to.equal(0);
    });

    it("Check the close deposit lock box", async () => {
        const result = await gameSwap.checkDepositToken2Point(depositLockBoxID);
        assert.strictEqual(result[0].toString(), "2");
        assert.strictEqual(result[1].toString(), user01.address);
        assert.strictEqual(result[2].toNumber(), 100);
    });

    it("Check transfer limit", async () => {
        const swap = await gameSwap.connect(managerSigner);

        expect(await swap.getTodaySwappedAmount()).to.eq(100);
        await expect(swap.enableSwapLimitPerDay()).to.emit(swap, "EnabledSwapLimitPerDay");
        await expect(swap.setSwapLimitPerDayAmount(500)).to.emit(swap, "ChangeSwapLimitPerDayAmount");

        let boxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        await swap.openWithdrawPoint2Token(boxID, user01.address, 100);
        await swap.closeWithdrawPoint2Token(boxID);
        expect(await gameSwap.getTodaySwappedAmount()).to.eq(200);
        expect(await gameSwap.getTodaySwappableAmount()).to.eq(300);

        boxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        await swap.openWithdrawPoint2Token(boxID, user01.address, 100);
        await swap.closeWithdrawPoint2Token(boxID);
        expect(await gameSwap.getTodaySwappedAmount()).to.eq(300);
        expect(await gameSwap.getTodaySwappableAmount()).to.eq(200);

        boxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        await swap.openWithdrawPoint2Token(boxID, user01.address, 100);
        await swap.closeWithdrawPoint2Token(boxID);
        expect(await gameSwap.getTodaySwappedAmount()).to.eq(400);
        expect(await gameSwap.getTodaySwappableAmount()).to.eq(100);

        boxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        await swap.openWithdrawPoint2Token(boxID, user01.address, 100);
        await swap.closeWithdrawPoint2Token(boxID);
        expect(await gameSwap.getTodaySwappedAmount()).to.eq(500);
        expect(await gameSwap.getTodaySwappableAmount()).to.eq(0);

        boxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        await expect(swap.openWithdrawPoint2Token(boxID, user01.address, 1)).to.be.reverted;
        await expect(swap.closeWithdrawPoint2Token(boxID)).to.be.reverted;
        expect(await gameSwap.getTodaySwappedAmount()).to.eq(500);
    });

    it("Reset transfer limit volume", async () => {
        const swap = await gameSwap.connect(managerSigner);

        expect(await gameSwap.getTodaySwappedAmount()).to.eq(500);
        await expect(gameSwap.connect(user01Signer).resetTodaySwapAmount()).to.be.reverted;

        await expect(swap.resetTodaySwapAmount()).to.emit(swap, "ResetTodaySwapLimitAmount");
        expect(await gameSwap.getTodaySwappedAmount()).to.eq(0);

        const boxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        await swap.openWithdrawPoint2Token(boxID, user01.address, 100);
        await swap.closeWithdrawPoint2Token(boxID);
        expect(await gameSwap.getTodaySwappedAmount()).to.eq(100);
    });
});
