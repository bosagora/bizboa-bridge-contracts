import { assert, expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";
import { PointCoinSwap, PointToken } from "../../typechain";
import { BOACoin } from "../ContractUtils";

describe("Test of Point <=> Coin", () => {
    let metaPoint: PointToken;
    let swapContract: PointCoinSwap;

    const provider = waffle.provider;
    const [owner, manager, minter, providerManager, feeManager, user01, user02] = provider.getWallets();
    const ownerSigner = provider.getSigner(owner.address);
    const managerSigner = provider.getSigner(manager.address);
    const minterSigner = provider.getSigner(minter.address);
    const providerSigner = provider.getSigner(providerManager.address);
    const user01Signer = provider.getSigner(user01.address);
    const user02Signer = provider.getSigner(user02.address);
    const swapPointAmount = 1000;
    const swapCoinAmount = BOACoin(100);
    const swapFeeRate = 1.5 * 100;
    const boaPrice = 100;
    const maxSupplyLimit = 540000000;
    const liquidityCoin = BOACoin(100000);
    const liquidityPoint = 100000000;
    let old_user_coin_balance: BigNumber;
    let old_user_point_balance: BigNumber;

    before(async () => {
        const pt = await ethers.getContractFactory("PointToken");
        metaPoint = await pt.deploy("META_POINT", "META", maxSupplyLimit, providerManager.address, manager.address);
        await metaPoint.deployed();

        const pts = await ethers.getContractFactory("PointCoinSwap");
        swapContract = await pts.deploy(metaPoint.address, feeManager.address, swapFeeRate);
        await swapContract.deployed();
    });

    before("init a manager", async () => {
        await metaPoint.connect(ownerSigner).addManager(swapContract.address);
        await metaPoint.connect(ownerSigner).addMinter(swapContract.address);
        await swapContract.connect(ownerSigner).setBoaPrice(boaPrice);
    });

    it("Check the point status", async () => {
        expect(await metaPoint.name()).to.equal("META_POINT");
        expect(await metaPoint.symbol()).to.equal("META");
        expect(await metaPoint.decimals()).to.equal(0);
        expect(await metaPoint.totalSupply()).to.equal(0);
    });

    it("Point Mint to provider", async () => {
        await metaPoint.connect(ownerSigner).addMinter(manager.address);
        await metaPoint.connect(ownerSigner).mint(providerManager.address, liquidityPoint);
    });

    it("Test of liquidity is insufficient swap", async () => {
        await expect(
            swapContract.connect(user01Signer).swapToPoint({
                from: user01.address,
                value: swapCoinAmount,
            })
        ).to.be.revertedWith("The point liquidity is insufficient.");
        await metaPoint.connect(providerSigner).approve(swapContract.address, liquidityPoint);
        await expect(swapContract.connect(providerSigner).swapToCoin(swapPointAmount)).to.be.revertedWith(
            "The coin liquidity is insufficient."
        );
        await metaPoint.connect(providerSigner).approve(swapContract.address, liquidityPoint);
    });

    it("Test of Coin liquidity supply", async () => {
        let swap = await swapContract.connect(ownerSigner);
        await expect(
            swap.increaseCoinLiquidity({
                from: owner.address,
                value: liquidityCoin,
            })
        ).to.emit(swap, "IncreasedCoinLiquidity");

        swap = await swapContract.connect(providerSigner);
    });

    it("Test of Point liquidity supply", async () => {
        const swap = await swapContract.connect(providerSigner);
        const point = await metaPoint.connect(providerSigner);

        await expect(point.connect(providerSigner).approve(swap.address, liquidityPoint)).to.emit(point, "Approval");
        await expect(swap.increasePointLiquidity(liquidityPoint)).to.emit(swap, "IncreasedPointLiquidity");
    });

    it("Check the balance", async () => {
        old_user_coin_balance = await provider.getBalance(user01.address);
        old_user_point_balance = await metaPoint.balanceOf(user01.address);
    });

    let txFee: BigNumber;
    it("Test of swap from coin to point", async () => {
        const beforeAmount = await provider.getBalance(user01.address);
        await expect(
            swapContract.connect(user01Signer).swapToPoint({
                from: user01.address,
                value: swapCoinAmount,
            })
        ).to.ok;
        const afterAmount = await provider.getBalance(user01.address);
        txFee = beforeAmount.sub(afterAmount.add(swapCoinAmount));
    });

    it("Test of result amount after swap", async () => {
        const point = await metaPoint.balanceOf(user01.address);
        assert.isTrue(point.gt(old_user_point_balance));

        const coin = await provider.getBalance(user01.address);
        assert.isTrue(coin.lt(old_user_coin_balance));
    });

    it("Test of swap from point to token", async () => {
        old_user_coin_balance = await provider.getBalance(user01.address);
        old_user_point_balance = await metaPoint.balanceOf(user01.address);
        const point = metaPoint.connect(user01Signer);
        await expect(point.approve(swapContract.address, swapPointAmount)).to.emit(point, "Approval");
        await swapContract.connect(user01Signer).swapToCoin(swapPointAmount);
    });

    it("Test of result amount after swap", async () => {
        expect(await metaPoint.balanceOf(user01.address)).to.equal(old_user_point_balance.sub(swapPointAmount));
        const coin = await provider.getBalance(user01.address);
        assert.isTrue(coin.gt(old_user_coin_balance));
    });

    it("Test of collected swap fee ", async () => {
        const coinFee = await swapContract.balanceOfCoinLiquidity(feeManager.address);
        const pointFee = await swapContract.balanceOfPointLiquidity(feeManager.address);

        const expectCoinFee = swapCoinAmount.mul(swapFeeRate).div(10000);
        const expectPointFee = swapPointAmount * 0.015;

        assert.equal(coinFee.toString(), expectCoinFee.toString());
        assert.equal(pointFee.toString(), expectPointFee.toString());
    });
});
