import assert from "assert";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";
// @ts-ignore
import { MetaSwap } from "../../typechain";
import { BOACoin, ContractUtils } from "../ContractUtils";

describe("Test of MetaSwap Contract", () => {
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

    const liquidity_amount = BOACoin(1000);
    const swap_amount = BOACoin(100);

    const boa_price = 100;
    const swap_point = 2000;

    let old_user_balance_bizNet: BigNumber;

    before(async () => {
        const swap = await ethers.getContractFactory("MetaSwap");
        metaSwap = await swap.deploy();
        await metaSwap.deployed();
    });

    before("Create Key", async () => {
        depositLockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        withdrawLockBoxID = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        withdrawLockBoxID2 = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
    });

    it("Register metaSwap contract a manager.", async () => {
        const swap = await metaSwap.connect(ownerSigner);
        expect(await swap.isManager(manager.address)).to.equal(false);
        await swap.addManager(manager.address);
        expect(await swap.isManager(manager.address)).to.equal(true);
    });

    it("Send liquidity", async () => {
        await expect(
            metaSwap.connect(ownerSigner).increaseLiquidity({ from: owner.address, value: liquidity_amount })
        ).to.emit(metaSwap, "IncreasedLiquidity");
        expect(await provider.getBalance(metaSwap.address)).to.equal(liquidity_amount);
        expect(await metaSwap.balanceOfLiquidity(owner.address)).to.equal(liquidity_amount);
    });

    context("MetaPoint to Coin", async () => {
        it("Save current BOACoin balance", async () => {
            old_user_balance_bizNet = await provider.getBalance(user01.address);
        });

        it("Open the lock withdraw box to swap points for BOACoin.", async () => {
            await expect(
                metaSwap
                    .connect(managerSigner)
                    .openWithdrawPoint2BOA(withdrawLockBoxID, user01.address, swap_point, boa_price)
            ).to.emit(metaSwap, "OpenWithdraw");
        });

        it("Check the open withdraw lock box.", async () => {
            const result = await metaSwap.checkWithdrawPoint2BOA(withdrawLockBoxID);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[1].toString(), user01.address);
            assert.strictEqual(result[2].toString(), swap_point.toString());
        });

        it("Check the open withdraw box with duplicate lockBoxID", async () => {
            await expect(
                metaSwap
                    .connect(managerSigner)
                    .openWithdrawPoint2BOA(withdrawLockBoxID, user01.address, swap_point, boa_price)
            ).to.be.reverted;
        });

        it("Close the withdraw lock box", async () => {
            await expect(metaSwap.connect(user02Signer).closeWithdrawPoint2BOA(withdrawLockBoxID, boa_price)).to.be
                .reverted;
            await expect(metaSwap.connect(managerSigner).closeWithdrawPoint2BOA(withdrawLockBoxID, boa_price)).to.emit(
                metaSwap,
                "CloseWithdraw"
            );
        });

        it("Test to see if coins have been converted to points", async () => {
            const ExpectedAmount = BOACoin(swap_point / boa_price).add(old_user_balance_bizNet);
            expect(await provider.getBalance(user01.address)).to.equal(ExpectedAmount);
        });

        it("Check the close withdraw lock box", async () => {
            const result = await metaSwap.checkWithdrawPoint2BOA(withdrawLockBoxID);
            assert.strictEqual(result[0].toString(), "2");
            assert.strictEqual(result[1].toString(), user01.address);
            assert.strictEqual(result[2].toNumber(), swap_point);
        });
    });

    context("Coin to MetaPoint", async () => {
        it("Save current BOACoin balance", async () => {
            old_user_balance_bizNet = await provider.getBalance(user01.address);
        });

        it("Open deposit lock box to swap BOACoin for points.", async () => {
            await expect(
                metaSwap.connect(user01Signer).openDepositBOA2Point(depositLockBoxID, {
                    from: user01.address,
                    value: swap_amount,
                })
            ).to.emit(metaSwap, "OpenDeposit");
        });

        it("Check the open deposit lock box.", async () => {
            const result = await metaSwap.checkDepositBOA2Point(depositLockBoxID);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[1].toString(), user01.address);
            assert.strictEqual(result[2].toString(), swap_amount.toString());
        });

        it("Check the open deposit box with duplicate lockBoxID", async () => {
            await expect(
                metaSwap.connect(managerSigner).openDepositBOA2Point(depositLockBoxID, {
                    from: user01.address,
                    value: swap_amount,
                })
            ).to.be.reverted;
        });

        it("Close the deposit lock box", async () => {
            await expect(metaSwap.connect(user02Signer).closeDepositBOA2Point(depositLockBoxID)).to.be.reverted;
            await expect(metaSwap.connect(managerSigner).closeDepositBOA2Point(depositLockBoxID)).to.emit(
                metaSwap,
                "CloseDeposit"
            );
        });

        it("Test to see if coins have been converted to points", async () => {
            const expectedAmount = old_user_balance_bizNet.sub(swap_amount);
            const amount = await provider.getBalance(user01.address);
            assert.ok(expectedAmount.gt(amount));
        });

        it("Check the close deposit lock box", async () => {
            const result = await metaSwap.checkDepositBOA2Point(depositLockBoxID);
            assert.strictEqual(result[0].toString(), "2");
            assert.strictEqual(result[1].toString(), user01.address);
            assert.strictEqual(result[2].toString(), swap_amount.toString());
        });
    });
    it("Check the over liquidity withdraw", async () => {
        const liquidity = await metaSwap.balanceOfLiquidity(owner.address);
        const swap_point_not_enough: BigNumber = liquidity.mul(boa_price).add(1);
        await expect(
            metaSwap
                .connect(managerSigner)
                .openWithdrawPoint2BOA(withdrawLockBoxID2, user02.address, swap_point_not_enough, boa_price)
        ).to.be.reverted;
    });
});
