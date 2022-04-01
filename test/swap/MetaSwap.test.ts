import assert from "assert";
import { expect } from "chai";
import { ethers, waffle } from "hardhat";
// @ts-ignore
import { MetaSwap, TestERC20 } from "../../typechain";
import { BOA, ContractUtils } from "../ContractUtils";

describe("Test of MetaSwap Contract", () => {
    let bizToken: TestERC20;
    let metaSwap: MetaSwap;
    let depositLockBoxID: string;
    let withdrawLockBoxID: string;
    let withdrawLockBoxID2: string;

    const provider = waffle.provider;
    const [owner, manager, user01, user02] = provider.getWallets();
    const ownerSigner = provider.getSigner(owner.address);
    const managerSigner = provider.getSigner(manager.address);
    const user01Signer = provider.getSigner(user01.address);
    const user02Signer = provider.getSigner(user02.address);

    const liquidityAmount = BOA(1000000);
    const token_price = 100;
    const swap_point = 200;
    const swap_boa = BOA(swap_point / token_price);
    const boa_unit = BOA(1);

    before(async () => {
        const erc20 = await ethers.getContractFactory("TestERC20");
        bizToken = await erc20.deploy("BOSAGORA Biz BOA Token", "BBOA");
        await bizToken.deployed();
        const swap = await ethers.getContractFactory("MetaSwap");
        metaSwap = await swap.deploy(bizToken.address);
        await metaSwap.deployed();
    });

    before("Create Key", async () => {
        depositLockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        withdrawLockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        withdrawLockBoxID2 = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
    });

    it("Check the game token status", async () => {
        expect(await bizToken.name()).to.equal("BOSAGORA Biz BOA Token");
        expect(await bizToken.symbol()).to.equal("BBOA");
        expect(await bizToken.decimals()).to.equal(7);
        expect(await bizToken.balanceOf(owner.address)).to.equal(1000000000000000);
    });

    it("Register metaSwap contract a manager.", async () => {
        const swap = await metaSwap.connect(ownerSigner);
        expect(await swap.isManager(manager.address)).to.equal(false);
        await swap.addManager(manager.address);
        expect(await swap.isManager(manager.address)).to.equal(true);
    });

    it("Send liquidity", async () => {
        await bizToken.connect(ownerSigner).approve(metaSwap.address, liquidityAmount);
        await expect(metaSwap.connect(ownerSigner).increaseLiquidity(owner.address, liquidityAmount)).to.emit(
            metaSwap,
            "IncreasedLiquidity"
        );
        expect(await bizToken.balanceOf(metaSwap.address)).to.equal(liquidityAmount);
        expect(await metaSwap.balanceOfLiquidity(owner.address)).to.equal(liquidityAmount);
    });

    it("Open the lock withdraw box to swap points for tokens.", async () => {
        expect(await bizToken.connect(user01Signer).balanceOf(user01.address)).to.equal(0);
        const swap = await metaSwap.connect(managerSigner);
        await expect(swap.openWithdrawPoint2Token(withdrawLockBoxID, user01.address, swap_point, token_price)).to.emit(
            swap,
            "OpenWithdraw"
        );
        expect(await bizToken.connect(user01Signer).balanceOf(user01.address)).to.equal(0);
    });

    it("Check the open withdraw lock box.", async () => {
        const result = await metaSwap.checkWithdrawPoint2Token(withdrawLockBoxID);
        assert.strictEqual(result[0].toString(), "1");
        assert.strictEqual(result[1].toString(), user01.address);
        assert.strictEqual(result[2].toNumber(), swap_point);
    });

    it("Check the open withdraw box with duplicate lockBoxID", async () => {
        await expect(
            metaSwap
                .connect(managerSigner)
                .openWithdrawPoint2Token(withdrawLockBoxID, user02.address, swap_point, token_price)
        ).to.be.reverted;
    });

    it("Close the withdraw lock box", async () => {
        await expect(metaSwap.connect(user01Signer).closeDepositToken2Point(withdrawLockBoxID)).to.be.reverted;
        await expect(metaSwap.connect(user02Signer).closeDepositToken2Point(withdrawLockBoxID)).to.be.reverted;
        await expect(metaSwap.connect(managerSigner).closeWithdrawPoint2Token(withdrawLockBoxID, token_price)).to.emit(
            metaSwap,
            "CloseWithdraw"
        );

        expect(await bizToken.connect(user01Signer).balanceOf(user01.address)).to.equal(BOA(swap_point / token_price));
    });

    it("Check the close withdraw lock box", async () => {
        const result = await metaSwap.checkWithdrawPoint2Token(withdrawLockBoxID);
        assert.strictEqual(result[0].toString(), "2");
        assert.strictEqual(result[1].toString(), user01.address);
        assert.strictEqual(result[2].toNumber(), swap_point);
        assert.strictEqual(result[4].toString(), BOA(swap_point / token_price).toString());
    });

    it("Open deposit lock box to swap tokens for points.", async () => {
        const token = await bizToken.connect(user01Signer);
        expect(await token.balanceOf(user01.address)).to.equal(swap_boa);
        await token.approve(metaSwap.address, swap_boa);
        expect(await token.allowance(user01.address, metaSwap.address)).to.eq(swap_boa);
        await expect(metaSwap.connect(user01Signer).openDepositToken2Point(depositLockBoxID, swap_boa)).to.emit(
            metaSwap,
            "OpenDeposit"
        );
    });

    it("Check the open deposit lock box.", async () => {
        const result = await metaSwap.checkDepositToken2Point(depositLockBoxID);
        assert.strictEqual(result[0].toString(), "1");
        assert.strictEqual(result[1].toString(), user01.address);
        assert.strictEqual(result[2].toNumber(), swap_boa.toNumber());
    });

    it("Check the open deposit box with duplicate lockBoxID", async () => {
        await expect(metaSwap.connect(managerSigner).openDepositToken2Point(depositLockBoxID, swap_boa)).to.be.reverted;
    });

    it("Close the deposit lock box", async () => {
        await expect(metaSwap.connect(user01Signer).closeDepositToken2Point(depositLockBoxID)).to.be.reverted;
        await expect(metaSwap.connect(user02Signer).closeDepositToken2Point(depositLockBoxID)).to.be.reverted;
        await expect(metaSwap.connect(managerSigner).closeDepositToken2Point(depositLockBoxID)).to.emit(
            metaSwap,
            "CloseDeposit"
        );

        expect(await bizToken.connect(user01Signer).balanceOf(user01.address)).to.equal(0);
    });

    it("Check the close deposit lock box", async () => {
        const result = await metaSwap.checkDepositToken2Point(depositLockBoxID);
        assert.strictEqual(result[0].toString(), "2");
        assert.strictEqual(result[1].toString(), user01.address);
        assert.strictEqual(result[2].toNumber(), swap_boa.toNumber());
    });

    it("Check the over liquidity withdraw", async () => {
        const swap_point_not_enough = liquidityAmount.mul(token_price).div(boa_unit).add(1);
        const swap = await metaSwap.connect(managerSigner);
        await expect(
            swap.openWithdrawPoint2Token(withdrawLockBoxID2, user02.address, swap_point_not_enough, token_price)
        ).to.be.reverted;

        const swap_point_enough = liquidityAmount.mul(token_price).div(boa_unit);
        await expect(
            swap.openWithdrawPoint2Token(withdrawLockBoxID2, user02.address, swap_point_enough, token_price)
        ).to.emit(metaSwap, "OpenWithdraw");
    });
});
