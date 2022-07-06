import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers, waffle } from "hardhat";
import { BOACoinBridge, BOATokenBridge, TestERC20 } from "../../typechain";
import { BOAToken, ContractUtils, convertBOAToken2Coin } from "../ContractUtils";

import * as assert from "assert";

chai.use(solidity);

describe("Cross Chain HTLC Atomic Swap with ERC20", () => {
    let bridge_ethnet: BOATokenBridge;
    let token_ethnet: TestERC20;
    let bridge_biznet: BOACoinBridge;

    const provider = waffle.provider;
    const [admin, thief, manager, fee_manager, user_eth, user_biz, new_fee_manager] = provider.getWallets();
    const admin_signer = provider.getSigner(admin.address);
    const thief_signer = provider.getSigner(thief.address);
    const user_eth_signer = provider.getSigner(user_eth.address);
    const user_biz_signer = provider.getSigner(user_biz.address);
    const manager_signer = provider.getSigner(manager.address);

    let lock: string;
    let key: string;

    let lock_box_id: string;

    const liquidity_amount_token = BOAToken(1000000);
    const swap_amount_token = BOAToken(10000);
    const time_lock = 60 * 60 * 24;

    const swap_fee_token = BOAToken(100);
    const tx_fee_token = BOAToken(200);
    const total_fee_token = swap_fee_token.add(tx_fee_token);

    const liquidity_amount_coin = convertBOAToken2Coin(liquidity_amount_token);
    const swap_amount_coin = convertBOAToken2Coin(swap_amount_token);
    const swap_fee_coin = convertBOAToken2Coin(swap_fee_token);
    const tx_fee_coin = convertBOAToken2Coin(tx_fee_token);
    const total_fee_coin = convertBOAToken2Coin(total_fee_token);

    before(async () => {
        const BOACoinBridgeFactory = await ethers.getContractFactory("BOACoinBridge");
        const BOATokenBridgeFactory = await ethers.getContractFactory("BOATokenBridge");
        const TestERC20Factory = await ethers.getContractFactory("TestERC20");

        token_ethnet = await TestERC20Factory.connect(admin_signer).deploy("BOSAGORA Token", "BOA1");
        await token_ethnet.deployed();

        bridge_ethnet = (await BOATokenBridgeFactory.connect(admin_signer).deploy(
            token_ethnet.address,
            time_lock,
            fee_manager.address,
            true // 수수료는 이더넷의 브리지에서만 모아집니다.
        )) as BOATokenBridge;
        await bridge_ethnet.deployed();

        bridge_biznet = (await BOACoinBridgeFactory.connect(admin_signer).deploy(
            time_lock,
            fee_manager.address,
            false
        )) as BOACoinBridge;
        await bridge_biznet.deployed();

        assert.strictEqual(await bridge_ethnet.owner(), admin.address);
        assert.strictEqual(await bridge_biznet.owner(), admin.address);
        assert.ok(await bridge_ethnet.isOwner(admin.address));
        assert.ok(await bridge_biznet.isOwner(admin.address));
        assert.ok(!(await bridge_ethnet.isOwner(manager.address)));
        assert.ok(!(await bridge_biznet.isOwner(manager.address)));
        assert.ok(!(await bridge_ethnet.isManager(admin.address)));
        assert.ok(!(await bridge_ethnet.isManager(admin.address)));
    });

    before("Send liquidity", async () => {
        await token_ethnet.connect(admin_signer).approve(bridge_ethnet.address, liquidity_amount_token);
        await bridge_ethnet.connect(admin_signer).increaseLiquidity(admin.address, liquidity_amount_token);
        await bridge_biznet
            .connect(admin_signer)
            .increaseLiquidity({ from: admin.address, value: liquidity_amount_coin });
    });

    before("Add a manager", async () => {
        await bridge_ethnet.connect(admin_signer).addManager(manager.address);
        await bridge_biznet.connect(admin_signer).addManager(manager.address);
        assert.ok(await bridge_ethnet.isManager(manager.address));
        assert.ok(await bridge_ethnet.isManager(manager.address));
    });

    context("EthNet: User -> Contract, BizNet : Contract -> User", async () => {
        let old_user_balance_ethnet: BigNumber;
        let old_user_balance_biznet: BigNumber;
        let old_bridge_ethnet_balance: BigNumber;
        let old_bridge_biznet_balance: BigNumber;

        before("Distribute the fund", async () => {
            await token_ethnet.connect(admin_signer).transfer(user_eth.address, swap_amount_token);
        });

        it("Check the balance", async () => {
            old_user_balance_ethnet = await token_ethnet.balanceOf(user_eth.address);
            old_user_balance_biznet = await provider.getBalance(user_biz.address);
            old_bridge_ethnet_balance = await token_ethnet.balanceOf(bridge_ethnet.address);
            old_bridge_biznet_balance = await provider.getBalance(bridge_biznet.address);
        });

        it("Create key by User", async () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in EthNet by User", async () => {
            await token_ethnet.connect(user_eth_signer).approve(bridge_ethnet.address, swap_amount_token);
            expect(
                await bridge_ethnet
                    .connect(user_eth_signer)
                    .openDeposit(lock_box_id, swap_amount_token, swap_fee_token, tx_fee_token, user_biz.address, lock)
            ).to.emit(bridge_ethnet, "OpenDeposit");
        });

        it("Check the lock box in EthNet by Manager", async () => {
            const result = await bridge_ethnet.checkDeposit(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toString(), swap_amount_token.toString());
            assert.strictEqual(result[3].toString(), swap_fee_token.toString());
            assert.strictEqual(result[4].toString(), tx_fee_token.toString());
            assert.strictEqual(result[5].toString(), user_eth.address);
            assert.strictEqual(result[6].toString(), user_biz.address);
            assert.strictEqual(result[7].toString(), lock);
        });

        it("Open the lock box in BizNet by Manager", async () => {
            expect(
                await bridge_biznet
                    .connect(manager_signer)
                    .openWithdraw(
                        lock_box_id,
                        swap_amount_coin,
                        swap_fee_coin,
                        tx_fee_coin,
                        user_eth.address,
                        user_biz.address,
                        lock
                    )
            ).to.emit(bridge_biznet, "OpenWithdraw");
        });

        it("Check the lock box in BizNet by User", async () => {
            const result = await bridge_biznet.connect(user_biz_signer).checkWithdraw(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toString(), swap_amount_coin.toString());
            assert.strictEqual(result[3].toString(), swap_fee_coin.toString());
            assert.strictEqual(result[4].toString(), tx_fee_coin.toString());
            assert.strictEqual(result[5].toString(), user_eth.address);
            assert.strictEqual(result[6].toString(), user_biz.address);
            assert.strictEqual(result[7].toString(), lock);
        });

        it("Close the lock box in BizNet by Manager", async () => {
            expect(await bridge_biznet.connect(manager_signer).closeWithdraw(lock_box_id, key)).to.emit(
                bridge_biznet,
                "CloseWithdraw"
            );
            const user_balance_biznet = await provider.getBalance(user_biz.address);
            assert.strictEqual(
                user_balance_biznet.sub(old_user_balance_biznet).toString(),
                swap_amount_coin.sub(total_fee_coin).toString()
            );
            const bridge_biznet_balance = await provider.getBalance(bridge_biznet.address);
            assert.strictEqual(
                bridge_biznet_balance.toString(),
                old_bridge_biznet_balance.sub(swap_amount_coin).add(total_fee_coin).toString()
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
                old_bridge_ethnet_balance.add(swap_amount_token).toString()
            );
        });

        it("Only the manager can open the withdraw lock box", async () => {
            const box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
            await assert.rejects(
                bridge_biznet
                    .connect(user_biz_signer)
                    .openWithdraw(box_id, swap_amount_token, 0, 0, user_eth.address, user_biz.address, lock)
            );
        });

        it("Transaction is rejected if the fee is insufficient", async () => {
            await token_ethnet.connect(user_eth_signer).approve(bridge_ethnet.address, swap_amount_token);
            await expect(
                bridge_ethnet
                    .connect(user_eth_signer)
                    .openDeposit(
                        ContractUtils.BufferToString(ContractUtils.createLockBoxID()),
                        swap_amount_token,
                        swap_amount_token,
                        tx_fee_token,
                        user_biz.address,
                        lock
                    )
            ).to.be.reverted;
        });

        // 수수료는 이더넷의 브리지에서만 모아집니다.
        it("Check the liquidity balance of manager", async () => {
            expect(await bridge_ethnet.balanceOfLiquidity(fee_manager.address)).to.eq(total_fee_token);
            expect(await bridge_biznet.balanceOfLiquidity(fee_manager.address)).to.eq(BOAToken(0));
        });
    });

    context("BizNet: User -> Contract, EthNet : Contract -> User", async () => {
        let old_user_balance_ethnet: BigNumber;
        let old_user_balance_biznet: BigNumber;
        let old_bridge_ethnet_balance: BigNumber;
        let old_bridge_biznet_balance: BigNumber;

        before("Distribute the fund", async () => {
            // await token_biznet.connect(admin_signer).transfer(user.address, swap_amount_token);
        });

        it("Check the balance", async () => {
            old_user_balance_ethnet = await token_ethnet.balanceOf(user_eth.address);
            old_user_balance_biznet = await user_biz.getBalance();
            old_bridge_ethnet_balance = await token_ethnet.balanceOf(bridge_ethnet.address);
            old_bridge_biznet_balance = await provider.getBalance(bridge_biznet.address);
        });

        it("Create key by User", () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Open the lock box in BizNet by User", async () => {
            expect(
                await bridge_biznet
                    .connect(user_biz_signer)
                    .openDeposit(lock_box_id, swap_fee_coin, tx_fee_coin, user_eth.address, lock, {
                        from: user_biz.address,
                        value: swap_amount_coin,
                    })
            ).to.emit(bridge_biznet, "OpenDeposit");
        });

        it("Check the lock box in BizNet by Manager", async () => {
            const result = await bridge_biznet.checkDeposit(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toString(), swap_amount_coin.toString());
            assert.strictEqual(result[3].toString(), swap_fee_coin.toString());
            assert.strictEqual(result[4].toString(), tx_fee_coin.toString());
            assert.strictEqual(result[5].toString(), user_biz.address);
            assert.strictEqual(result[6].toString(), user_eth.address);
            assert.strictEqual(result[7].toString(), lock);
        });

        it("Open the lock box in EthNet by Manager", async () => {
            expect(
                await bridge_ethnet
                    .connect(manager_signer)
                    .openWithdraw(
                        lock_box_id,
                        swap_amount_token,
                        swap_fee_token,
                        tx_fee_token,
                        user_biz.address,
                        user_eth.address,
                        lock
                    )
            ).to.emit(bridge_ethnet, "OpenWithdraw");
        });

        it("Check the lock box in BizNet by User", async () => {
            const result = await bridge_ethnet.connect(user_eth_signer).checkWithdraw(lock_box_id);
            assert.strictEqual(result[0].toString(), "1");
            assert.strictEqual(result[2].toString(), swap_amount_token.toString());
            assert.strictEqual(result[3].toString(), swap_fee_token.toString());
            assert.strictEqual(result[4].toString(), tx_fee_token.toString());
            assert.strictEqual(result[5].toString(), user_biz.address);
            assert.strictEqual(result[6].toString(), user_eth.address);
            assert.strictEqual(result[7].toString(), lock);
        });

        it("Close the lock box in EthNet by Manager", async () => {
            expect(await bridge_ethnet.connect(manager_signer).closeWithdraw(lock_box_id, key)).to.emit(
                bridge_ethnet,
                "CloseWithdraw"
            );
            const new_user_balance_ethnet = await token_ethnet.balanceOf(user_eth.address);
            assert.strictEqual(
                new_user_balance_ethnet.sub(old_user_balance_ethnet).toString(),
                swap_amount_token.sub(total_fee_token).toString()
            );
            const bridge_ethnet_balance = await token_ethnet.balanceOf(bridge_ethnet.address);
            assert.strictEqual(
                bridge_ethnet_balance.toString(),
                old_bridge_ethnet_balance.sub(swap_amount_token).add(total_fee_token).toString()
            );
        });

        it("Close the lock box in BizNet by Manager", async () => {
            const secretKey = await bridge_ethnet.checkSecretKeyWithdraw(lock_box_id);
            expect(await bridge_biznet.connect(manager_signer).closeDeposit(lock_box_id, secretKey)).to.emit(
                bridge_biznet,
                "CloseDeposit"
            );
            const bridge_biznet_balance = await provider.getBalance(bridge_biznet.address);
            assert.strictEqual(
                bridge_biznet_balance.toString(),
                old_bridge_biznet_balance.add(swap_amount_coin).toString()
            );
        });

        // 수수료는 이더넷의 브리지에서만 모아집니다.
        it("Check the liquidity balance of manager", async () => {
            expect(await bridge_ethnet.balanceOfLiquidity(fee_manager.address)).to.eq(total_fee_token.mul(2));
            expect(await bridge_biznet.balanceOfLiquidity(fee_manager.address)).to.eq(BOAToken(0));
        });
    });

    context("Test the stop function of the swap", async () => {
        it("Create key by User", async () => {
            const key_buffer = ContractUtils.createKey();
            const lock_buffer = ContractUtils.sha256(key_buffer);
            key = ContractUtils.BufferToString(key_buffer);
            lock = ContractUtils.BufferToString(lock_buffer);
            lock_box_id = ContractUtils.BufferToString(ContractUtils.createLockBoxID());
        });

        it("Inactive swap in EthNet", async () => {
            await bridge_ethnet.connect(manager_signer).setActive(false);
            assert.strictEqual(await bridge_ethnet.connect(manager_signer).getActive(), false);
        });

        it("Open the lock box in EthNet", async () => {
            await token_ethnet.connect(user_eth_signer).approve(bridge_ethnet.address, swap_amount_token);
            await expect(
                bridge_ethnet
                    .connect(user_eth_signer)
                    .openDeposit(lock_box_id, swap_amount_token, swap_fee_token, tx_fee_token, user_biz.address, lock)
            ).to.be.reverted;
        });

        it("Active swap in EthNet", async () => {
            await bridge_ethnet.connect(manager_signer).setActive(true);
            assert.strictEqual(await bridge_ethnet.connect(manager_signer).getActive(), true);
        });

        it("Inactive swap in BizNet", async () => {
            await bridge_biznet.connect(manager_signer).setActive(false);
            assert.strictEqual(await bridge_biznet.connect(manager_signer).getActive(), false);
        });

        it("Open the lock box in BizNet", async () => {
            await expect(
                bridge_biznet
                    .connect(user_biz_signer)
                    .openDeposit(lock_box_id, swap_fee_coin, tx_fee_coin, user_eth.address, lock, {
                        from: user_biz.address,
                        value: swap_amount_coin,
                    })
            ).to.be.reverted;
        });

        it("Active swap in BizNet", async () => {
            await bridge_biznet.connect(manager_signer).setActive(true);
            assert.strictEqual(await bridge_biznet.connect(manager_signer).getActive(), true);
        });
    });

    context("Expiry Deposit Lock Box", async () => {
        const lockBox_expiry = ContractUtils.BufferToString(ContractUtils.createLockBoxID());

        before("Distribute the fund", async () => {
            await token_ethnet.connect(admin_signer).transfer(user_eth.address, swap_amount_token);
        });

        before("Set time lock", async () => {
            const timeout = 1;
            await bridge_ethnet.connect(manager_signer).changeTimeLock(timeout);
        });

        it("Open Deposit Lock Box", async () => {
            await token_ethnet.connect(user_eth_signer).approve(bridge_ethnet.address, swap_amount_token);
            await bridge_ethnet
                .connect(user_eth_signer)
                .openDeposit(lockBox_expiry, swap_amount_token, 0, 0, user_biz.address, lock);
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
            await token_ethnet.connect(admin_signer).transfer(user_eth.address, swap_amount_token);
        });

        before("Set time lock", async () => {
            const timeout = 2;
            await bridge_ethnet.connect(manager_signer).changeTimeLock(timeout);
        });

        it("Open Withdraw Lock Box", async () => {
            await bridge_ethnet
                .connect(manager_signer)
                .openWithdraw(lockBox_expiry, swap_amount_token, 0, 0, user_eth.address, user_biz.address, lock);
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

    context("ETC...", async () => {
        it("Test of FeeManager change", async () => {
            await expect(bridge_ethnet.connect(thief_signer).setFeeManager(thief.address)).to.be.reverted;
            await expect(bridge_ethnet.connect(admin_signer).setFeeManager(new_fee_manager.address)).to.emit(
                bridge_ethnet,
                "ChangeFeeManager"
            );

            expect(await bridge_ethnet.balanceOfLiquidity(new_fee_manager.address)).to.eq(total_fee_token.mul(2));
            expect(await bridge_ethnet.balanceOfLiquidity(fee_manager.address)).to.eq(BOAToken(0));
        });
    });
});
