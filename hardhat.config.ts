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

// If not defined, randomly generated.
function createPrivateKey() {
    const reg_bytes64: RegExp = /^(0x)[0-9a-f]{64}$/i;
    const reg_bytes40: RegExp = /^(0x)[0-9a-f]{40}$/i;
    if (
        process.env.ADMIN_KEY === undefined ||
        process.env.ADMIN_KEY.trim() === "" ||
        !reg_bytes64.test(process.env.ADMIN_KEY)
    ) {
        console.log("환경 변수에 `ADMIN_KEY` 이 존재하지 않아서 무작위로 생성합니다.");
        process.env.ADMIN_KEY = Wallet.createRandom().privateKey;
    }
    if (
        process.env.MANAGER_KEY === undefined ||
        process.env.MANAGER_KEY.trim() === "" ||
        !reg_bytes64.test(process.env.MANAGER_KEY)
    ) {
        console.log("환경 변수에 `MANAGER_KEY` 이 존재하지 않아서 무작위로 생성합니다.");
        process.env.MANAGER_KEY = Wallet.createRandom().privateKey;
    }
    if (
        process.env.USER_KEY === undefined ||
        process.env.USER_KEY.trim() === "" ||
        !reg_bytes64.test(process.env.USER_KEY)
    ) {
        console.log("환경 변수에 `USER_KEY` 이 존재하지 않아서 무작위로 생성합니다.");
        process.env.USER_KEY = Wallet.createRandom().privateKey;
    }
    if (
        process.env.FEE_MANAGER_ADDRESS === undefined ||
        process.env.FEE_MANAGER_ADDRESS.trim() === "" ||
        !reg_bytes40.test(process.env.FEE_MANAGER_ADDRESS)
    ) {
        console.log("환경 변수에 `FEE_MANAGER_ADDRESS` 이 존재하지 않아서 무작위로 생성합니다.");
        process.env.FEE_MANAGER_ADDRESS = Wallet.createRandom().address;
    }
}
createPrivateKey();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (const account of accounts) {
        console.log(account.address);
    }
});

function getAccounts() {
    const accounts = [process.env.ADMIN_KEY || "", process.env.MANAGER_KEY || "", process.env.USER_KEY || ""];
    const n = 10;
    for (let i = 2; i < n; ++i) {
        accounts.push(Wallet.createRandom().privateKey);
    }
    return accounts;
}

function getTestAccounts() {
    const accounts: HardhatNetworkAccountUserConfig[] = [];
    const defaultBalance = utils.parseEther("2000000").toString();

    const n = 10;
    for (let i = 0; i < n; ++i) {
        accounts.push({
            privateKey: Wallet.createRandom().privateKey,
            balance: defaultBalance,
        });
    }
    return accounts;
}

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.8.0",
            },
        ],
    },
    networks: {
        hardhat: {
            accounts: getTestAccounts(),
        },
        ropsten: {
            url: process.env.ROPSTEN_URL || "",
            chainId: 3,
            accounts: getAccounts(),
            gas: 2100000,
            gasPrice: 8000000000,
        },
        rinkeby: {
            url: process.env.RINKEBY_URL || "",
            chainId: 4,
            accounts: getAccounts(),
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
