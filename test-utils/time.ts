import { utils } from "ethers";
import { Block } from "@ethersproject/abstract-provider";
import { BigNumberish } from "@ethersproject/bignumber";
import { BN } from "./math";
import { ONE_WEEK } from "./constants";

export const advanceBlock = async (blocks?: BN | number): Promise<void> => {
    const {provider} = (global.hre?.ethers || require('hardhat').ethers);
    if (blocks === undefined) {
        await provider.send("evm_mine", []);
    } else {
        await provider.send("hardhat_mine", [utils.hexlify(blocks)]);
        // work around for issue [hardhat_mine produces a failed tx when running in Coverage](https://github.com/NomicFoundation/hardhat/issues/2467)
        await provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
    }
};

export const increaseTime = async (length: BN | number): Promise<void> => {
    const {provider} = (global.hre?.ethers || require('hardhat').ethers);
    await provider.send("evm_increaseTime", [BN.from(length).toNumber()]);
    await advanceBlock();
};
export const latestBlock = async (): Promise<Block> => {
    const {provider} = (global.hre?.ethers || require('hardhat').ethers);
    return provider.getBlock(await provider.getBlockNumber())
};

export const getTimestamp = async (): Promise<BN> => BN.from((await latestBlock()).timestamp);

export const increaseTimeTo = async (target: BN | number): Promise<void> => {
    const now = await getTimestamp();
    const later = BN.from(target);
    if (later.lt(now))
        throw Error(`Cannot increase current time (${now.toNumber()}) to a moment in the past (${later.toNumber()})`);
    const diff = later.sub(now);
    await increaseTime(diff);
    await advanceBlock();
};

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const startWeek = (epochSeconds: BigNumberish): BN => BN.from(epochSeconds).div(ONE_WEEK).mul(ONE_WEEK);
export const startCurrentWeek = async (): Promise<BN> => startWeek(await getTimestamp());

export const weekEpoch = (epochSeconds: BigNumberish): BN => BN.from(epochSeconds).div(ONE_WEEK);
export const currentWeekEpoch = async (): Promise<BN> => weekEpoch(await getTimestamp());
