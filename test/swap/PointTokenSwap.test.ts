import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { GameToken, PointToken, PointTokenSwap } from "../../typechain";
import { BOAToken } from "../ContractUtils";

describe("Test of Point <=> Token", () => {
    let pointToken: PointToken;
    let gameToken: GameToken;
    let swap: PointTokenSwap;

    const provider = waffle.provider;
    const [owner, manager, providerManager, user01, user02] = provider.getWallets();
    const ownerSigner = provider.getSigner(owner.address);
    const user01Signer = provider.getSigner(user01.address);
    const user02Signer = provider.getSigner(user02.address);
    const initSupply = BOAToken(100000000);
    const initUserBalance = BOAToken(10000);
    const swapPointAmount = 1000;
    const limitPoint = 2000;
    const swapTokenAmount = BOAToken(swapPointAmount);

    before(async () => {
        const pt = await ethers.getContractFactory("PointToken");
        pointToken = await pt.deploy("TETRIS_POINT", "GPT", limitPoint, providerManager.address, manager.address);
        await pointToken.deployed();

        const gt = await ethers.getContractFactory("GameToken");
        gameToken = await gt.deploy("TETRIS_TOKEN", "GTT", 7, initSupply);
        await gameToken.deployed();

        const pts = await ethers.getContractFactory("PointTokenSwap");
        swap = await pts.deploy(gameToken.address, pointToken.address);
        await swap.deployed();
    });

    it("Check the token status", async () => {
        expect(await pointToken.name()).to.equal("TETRIS_POINT");
        expect(await pointToken.symbol()).to.equal("GPT");
        expect(await pointToken.decimals()).to.equal(0);
        expect(await pointToken.totalSupply()).to.equal(0);

        expect(await gameToken.name()).to.equal("TETRIS_TOKEN");
        expect(await gameToken.symbol()).to.equal("GTT");
        expect(await gameToken.decimals()).to.equal(7);
        expect(await gameToken.totalSupply()).to.equal(initSupply);
    });

    it("Initial fund transfer", async () => {
        const token = await gameToken.connect(ownerSigner);
        await expect(() => token.transfer(user01.address, initUserBalance)).to.changeTokenBalance(
            token,
            user01,
            initUserBalance
        );
    });

    it("Test of manager setting", async () => {
        await pointToken.connect(ownerSigner).addMinter(swap.address);
        await pointToken.connect(ownerSigner).addManager(swap.address);
        expect(await pointToken.isMinter(swap.address)).to.equal(true);
        expect(await pointToken.isManager(swap.address)).to.equal(true);

        await gameToken.connect(ownerSigner).addManager(swap.address);
        await gameToken.connect(ownerSigner).addMinter(swap.address);
        expect(await gameToken.isMinter(swap.address)).to.equal(true);
        expect(await gameToken.isManager(swap.address)).to.equal(true);
    });

    it("Test token transfer between user and user by disabling Allow transfer", async () => {
        expect(await gameToken.isAllowManagerIncludedTransfer()).to.equal(true);
        const token = await gameToken.connect(user01Signer);
        await expect(token.transfer(user02.address, 100)).to.be.revertedWith(
            "AccessControl: Do not transfer between regular accounts."
        );
        expect(await token.balanceOf(user02.address)).to.equal(0);
    });

    it("Test token transfer between user and user by enable Allow transfer", async () => {
        expect(await gameToken.isAllowManagerIncludedTransfer()).to.equal(true);
        await gameToken.connect(ownerSigner).disableAllowManagerIncludedTransfer();
        expect(await gameToken.isAllowManagerIncludedTransfer()).to.equal(false);
        await gameToken.connect(user01Signer).transfer(user02.address, initUserBalance);
        expect(await gameToken.balanceOf(user02.address)).to.equal(initUserBalance);
    });

    it("Test of swap from token to point", async () => {
        const token = gameToken.connect(user02Signer);
        await expect(token.approve(swap.address, swapTokenAmount)).to.emit(token, "Approval");
        await swap.connect(user02Signer).swapToPoint(swapTokenAmount);
    });

    it("Test of result amount after swap", async () => {
        expect(await gameToken.balanceOf(user02.address)).to.equal(initUserBalance.sub(swapTokenAmount));
        expect(await pointToken.balanceOf(user02.address)).to.equal(swapPointAmount);
    });

    it("Test point transfer between user and user by disabling Allow transfer", async () => {
        const point = pointToken.connect(user02Signer);
        expect(await point.balanceOf(user02.address)).to.equal(swapPointAmount);
        await expect(point.transfer(user01.address, swapPointAmount)).to.be.revertedWith(
            "AccessControl: Do not transfer between regular accounts."
        );
    });

    it("Test point transfer between user and user by enable Allow transfer", async () => {
        const point = pointToken.connect(user02Signer);
        expect(await point.balanceOf(user02.address)).to.equal(swapPointAmount);

        await pointToken.connect(ownerSigner).disableAllowManagerIncludedTransfer();
        await point.transfer(user01.address, swapPointAmount);

        expect(await point.balanceOf(user01.address)).to.equal(swapPointAmount);
        expect(await point.balanceOf(user02.address)).to.equal(0);
    });

    it("Test of swap from point to token", async () => {
        const point = pointToken.connect(user01Signer);
        await expect(point.approve(swap.address, swapPointAmount)).to.emit(point, "Approval");
        await swap.connect(user01Signer).swapToToken(swapPointAmount);
    });

    it("Test of result amount after swap", async () => {
        expect(await pointToken.balanceOf(user01.address)).to.equal(0);
        expect(await gameToken.balanceOf(user01.address)).to.equal(swapTokenAmount);
    });

    it("Test of point supply limit", async () => {
        const token = await gameToken.connect(ownerSigner);

        await expect(token.approve(swap.address, swapTokenAmount)).to.emit(token, "Approval");
        await swap.connect(ownerSigner).swapToPoint(swapTokenAmount);

        await expect(token.approve(swap.address, swapTokenAmount)).to.emit(token, "Approval");
        await swap.connect(ownerSigner).swapToPoint(swapTokenAmount);

        await expect(token.approve(swap.address, BOAToken(1))).to.emit(token, "Approval");
        await expect(swap.connect(ownerSigner).swapToPoint(BOAToken(1))).to.be.revertedWith(
            "PointToken: Supply limit exceeded."
        );
    });
});
