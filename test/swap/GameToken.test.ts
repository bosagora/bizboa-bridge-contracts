import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

describe("Test of GameToken", () => {
    let gameToken: Contract;

    const provider = waffle.provider;
    const [owner, manager, minter, user01, user02] = provider.getWallets();
    const ownerSigner = provider.getSigner(owner.address);
    const managerSigner = provider.getSigner(manager.address);
    const minterSigner = provider.getSigner(minter.address);
    const user01Signer = provider.getSigner(user01.address);
    const user02Signer = provider.getSigner(user02.address);

    before(async () => {
        const GameToken = await ethers.getContractFactory("GameToken");
        gameToken = await GameToken.deploy("BOSAGORA", "GBOA", 7, 1000000000000000);
        await gameToken.deployed();
    });

    it("Check the token status", async () => {
        expect(await gameToken.name()).to.equal("BOSAGORA");
        expect(await gameToken.symbol()).to.equal("GBOA");
        expect(await gameToken.decimals()).to.equal(7);
        expect(await gameToken.balanceOf(owner.address)).to.equal(1000000000000000);
    });

    it("Minter Test", async () => {
        const token = await gameToken.connect(ownerSigner);
        expect(await token.mint(owner.address, 1000)).to.emit(token, "Transfer");
        expect(await token.balanceOf(owner.address)).to.equal(1000000000001000);

        expect(await token.isMinter(minter.address)).to.equal(false);
        await token.addMinter(minter.address);
        expect(await token.isMinter(minter.address)).to.equal(true);

        const minterToken = await gameToken.connect(minterSigner);
        expect(await minterToken.mint(owner.address, 1000)).to.emit(token, "Transfer");
        expect(await minterToken.balanceOf(owner.address)).to.equal(1000000000002000);
    });

    it("Transfer Test between Owner and User", async () => {
        let token = await gameToken.connect(ownerSigner);
        await expect(() => token.transfer(user01.address, 200)).to.changeTokenBalance(token, user01, 200);
        expect(await token.balanceOf(user01.address)).to.equal(200);

        token = await gameToken.connect(user01Signer);
        await expect(() => token.transfer(owner.address, 100)).to.changeTokenBalances(
            token,
            [user01, owner],
            [-100, 100]
        );
        expect(await token.balanceOf(user01.address)).to.equal(100);
    });

    it("Transfer Test between User and User", async () => {
        const token = await gameToken.connect(user01Signer);
        await expect(token.transfer(user02.address, 100)).to.be.reverted;
        expect(await token.balanceOf(user02.address)).to.equal(0);
    });

    it("Transfer Test with Manager account", async () => {
        const token = await gameToken.connect(user01Signer);
        await expect(token.transfer(manager.address, 100)).to.be.reverted;
        expect(await token.balanceOf(manager.address)).to.equal(0);

        const ownerToken = await gameToken.connect(ownerSigner);
        expect(await ownerToken.isManager(manager.address)).to.equal(false);
        await ownerToken.addManager(manager.address);
        expect(await ownerToken.isManager(manager.address)).to.equal(true);

        await expect(() => token.transfer(manager.address, 100)).to.changeTokenBalance(token, manager, 100);
        expect(await token.balanceOf(manager.address)).to.equal(100);

        const managerToken = await gameToken.connect(managerSigner);
        await expect(() => managerToken.transfer(user02.address, 50)).to.changeTokenBalance(token, user02, 50);
        expect(await token.balanceOf(user02.address)).to.equal(50);
    });

    it("Approve Test between user.", async () => {
        const user02Token = await gameToken.connect(user02Signer);
        expect(await user02Token.balanceOf(user02.address)).to.equal(50);
        await expect(user02Token.approve(user01.address, 50)).to.be.reverted;
    });

    it("Approve Test included manager.", async () => {
        const user02Token = await gameToken.connect(user02Signer);
        await expect(user02Token.approve(manager.address, 50))
            .to.emit(user02Token, "Approval")
            .withArgs(user02.address, manager.address, 50);
        expect(await user02Token.allowance(user02.address, manager.address)).to.eq(50);
    });

    it("TransferFrom Test included manager.", async () => {
        const token = await gameToken.connect(managerSigner);
        expect(await token.allowance(user02.address, manager.address)).to.eq(50);
        await expect(() => token.transferFrom(user02.address, manager.address, 50)).to.changeTokenBalance(
            token,
            manager,
            50
        );
        expect(await token.allowance(user02.address, manager.address)).to.eq(0);
    });
});
