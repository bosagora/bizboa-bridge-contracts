import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, waffle } from "hardhat";
import { BOACoinBridge, BOATokenBridge, TestERC20 } from "../../typechain";
import { BOACoin, BOAToken, ContractUtils } from "../ContractUtils";

import { BigNumber } from "ethers";

import * as assert from "assert";

chai.use(solidity);

describe("Test of Increase Liquidity & Decrease Liquidity - BOATokenBridge", () => {
    let bridge_contract: BOATokenBridge;
    let token_contract: TestERC20;

    const provider = waffle.provider;
    const [admin, user, manager, fee_manager, liquid_provider] = provider.getWallets();
    const admin_signer = provider.getSigner(admin.address);
    const user_signer = provider.getSigner(user.address);
    const manager_signer = provider.getSigner(manager.address);
    const liquid_provider_signer = provider.getSigner(liquid_provider.address);

    let lock: string;
    let key: string;

    let lock_box_id: string;

    const liquidity_amount = BOAToken(1000000);
    const swap_amount = BOAToken(10000);
    const time_lock = 60 * 60 * 24;

    before(async () => {
        const BOATokenBridgeFactory = await ethers.getContractFactory("BOATokenBridge");
        const TestERC20Factory = await ethers.getContractFactory("TestERC20");

        token_contract = await TestERC20Factory.deploy("BOSAGORA Token", "BOA2");
        await token_contract.deployed();

        bridge_contract = await BOATokenBridgeFactory.deploy(
            token_contract.address,
            time_lock,
            fee_manager.address,
            true
        );
        await bridge_contract.deployed();
    });

    before("Distribute the fund", async () => {
        await token_contract.connect(admin_signer).transfer(liquid_provider.address, liquidity_amount);
        assert.strictEqual((await token_contract.balanceOf(bridge_contract.address)).toNumber(), 0);
    });

    context("Basic Test", async () => {
        it("Increase liquidity", async () => {
            await token_contract.connect(liquid_provider_signer).approve(bridge_contract.address, liquidity_amount);
            await bridge_contract
                .connect(liquid_provider_signer)
                .increaseLiquidity(liquid_provider.address, liquidity_amount);

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(liquid_provider.address);

            assert.strictEqual(liquid_balance.toString(), liquidity_amount.toString());
            assert.strictEqual((await token_contract.balanceOf(liquid_provider.address)).toString(), "0");
        });

        it("Decrease liquidity", async () => {
            await bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(liquidity_amount);

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(liquid_provider.address);

            assert.strictEqual(liquid_balance.toNumber(), 0);
            assert.strictEqual(
                (await token_contract.balanceOf(liquid_provider.address)).toString(),
                liquidity_amount.toString()
            );
        });
    });

    context("Insufficient balance", async () => {
        it("Second increase liquidity", async () => {
            await token_contract.connect(liquid_provider_signer).approve(bridge_contract.address, liquidity_amount);
            await bridge_contract
                .connect(liquid_provider_signer)
                .increaseLiquidity(liquid_provider.address, liquidity_amount);
        });

        it("Add a manager", async () => {
            await bridge_contract.connect(admin_signer).addManager(manager.address);
        });

        it("Create key by User", () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in Luniverse by Manager", async () => {
            expect(
                await bridge_contract
                    .connect(manager_signer)
                    .openWithdraw(lock_box_id, swap_amount, 0, 0, user.address, user.address, lock)
            ).to.emit(bridge_contract, "OpenWithdraw");
        });

        it("Close the lock box in Luniverse by User", async () => {
            expect(await bridge_contract.connect(user_signer).closeWithdraw(lock_box_id, key)).to.emit(
                bridge_contract,
                "CloseWithdraw"
            );
            const user_balance = await token_contract.balanceOf(user.address);
            assert.strictEqual(user_balance.toString(), swap_amount.toString());
            const swapLuniverse_balance = await token_contract.balanceOf(bridge_contract.address);
            assert.strictEqual(swapLuniverse_balance.toString(), liquidity_amount.sub(swap_amount).toString());
        });

        it("Error occurs when the overall liquidity decreases - insufficient balance", async () => {
            await assert.rejects(bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(liquidity_amount));
        });

        it("Decrease some of the liquidity", async () => {
            await bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(liquidity_amount.sub(swap_amount));

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(liquid_provider.address);

            assert.strictEqual(liquid_balance.toString(), swap_amount.toString());
        });
    });
});

describe("Test of Increase Liquidity & Decrease Liquidity - BOACoinBridge", () => {
    let bridge_contract: BOACoinBridge;

    const provider = waffle.provider;
    const [admin, user, manager, fee_manager, liquid_provider] = provider.getWallets();
    const admin_signer = provider.getSigner(admin.address);
    const user_signer = provider.getSigner(user.address);
    const manager_signer = provider.getSigner(manager.address);
    const liquid_provider_signer = provider.getSigner(liquid_provider.address);

    let lock: string;
    let key: string;

    let lock_box_id: string;

    const liquidity_amount = BOACoin(1000000);
    const swap_amount = BOACoin(10000);
    const time_lock = 60 * 60 * 24;

    let old_balance_provider: BigNumber;

    before(async () => {
        const BOATokenBridgeFactory = await ethers.getContractFactory("BOACoinBridge");

        bridge_contract = await BOATokenBridgeFactory.deploy(time_lock, fee_manager.address, true);
        await bridge_contract.deployed();
    });

    before("Distribute the fund", async () => {
        old_balance_provider = await provider.getBalance(liquid_provider.address);
        assert.strictEqual((await provider.getBalance(bridge_contract.address)).toString(), "0");
    });

    context("Basic Test", async () => {
        it("Increase liquidity", async () => {
            await bridge_contract
                .connect(liquid_provider_signer)
                .increaseLiquidity({ from: liquid_provider.address, value: liquidity_amount });

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(liquid_provider.address);

            assert.strictEqual(liquid_balance.toString(), liquidity_amount.toString());
        });

        it("Decrease liquidity", async () => {
            await bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(liquidity_amount);

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(liquid_provider.address);

            assert.strictEqual(liquid_balance.toNumber(), 0);
        });
    });

    context("Insufficient balance", async () => {
        it("Second increase liquidity", async () => {
            await bridge_contract
                .connect(liquid_provider_signer)
                .increaseLiquidity({ from: liquid_provider.address, value: liquidity_amount });
        });

        it("Add a manager", async () => {
            await bridge_contract.connect(admin_signer).addManager(manager.address);
        });

        it("Create key by User", () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in Luniverse by Manager", async () => {
            expect(
                await bridge_contract
                    .connect(manager_signer)
                    .openWithdraw(lock_box_id, swap_amount, 0, 0, user.address, user.address, lock)
            ).to.emit(bridge_contract, "OpenWithdraw");
        });

        it("Close the lock box in Luniverse by User", async () => {
            expect(await bridge_contract.connect(user_signer).closeWithdraw(lock_box_id, key)).to.emit(
                bridge_contract,
                "CloseWithdraw"
            );
            assert.strictEqual(
                (await provider.getBalance(bridge_contract.address)).toString(),
                liquidity_amount.sub(swap_amount).toString()
            );
        });

        it("Error occurs when the overall liquidity decreases - insufficient balance", async () => {
            await assert.rejects(bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(liquidity_amount));
        });

        it("Decrease some of the liquidity", async () => {
            await bridge_contract.connect(liquid_provider_signer).decreaseLiquidity(liquidity_amount.sub(swap_amount));

            const liquid_balance = await bridge_contract
                .connect(liquid_provider_signer)
                .balanceOfLiquidity(liquid_provider.address);

            assert.strictEqual(liquid_balance.toString(), swap_amount.toString());
        });
    });
});
