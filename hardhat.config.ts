import * as dotenv from "dotenv";

// tslint:disable-next-line:no-submodule-imports
import { HardhatUserConfig, task } from "hardhat/config";
// tslint:disable-next-line:no-submodule-imports
import { HardhatNetworkAccountUserConfig } from "hardhat/types/config";

import { utils, Wallet } from "ethers";

import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config({ path: "env/.env" });

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (const account of accounts) {
        console.log(account.address);
    }
});

function getAccounts() {
    const accounts: HardhatNetworkAccountUserConfig[] = [];
    const defaultBalance = utils.parseEther("2000000").toString();

    const n = 10;
    for (let i = 0; i < n; ++i) {
        accounts.push({
            privateKey: Wallet.createRandom().privateKey,
            balance: defaultBalance,
        });
    }
    accounts[0].privateKey =
        process.env.ADMIN_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    accounts[1].privateKey =
        process.env.MANAGER_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    accounts[2].privateKey =
        process.env.USER_KEY || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
    accounts[3].privateKey =
        process.env.FEE_MANAGER_KEY || "bdc8808cb44151d6cf9814c728e9584c34fffc0344ab0c1d0b7c434cb7b54b7b";

    return accounts;
}

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.4.24",
            },
            {
                version: "0.5.0",
            },
            {
                version: "0.8.0",
            },
        ],
    },
    networks: {
        hardhat: {
            accounts: getAccounts(),
        },
        ropsten: {
            url: process.env.ROPSTEN_URL || "",
            chainId: 3,
            accounts: [process.env.ADMIN_KEY || "", process.env.MANAGER_KEY || "", process.env.USER_KEY || ""],
            gas: 2100000,
            gasPrice: 8000000000,
        },
        rinkeby: {
            url: process.env.RINKEBY_URL || "",
            chainId: 4,
            accounts: [process.env.ADMIN_KEY || "", process.env.MANAGER_KEY || "", process.env.USER_KEY || ""],
            gas: 2100000,
            gasPrice: 8000000000,
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "USD",
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
};

export default config;
