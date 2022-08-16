/**
 *  Includes various useful functions for the solidity
 *
 *  Copyright:
 *      Copyright (c) 2022 BOSAGORA Foundation All rights reserved.
 *
 *  License:
 *       MIT License. See LICENSE for details.
 */

import crypto from "crypto";
import { BigNumber } from "ethers";
import { ERC20 } from "../typechain";

export class ContractUtils {
    /**
     * It generates 32-bytes random data.
     */
    public static createKey(): Buffer {
        return crypto.randomBytes(32);
    }

    /**
     * It generates hash values.
     * @param data The source data
     */
    public static sha256(data: Buffer): Buffer {
        return crypto.createHash("sha256").update(data).digest();
    }

    /**
     * It generates hash values.
     * @param address
     * @param name
     * @param symbol
     */
    public static getTokenId(address: string, name: string, symbol: string): Buffer {
        return crypto
            .createHash("sha256")
            .update(ContractUtils.StringToBuffer(address))
            .update(Buffer.from(name))
            .update(Buffer.from(symbol))
            .digest();
    }

    /**
     * Convert hexadecimal strings into Buffer.
     * @param hex The hexadecimal string
     */
    public static StringToBuffer(hex: string): Buffer {
        const start = hex.substring(0, 2) === "0x" ? 2 : 0;
        return Buffer.from(hex.substring(start), "hex");
    }

    /**
     * Convert Buffer into hexadecimal strings.
     * @param data The data
     */
    public static BufferToString(data: Buffer): string {
        return "0x" + data.toString("hex");
    }

    /**
     * Create the ID of lock box
     */
    public static createLockBoxID(): Buffer {
        const baseTimestamp = new Date(2020, 0, 1).getTime();
        const nowTimestamp = new Date().getTime();
        const value = Math.floor((nowTimestamp - baseTimestamp) / 1000);
        const timestamp_buffer = Buffer.alloc(4);
        timestamp_buffer.writeUInt32BE(value, 0);
        return Buffer.concat([timestamp_buffer, crypto.randomBytes(28)]);
    }

    /**
     * Get epoch Unix Timestamp
     */
    public static getTimeStamp(): number {
        return Math.floor(new Date().getTime() / 1000);
    }

    /**
     * Wait until "ERC20.approve" is completed. When a timeout occurs, call reject().
     * @param token     The contract of token
     * @param owner     The address of owner
     * @param spender   The address of spender
     * @param amount    The amount
     * @param timeout   The timeout (unit is second), default is 5 minutes
     */
    public static waitingForAllowance(
        token: ERC20,
        owner: string,
        spender: string,
        amount: BigNumber,
        timeout: number = 300
    ): Promise<BigNumber> {
        return new Promise<BigNumber>(async (resolve, reject) => {
            const start = ContractUtils.getTimeStamp();
            const check = async () => {
                const allowance_amount = await token.allowance(owner, spender);
                if (allowance_amount.gte(amount)) {
                    resolve(allowance_amount);
                } else {
                    const now = ContractUtils.getTimeStamp();
                    if (now - start < timeout) setTimeout(check, 1000);
                    else reject(new Error("A timeout occurred."));
                }
            };
            await check();
        });
    }
}

/**
 * Convert the amount of BOA units with seven decimal points into `BigNumber` with internal data.
 * @param value The monetary amount to be converted
 */
export function BOAToken(value: string | number): BigNumber {
    const LENGTH_DECIMAL: number = 7;
    const ZeroString = "0000000";
    const amount = value.toString();
    if (amount === "") return BigNumber.from("0");
    const numbers = amount.replace(/[,_]/gi, "").split(".");
    if (numbers.length === 1) return BigNumber.from(numbers[0] + ZeroString);
    let tx_decimal = numbers[1];
    if (tx_decimal.length > LENGTH_DECIMAL) tx_decimal = tx_decimal.slice(0, LENGTH_DECIMAL);
    else if (tx_decimal.length < LENGTH_DECIMAL) tx_decimal = tx_decimal.padEnd(LENGTH_DECIMAL, "0");
    const integral = BigNumber.from(numbers[0] + ZeroString);
    return integral.add(BigNumber.from(tx_decimal));
}

/**
 * Convert the amount of BOA units with seven decimal points into `BigNumber` with internal data.
 * @param value The monetary amount to be converted
 */
export function BOACoin(value: string | number): BigNumber {
    const LENGTH_DECIMAL: number = 18;
    const ZeroString = "000000000000000000";
    const amount = value.toString();
    if (amount === "") return BigNumber.from("0");
    const numbers = amount.replace(/[,_]/gi, "").split(".");
    if (numbers.length === 1) return BigNumber.from(numbers[0] + ZeroString);
    let tx_decimal = numbers[1];
    if (tx_decimal.length > LENGTH_DECIMAL) tx_decimal = tx_decimal.slice(0, LENGTH_DECIMAL);
    else if (tx_decimal.length < LENGTH_DECIMAL) tx_decimal = tx_decimal.padEnd(LENGTH_DECIMAL, "0");
    const integral = BigNumber.from(numbers[0] + ZeroString);
    return integral.add(BigNumber.from(tx_decimal));
}

export function convertBOACoin2Token(value: BigNumber): BigNumber {
    const factor = BigNumber.from("100000000000");
    return value.div(factor);
}

export function convertBOAToken2Coin(value: BigNumber): BigNumber {
    const factor = BigNumber.from("100000000000");
    return value.mul(factor);
}
