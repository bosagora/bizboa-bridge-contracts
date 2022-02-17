import crypto from "crypto";

export function createKey(): Buffer {
    return crypto.randomBytes(32);
}

export function sha256(data: Buffer): Buffer {
    return crypto.createHash("sha256").update(data).digest();
}

export function StringToBuffer(hex: string): Buffer {
    const start = hex.substring(0, 2) === "0x" ? 2 : 0;
    return Buffer.from(hex.substring(start), "hex");
}

export function BufferToString(data: Buffer): string {
    return "0x" + data.toString("hex");
}

export function createLockBoxID(): Buffer {
    const baseTimestamp = new Date(2020, 0, 1).getTime();
    const nowTimestamp = new Date().getTime();
    const value = Math.floor((nowTimestamp - baseTimestamp) / 1000);
    const timestamp_buffer = Buffer.alloc(4);
    timestamp_buffer.writeUInt32BE(value, 0);
    return Buffer.concat([timestamp_buffer, crypto.randomBytes(28)]);
}
