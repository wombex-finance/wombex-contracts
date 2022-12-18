import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import {MasterWombatV2__factory} from "../../types/generated";
import {getSigner} from "../utils";
const fs = require('fs');

task("timeTravel")
    .addParam("duration", "Length of time travel")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const { ethers } = hre;

        let blocknumber = await ethers.provider.getBlockNumber();
        let block = await ethers.provider.getBlock(blocknumber);
        console.log("current timestamp:", block.timestamp);

        const rewardDuration = parseInt(taskArgs.duration) || 86400;

        // suppose the current block has a timestamp of 01:00 PM
        await ethers.provider.send("evm_increaseTime", [rewardDuration]);
        await ethers.provider.send("evm_mine");

        blocknumber = await ethers.provider.getBlockNumber();
        block = await ethers.provider.getBlock(blocknumber);
        console.log("new timestamp:", block.timestamp);
    });


task("tt:wombat:pool").setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const deployer = await getSigner(hre);

    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));
    const masterWombat = MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);

    const pid = 0;
    const pool = await masterWombat.poolInfo(pid);
    console.log('pool', pool);
    const user = await masterWombat.userInfo(pid, bnbConfig.voterProxy);
    console.log('user', user, '\nrewardDebt', ethers.utils.formatEther(user.rewardDebt));
    const pending = (user.amount.mul(pool.accWomPerShare).add(user.factor.mul(pool.accWomPerFactorShare)))
            .div(ethers.BigNumber.from(1e12))
            .add(user.pendingWom)
            .sub(user.rewardDebt);
    console.log('pending', pending);
});
