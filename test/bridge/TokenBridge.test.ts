import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, waffle } from "hardhat";
import { TestToken, TokenBridge } from "../../typechain";
import { ContractUtils } from "../ContractUtils";

import * as assert from "assert";

chai.use(solidity);

describe("Test for Token Bridge", () => {
    const provider = waffle.provider;
    const [admin, manager, other] = provider.getWallets();
    const admin_signer = provider.getSigner(admin.address);
    const manager_signer = provider.getSigner(manager.address);
    const other_signer = provider.getSigner(other.address);

    let bridge: TokenBridge;
    let token1: TestToken;
    let token2: TestToken;

    before(async () => {
        const TokenBridgeFactory = await ethers.getContractFactory("TokenBridge");
        const TestTokenFactory = await ethers.getContractFactory("TestToken");

        token1 = await TestTokenFactory.connect(admin_signer).deploy("Token1", "TNA", 10);
        await token1.deployed();

        token2 = await TestTokenFactory.connect(admin_signer).deploy("Token1", "TNB", 10);
        await token2.deployed();

        bridge = (await TokenBridgeFactory.connect(admin_signer).deploy(60)) as TokenBridge;
        await bridge.deployed();

        assert.strictEqual(await bridge.owner(), admin.address);
        assert.ok(!(await bridge.isManager(admin.address)));
    });

    it("Add a manager", async () => {
        await bridge.connect(admin_signer).addManager(manager.address);
        assert.ok(await bridge.isManager(manager.address));
    });

    it("Register a token", async () => {
        const tokenId1 = ContractUtils.getTokenId(bridge.address, await token1.name(), await token1.symbol());
        // Only the manager can call.
        await expect(bridge.connect(other_signer).registerToken(tokenId1, token1.address)).to.be.reverted;

        expect(await bridge.connect(manager_signer).registerToken(tokenId1, token1.address)).to.emit(
            bridge,
            "TokenRegistered"
        );

        // The same token cannot be registered more than once.
        await expect(bridge.connect(manager_signer).registerToken(tokenId1, token1.address)).to.be.reverted;

        const tokenId2 = ContractUtils.getTokenId(bridge.address, await token2.name(), await token2.symbol());
        expect(await bridge.connect(manager_signer).registerToken(tokenId2, token2.address)).to.emit(
            bridge,
            "TokenRegistered"
        );
    });
});
