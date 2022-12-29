import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import {IERC20__factory, LpVestedEscrow__factory, MasterWombatV2__factory} from "../../types/generated";
import {getSigner} from "../utils";
import {impersonate, increaseTime, ONE_DAY, ZERO_ADDRESS} from "../../test-utils";
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

task("tt:lp-vested-escrow:claim").setAction(async function (taskArguments: TaskArguments, hre) {
    const daoSignerAddress = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const daoSigner = await impersonate(daoSignerAddress, true);
    const lpToken = IERC20__factory.connect('0xe86eaAD81C32ffbb88B7ec9B325C8f75C8c9f1Ab', daoSigner);
    const lpVestedEscrow = LpVestedEscrow__factory.connect('0xA1B677531db12f01D2608A00D8c7BDe930D54D98', daoSigner);

    await lpVestedEscrow.setAdmin(ZERO_ADDRESS);

    await increaseTime(ONE_DAY.mul(183));

    console.log('balance before claim', await lpToken.balanceOf(daoSignerAddress));

    await lpVestedEscrow.claim(daoSignerAddress);

    console.log('balance after claim', await lpToken.balanceOf(daoSignerAddress));
});
