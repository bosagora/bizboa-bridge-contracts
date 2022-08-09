import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, waffle } from "hardhat";
import { TestToken, TokenBridge } from "../../typechain";
import { Amount } from "../../utils/Amount";
import { ContractUtils } from "../ContractUtils";

import * as assert from "assert";
import { BigNumber } from "ethers";

chai.use(solidity);

describe("Test Swap of TokenBridge", () => {
    const provider = waffle.provider;
    const [admin, manager, other, user_eth, user_biz] = provider.getWallets();
    const admin_signer = provider.getSigner(admin.address);
    const manager_signer = provider.getSigner(manager.address);
    const other_signer = provider.getSigner(other.address);
    const user_eth_signer = provider.getSigner(user_eth.address);
    const user_biz_signer = provider.getSigner(user_biz.address);

    let bridge_ethnet: TokenBridge;
    let bridge_biznet: TokenBridge;
    let token_ethnet: TestToken;
    let token_biznet: TestToken;

    const decimal = 10;
    const liquidity_amount = Amount.make(1000000, decimal);
    const swap_amount = Amount.make(10000, decimal);
    const time_lock = 60 * 60 * 24;
    let txFee = Amount.make(1, 18);

    let token_id_ethnet: string;
    let token_id_biznet: string;

    let lock: string;
    let key: string;
    let lock_box_id: string;

    before(async () => {
        const TokenBridgeFactory = await ethers.getContractFactory("TokenBridge");
        const TestERC20Factory = await ethers.getContractFactory("TestToken");

        token_ethnet = await TestERC20Factory.connect(admin_signer).deploy("TokenA", "TNA", decimal);
        await token_ethnet.deployed();

        token_biznet = await TestERC20Factory.connect(admin_signer).deploy("TokenA", "TNA", decimal);
        await token_biznet.deployed();

        bridge_ethnet = (await TokenBridgeFactory.connect(admin_signer).deploy(time_lock)) as TokenBridge;
        await bridge_ethnet.deployed();

        bridge_biznet = (await TokenBridgeFactory.connect(admin_signer).deploy(time_lock)) as TokenBridge;
        await bridge_biznet.deployed();

        assert.strictEqual(await bridge_ethnet.owner(), admin.address);
        assert.ok(!(await bridge_ethnet.isManager(admin.address)));
    });

    before("Add a manager", async () => {
        await bridge_ethnet.connect(admin_signer).addManager(manager.address);
        assert.ok(await bridge_ethnet.isManager(manager.address));

        await bridge_biznet.connect(admin_signer).addManager(manager.address);
        assert.ok(await bridge_biznet.isManager(manager.address));
    });

    before("Register a token", async () => {
        token_id_ethnet = ContractUtils.BufferToString(
            ContractUtils.getTokenId(bridge_ethnet.address, await token_ethnet.name(), await token_ethnet.symbol())
        );
        expect(
            await bridge_ethnet.connect(manager_signer).registerToken(token_id_ethnet, token_ethnet.address)
        ).to.emit(bridge_ethnet, "TokenRegistered");

        token_id_biznet = ContractUtils.BufferToString(
            ContractUtils.getTokenId(bridge_biznet.address, await token_biznet.name(), await token_biznet.symbol())
        );
        expect(
            await bridge_biznet.connect(manager_signer).registerToken(token_id_biznet, token_biznet.address)
        ).to.emit(bridge_biznet, "TokenRegistered");
    });

    before("Send liquidity", async () => {
        await token_ethnet.connect(admin_signer).transfer(bridge_ethnet.address, liquidity_amount.value);
        await token_biznet.connect(admin_signer).transfer(bridge_biznet.address, liquidity_amount.value);
    });

    context("EthNet: User -> Contract, BizNet : Contract -> User", async () => {
        let old_user_balance_ethnet: BigNumber;
        let old_user_balance_biznet: BigNumber;
        let old_bridge_ethnet_balance: BigNumber;
        let old_bridge_biznet_balance: BigNumber;

        // transaction fee (ETH)
        txFee = Amount.make(0.01, 18);

        before("Distribute the fund", async () => {
            await token_ethnet.connect(admin_signer).transfer(user_eth.address, swap_amount.value);
        });

        it("Check the balance", async () => {
            old_user_balance_ethnet = await token_ethnet.balanceOf(user_eth.address);
            old_user_balance_biznet = await token_biznet.balanceOf(user_biz.address);
            old_bridge_ethnet_balance = await token_ethnet.balanceOf(bridge_ethnet.address);
            old_bridge_biznet_balance = await token_biznet.balanceOf(bridge_biznet.address);
        });

        it("Create key by User", async () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in EthNet by User", async () => {
            await token_ethnet.connect(user_eth_signer).approve(bridge_ethnet.address, swap_amount.value);
            expect(
                await bridge_ethnet
                    .connect(user_eth_signer)
                    .openDeposit(token_id_ethnet, lock_box_id, swap_amount.value, user_biz.address, lock, {
                        value: txFee.value,
                    })
            ).to.emit(bridge_ethnet, "OpenDeposit");
        });

        it("Check the lock box in EthNet", async () => {
            const result = await bridge_ethnet.checkDeposit(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[1].toString(), token_id_ethnet);
            assert.strictEqual(result[3].toString(), swap_amount.toString());
            assert.strictEqual(result[4].toString(), txFee.toString());
            assert.strictEqual(result[5].toString(), user_eth.address);
            assert.strictEqual(result[6].toString(), user_biz.address);
            assert.strictEqual(result[7].toString(), lock);
        });

        it("Open the lock box in BizNet by Manager", async () => {
            expect(
                await bridge_biznet
                    .connect(manager_signer)
                    .openWithdraw(
                        token_id_biznet,
                        lock_box_id,
                        swap_amount.value,
                        user_eth.address,
                        user_biz.address,
                        lock
                    )
            ).to.emit(bridge_biznet, "OpenWithdraw");
        });

        it("Check the lock box in BizNet by User", async () => {
            const result = await bridge_biznet.connect(user_biz_signer).checkWithdraw(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[1].toString(), token_id_biznet);
            assert.strictEqual(result[3].toString(), swap_amount.toString());
            assert.strictEqual(result[4].toString(), user_eth.address);
            assert.strictEqual(result[5].toString(), user_biz.address);
            assert.strictEqual(result[6].toString(), lock);
        });

        it("Close the lock box in BizNet by Manager", async () => {
            expect(await bridge_biznet.connect(manager_signer).closeWithdraw(lock_box_id, key)).to.emit(
                bridge_biznet,
                "CloseWithdraw"
            );
            const user_balance_biznet = await token_biznet.balanceOf(user_biz.address);
            assert.strictEqual(user_balance_biznet.sub(old_user_balance_biznet).toString(), swap_amount.toString());
            const bridge_biznet_balance = await token_biznet.balanceOf(bridge_biznet.address);
            assert.strictEqual(
                bridge_biznet_balance.toString(),
                old_bridge_biznet_balance.sub(swap_amount.value).toString()
            );
        });

        it("Close the lock box in EthNet by Manager", async () => {
            const secretKey = await bridge_biznet.checkSecretKeyWithdraw(lock_box_id);
            expect(await bridge_ethnet.connect(manager_signer).closeDeposit(lock_box_id, secretKey)).to.emit(
                bridge_ethnet,
                "CloseDeposit"
            );
            const bridge_ethnet_balance = await token_ethnet.balanceOf(bridge_ethnet.address);
            assert.strictEqual(
                bridge_ethnet_balance.toString(),
                old_bridge_ethnet_balance.add(swap_amount.value).toString()
            );
        });

        it("Only the manager can open the withdraw lock box", async () => {
            const box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
            await assert.rejects(
                bridge_biznet
                    .connect(user_biz_signer)
                    .openWithdraw(token_id_ethnet, box_id, swap_amount.value, user_eth.address, user_biz.address, lock)
            );
        });
    });

    context("BizNet: User -> Contract, EthNet : Contract -> User", async () => {
        let old_user_balance_ethnet: BigNumber;
        let old_user_balance_biznet: BigNumber;
        let old_bridge_ethnet_balance: BigNumber;
        let old_bridge_biznet_balance: BigNumber;

        // transaction fee (BOA)
        txFee = Amount.make(300, 18);

        before("Distribute the fund", async () => {
            // await token_biznet.connect(admin_signer).transfer(user.address, swap_amount_token);
        });

        it("Check the balance", async () => {
            old_user_balance_ethnet = await token_ethnet.balanceOf(user_eth.address);
            old_user_balance_biznet = await token_biznet.balanceOf(user_biz.address);
            old_bridge_ethnet_balance = await token_ethnet.balanceOf(bridge_ethnet.address);
            old_bridge_biznet_balance = await token_biznet.balanceOf(bridge_biznet.address);
        });

        it("Create key by User", () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in BizNet by User", async () => {
            await token_biznet.connect(user_biz_signer).approve(bridge_biznet.address, swap_amount.value);
            expect(
                await bridge_biznet
                    .connect(user_biz_signer)
                    .openDeposit(token_id_biznet, lock_box_id, swap_amount.value, user_eth.address, lock, {
                        value: txFee.value,
                    })
            ).to.emit(bridge_biznet, "OpenDeposit");
        });

        it("Check the lock box in BizNet by Manager", async () => {
            const result = await bridge_biznet.checkDeposit(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[1].toString(), token_id_biznet);
            assert.strictEqual(result[3].toString(), swap_amount.toString());
            assert.strictEqual(result[4].toString(), txFee.toString());
            assert.strictEqual(result[5].toString(), user_biz.address);
            assert.strictEqual(result[6].toString(), user_eth.address);
            assert.strictEqual(result[7].toString(), lock);
        });

        it("Open the lock box in EthNet by Manager", async () => {
            expect(
                await bridge_ethnet
                    .connect(manager_signer)
                    .openWithdraw(
                        token_id_ethnet,
                        lock_box_id,
                        swap_amount.value,
                        user_biz.address,
                        user_eth.address,
                        lock
                    )
            ).to.emit(bridge_ethnet, "OpenWithdraw");
        });

        it("Check the lock box in BizNet by User", async () => {
            const result = await bridge_ethnet.connect(user_eth_signer).checkWithdraw(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[1].toString(), token_id_ethnet);
            assert.strictEqual(result[3].toString(), swap_amount.toString());
            assert.strictEqual(result[4].toString(), user_biz.address);
            assert.strictEqual(result[5].toString(), user_eth.address);
            assert.strictEqual(result[6].toString(), lock);
        });

        it("Close the lock box in EthNet by Manager", async () => {
            expect(await bridge_ethnet.connect(manager_signer).closeWithdraw(lock_box_id, key)).to.emit(
                bridge_ethnet,
                "CloseWithdraw"
            );
            const new_user_balance_ethnet = await token_ethnet.balanceOf(user_eth.address);
            assert.strictEqual(new_user_balance_ethnet.sub(old_user_balance_ethnet).toString(), swap_amount.toString());
            const bridge_ethnet_balance = await token_ethnet.balanceOf(bridge_ethnet.address);
            assert.strictEqual(
                bridge_ethnet_balance.toString(),
                old_bridge_ethnet_balance.sub(swap_amount.value).toString()
            );
        });

        it("Close the lock box in BizNet by Manager", async () => {
            const secretKey = await bridge_ethnet.checkSecretKeyWithdraw(lock_box_id);
            expect(await bridge_biznet.connect(manager_signer).closeDeposit(lock_box_id, secretKey)).to.emit(
                bridge_biznet,
                "CloseDeposit"
            );
            const bridge_biznet_balance = await token_biznet.balanceOf(bridge_biznet.address);
            assert.strictEqual(
                bridge_biznet_balance.toString(),
                old_bridge_biznet_balance.add(swap_amount.value).toString()
            );
        });
    });

    context("Test the stop function of the swap", async () => {
        // transaction fee
        txFee = Amount.make(300, 18);

        it("Create key by User", async () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Inactive swap in EthNet", async () => {
            await bridge_ethnet.connect(manager_signer).setActive(false);
            assert.strictEqual(await bridge_ethnet.connect(manager_signer).active(), false);
        });

        it("Open the lock box in EthNet", async () => {
            await token_ethnet.connect(user_eth_signer).approve(bridge_ethnet.address, swap_amount.value);
            await expect(
                bridge_ethnet
                    .connect(user_eth_signer)
                    .openDeposit(token_id_ethnet, lock_box_id, swap_amount.value, user_biz.address, lock, {
                        value: txFee.value,
                    })
            ).to.be.reverted;
        });

        it("Active swap in EthNet", async () => {
            await bridge_ethnet.connect(manager_signer).setActive(true);
            assert.strictEqual(await bridge_ethnet.connect(manager_signer).active(), true);
        });

        it("Inactive swap in BizNet", async () => {
            await bridge_biznet.connect(manager_signer).setActive(false);
            assert.strictEqual(await bridge_biznet.connect(manager_signer).active(), false);
        });

        it("Open the lock box in BizNet", async () => {
            await token_biznet.connect(user_biz_signer).approve(bridge_biznet.address, swap_amount.value);
            await expect(
                bridge_biznet
                    .connect(user_biz_signer)
                    .openDeposit(token_id_biznet, lock_box_id, swap_amount.value, user_eth.address, lock, {
                        value: txFee.value,
                    })
            ).to.be.reverted;
        });

        it("Active swap in BizNet", async () => {
            await bridge_biznet.connect(manager_signer).setActive(true);
            assert.strictEqual(await bridge_biznet.connect(manager_signer).active(), true);
        });
    });

    context("Expiry Deposit Lock Box", async () => {
        const lockBox_expiry = ContractUtils.BufferToString(ContractUtils.createLockBoxID());

        before("Distribute the fund", async () => {
            await token_ethnet.connect(admin_signer).transfer(user_eth.address, swap_amount.value);
        });

        before("Set time lock", async () => {
            const timeout = 1;
            await bridge_ethnet.connect(manager_signer).changeTimeLock(timeout);
            assert.strictEqual((await bridge_ethnet.depositTimeLock()).toString(), (timeout * 2).toString());
            assert.strictEqual((await bridge_ethnet.withdrawTimeLock()).toString(), timeout.toString());
        });

        it("Open Deposit Lock Box", async () => {
            await token_ethnet.connect(user_eth_signer).approve(bridge_ethnet.address, swap_amount.value);
            await bridge_ethnet
                .connect(user_eth_signer)
                .openDeposit(token_id_ethnet, lockBox_expiry, swap_amount.value, user_biz.address, lock, {
                    value: txFee.value,
                });
        });

        it("No Expiry", async () => {
            await assert.rejects(bridge_ethnet.connect(user_eth_signer).expireDeposit(lockBox_expiry));
        });

        it("Expiry", async () => {
            await new Promise<void>((resolve, reject) =>
                setTimeout(async () => {
                    try {
                        await bridge_ethnet.connect(user_eth_signer).expireDeposit(lockBox_expiry);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }, 2 * 1000)
            );
        });
    });

    context("Expiry Withdraw Lock Box", async () => {
        const lockBox_expiry = ContractUtils.BufferToString(ContractUtils.createLockBoxID());

        before("Distribute the fund", async () => {
            await token_ethnet.connect(admin_signer).transfer(user_eth.address, swap_amount.value);
        });

        before("Set time lock", async () => {
            const timeout = 2;
            await bridge_ethnet.connect(manager_signer).changeTimeLock(timeout);
        });

        it("Open Withdraw Lock Box", async () => {
            await bridge_ethnet
                .connect(manager_signer)
                .openWithdraw(
                    token_id_ethnet,
                    lockBox_expiry,
                    swap_amount.value,
                    user_eth.address,
                    user_biz.address,
                    lock
                );
        });

        it("No Expiry", async () => {
            await assert.rejects(bridge_ethnet.connect(manager_signer).expireWithdraw(lockBox_expiry));
        });

        it("Expiry", async () => {
            return new Promise<void>((resolve, reject) =>
                setTimeout(async () => {
                    try {
                        await bridge_ethnet.connect(manager_signer).expireWithdraw(lockBox_expiry);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }, 2 * 1000)
            );
        });
    });
});
