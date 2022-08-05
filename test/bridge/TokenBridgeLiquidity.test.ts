import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, waffle } from "hardhat";
import { TestToken, TokenBridge } from "../../typechain";
import { Amount } from "../../utils/Amount";
import { ContractUtils } from "../ContractUtils";

import * as assert from "assert";

chai.use(solidity);

describe("Test of Increase Liquidity & Decrease Liquidity - TokenBridge", () => {
    let bridge_contract: TokenBridge;
    let token_contract: TestToken;

    const provider = waffle.provider;
    const [admin, user, manager, liquid_provider] = provider.getWallets();
    const admin_signer = provider.getSigner(admin.address);
    const user_signer = provider.getSigner(user.address);
    const manager_signer = provider.getSigner(manager.address);
    const liquid_provider_signer = provider.getSigner(liquid_provider.address);

    const decimal = 10;
    const liquidity_amount = Amount.make(1000000, decimal);
    const swap_amount = Amount.make(10000, decimal);
    const time_lock = 60 * 60 * 24;

    let token_id: string;

    before(async () => {
        const TokenBridgeFactory = await ethers.getContractFactory("TokenBridge");
        const TestTokenFactory = await ethers.getContractFactory("TestToken");

        token_contract = await TestTokenFactory.connect(admin_signer).deploy("TokenA", "TNA", decimal);
        await token_contract.deployed();

        bridge_contract = await TokenBridgeFactory.connect(admin_signer).deploy(time_lock);
        await bridge_contract.deployed();
    });

    before("Add a manager", async () => {
        await bridge_contract.connect(admin_signer).addManager(manager.address);
        assert.ok(await bridge_contract.isManager(manager.address));
    });

    before("Register a token", async () => {
        token_id = ContractUtils.BufferToString(
            ContractUtils.getTokenId(
                bridge_contract.address,
                await token_contract.name(),
                await token_contract.symbol()
            )
        );
        expect(await bridge_contract.connect(manager_signer).registerToken(token_id, token_contract.address)).to.emit(
            bridge_contract,
            "TokenRegistered"
        );
    });

    before("Distribute the fund", async () => {
        await token_contract.connect(admin_signer).transfer(liquid_provider.address, liquidity_amount.value);
        assert.strictEqual((await token_contract.balanceOf(bridge_contract.address)).toString(), "0");
    });

    context("Basic Test", async () => {
        it("Increase liquidity", async () => {
            await token_contract
                .connect(liquid_provider_signer)
                .approve(bridge_contract.address, liquidity_amount.value);
            await bridge_contract
                .connect(liquid_provider_signer)
                .increaseLiquidity(token_id, liquid_provider.address, liquidity_amount.value);

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(token_id, liquid_provider.address);
            assert.strictEqual(liquid_balance.toString(), liquidity_amount.toString());

            const bridge_balance = await token_contract.balanceOf(bridge_contract.address);
            assert.strictEqual(bridge_balance.toString(), liquidity_amount.toString());

            assert.strictEqual((await token_contract.balanceOf(liquid_provider.address)).toString(), "0");
        });

        it("Decrease liquidity", async () => {
            await bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(token_id, liquidity_amount.value);

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(token_id, liquid_provider.address);

            assert.strictEqual(liquid_balance.toString(), "0");

            const bridge_balance = await token_contract.balanceOf(bridge_contract.address);
            assert.strictEqual(bridge_balance.toString(), "0");

            assert.strictEqual(
                (await token_contract.balanceOf(liquid_provider.address)).toString(),
                liquidity_amount.toString()
            );
        });
    });

    context("Insufficient balance", async () => {
        let lock: string;
        let key: string;
        let lock_box_id: string;

        it("Second increase liquidity", async () => {
            await token_contract
                .connect(liquid_provider_signer)
                .approve(bridge_contract.address, liquidity_amount.value);
            await bridge_contract
                .connect(liquid_provider_signer)
                .increaseLiquidity(token_id, liquid_provider.address, liquidity_amount.value);
        });

        it("Create key by User", () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box by Manager", async () => {
            expect(
                await bridge_contract
                    .connect(manager_signer)
                    .openWithdraw(token_id, lock_box_id, swap_amount.value, user.address, user.address, lock)
            ).to.emit(bridge_contract, "OpenWithdraw");
        });

        it("Close the lock box  by User", async () => {
            expect(await bridge_contract.connect(user_signer).closeWithdraw(lock_box_id, key)).to.emit(
                bridge_contract,
                "CloseWithdraw"
            );
            const user_balance = await token_contract.balanceOf(user.address);
            assert.strictEqual(user_balance.toString(), swap_amount.toString());
            const bridge_balance = await token_contract.balanceOf(bridge_contract.address);
            assert.strictEqual(bridge_balance.toString(), liquidity_amount.value.sub(swap_amount.value).toString());
        });

        it("Error occurs when the overall liquidity decreases - insufficient balance", async () => {
            await assert.rejects(
                bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(token_id, liquidity_amount.value)
            );
        });

        it("Decrease some of the liquidity", async () => {
            await bridge_contract
                .connect(liquid_provider_signer)
                .decreaseLiquidity(token_id, liquidity_amount.value.sub(swap_amount.value));

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(token_id, liquid_provider.address);

            assert.strictEqual(liquid_balance.toString(), swap_amount.toString());
        });
    });
});
