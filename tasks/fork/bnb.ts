import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { deployContract, logContracts, waitForTx } from "./../utils/deploy-utils";
import {
    VoterProxy__factory,
    MasterWombatV2__factory,
    PoolDepositor,
    PoolDepositor__factory,
    Booster__factory,
    WomStakingProxy__factory,
    WmxLocker__factory,
    ERC20__factory,
    WomDepositor__factory, Booster, IERC20__factory, BaseRewardPool__factory
} from "../../types/generated";
import {impersonate, simpleToExactAmount } from "../../test-utils";
import {BoosterMigrator} from "../../types/generated/BoosterMigrator";
import {BoosterMigrator__factory} from "../../types/generated/factories/BoosterMigrator__factory";
import {DepositorMigrator} from "../../types/generated/DepositorMigrator";
import {DepositorMigrator__factory} from "../../types/generated/factories/DepositorMigrator__factory";

const fs = require('fs');
const ethers = require('ethers');
const {approvePoolDepositor} = require('../helpers');

const waitForBlocks = undefined;

task("test-fork:boster-migrate").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await hre.ethers.provider.listAccounts().then(accounts => hre.ethers.provider.getSigner(accounts[9]))
    const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    // const providerEstimate = deployer.provider.estimateGas.bind(deployer.provider);
    //
    // deployer.provider.estimateGas = (tx) => {
    //     console.log('deployer.provider.estimateGas');
    //     return providerEstimate(tx).catch(e => {
    //         return new Promise(resolve => {
    //             setTimeout(() => providerEstimate(tx).then(resolve), 60e3)
    //         }) as any;
    //     })
    // };

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const booster = Booster__factory.connect(bnbConfig.booster, deployer);
    const voterProxy = VoterProxy__factory.connect(bnbConfig.voterProxy, deployer);
    const cvxStakingProxy = WomStakingProxy__factory.connect(bnbConfig.cvxStakingProxy, deployer);
    const cvxLocker = WmxLocker__factory.connect(bnbConfig.cvxLocker, deployer);
    const womDepositor = WomDepositor__factory.connect(bnbConfig.crvDepositor, deployer);

    const boosterOwner = await booster.owner();
    console.log('boosterOwner', boosterOwner);

    await getBoosterValues(booster);

    // const testSigner = await impersonate(await booster.owner(), true);
    //
    // await booster.connect(testSigner).setOwner(deployerAddress).then(tx => tx.wait(1));
    // await voterProxy.connect(testSigner).setOwner(deployerAddress).then(tx => tx.wait(1));

    console.log('deployContract');
    const boosterMigrator = await deployContract<BoosterMigrator>(
        hre,
        new BoosterMigrator__factory(deployer),
        "BoosterMigrator",
        [booster.address, bnbConfig.weth],
        {},
        true,
        waitForBlocks,
    );
    console.log('boosterMigrator', boosterMigrator.address);

    const depositorMigrator = await deployContract<DepositorMigrator>(
        hre,
        new DepositorMigrator__factory(deployer),
        "DepositorMigrator",
        [bnbConfig.crvDepositor, ['0xD684e0090bD4E11246c0F4d0aeFFEbd2aE252828']],
        {},
        true,
        waitForBlocks,
    );
    console.log('depositorMigrator', depositorMigrator.address);

    const daoSigner = await impersonate(await booster.owner(), true);

    await booster.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));
    await voterProxy.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));

    console.log('migration...');

    let tx = await boosterMigrator.migrate().then(tx => tx.wait(1));
    const newBoosterAddress = tx.events.filter(e => e.event === 'Migrated')[0].args.newBooster;
    const newBooster = await Booster__factory.connect(newBoosterAddress, deployer);

    console.log('newBooster', newBoosterAddress);
    console.log('newBooster owner', await newBooster.owner());
    console.log('voterProxy owner', await voterProxy.owner());

    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        [bnbConfig.weth, newBoosterAddress, bnbConfig.masterWombat],
        {},
        true,
        waitForBlocks,
    );
    console.log('poolDepositor', poolDepositor.address);

    const masterWombat = await MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);
    await approvePoolDepositor(masterWombat, poolDepositor, deployer);

    await womDepositor.connect(daoSigner).transferOwnership(depositorMigrator.address).then(tx => tx.wait(1));
    await voterProxy.connect(daoSigner).setOwner(depositorMigrator.address).then(tx => tx.wait(1));

    console.log('migration...');

    tx = await depositorMigrator.migrate().then(tx => tx.wait(1));
    const newDepositorAddress = tx.events.filter(e => e.event === 'Migrated')[0].args.newDepositor;
    const newDepositor = await WomDepositor__factory.connect(newDepositorAddress, deployer);

    console.log('newDepositor', newDepositorAddress);

    await cvxStakingProxy.connect(daoSigner).setConfig(newDepositorAddress, bnbConfig.cvxLocker).then(tx => tx.wait(1));
    await cvxStakingProxy.setApprovals().then(tx => tx.wait(1));

    const distributionTokenList = await booster.distributionTokenList();
    for (let i = 0; i < distributionTokenList.length; i++) {
        await cvxLocker.connect(daoSigner).approveRewardDistributor(distributionTokenList[i], newBoosterAddress, true).then(tx => tx.wait(1)).catch(e => {});
    }

    const womHolderAddress = '0xc37a89cdb064ac2921fcc8b3538ac0d6a3aadf48';
    const busdHolderAddress = '0xf977814e90da44bfa03b6295a0616a897441acec';
    const busdLpAddress = await masterWombat.poolInfo(0).then(p => p.lpToken);

    const womHolder = await impersonate(womHolderAddress, true);
    const busdHolder = await impersonate(busdHolderAddress, true);

    const wom = ERC20__factory.connect(bnbConfig.wom, deployer);
    const wmx = ERC20__factory.connect(bnbConfig.cvx, deployer);
    const busd = ERC20__factory.connect('0xe9e7cea3dedca5984780bafc599bd69add087d56', deployer);

    await wom.connect(womHolder).approve(newDepositor.address, await wom.balanceOf(womHolderAddress));
    await busd.connect(busdHolder).approve(poolDepositor.address, await busd.balanceOf(busdHolderAddress));

    console.log('newDepositor.deposit');
    await newDepositor.connect(womHolder)['deposit(uint256,address)'](simpleToExactAmount(1), bnbConfig.cvxCrvRewards).then(tx => tx.wait(1));
    console.log('poolDepositor.deposit');
    await poolDepositor.connect(busdHolder).deposit(busdLpAddress, simpleToExactAmount(1), 0, true).then(tx => tx.wait(1));

    const busdPool = await newBooster.poolInfo(0);
    const crvRewards = BaseRewardPool__factory.connect(busdPool.crvRewards, deployer);
    console.log('crvRewards operator', await crvRewards.operator());
    console.log('crvRewards balance', await crvRewards.balanceOf(busdHolderAddress));

    await newBooster.earmarkRewards(0).then(tx => tx.wait(1));

    console.log('wom before', await wom.balanceOf(busdHolderAddress));
    console.log('wmx before', await wmx.balanceOf(busdHolderAddress));
    await crvRewards.connect(busdHolder).withdrawAndUnwrap(simpleToExactAmount(0.5), true);
    console.log('wom after ', await wom.balanceOf(busdHolderAddress));
    console.log('wmx after ', await wmx.balanceOf(busdHolderAddress));
});


async function getBoosterValues(booster: Booster) {
    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    for (let i = 0; i < poolLength; i++) {
        await booster.earmarkRewards(i).then(tx => tx.wait(1));
        const pool = await booster.poolInfo(i);
        const lp = IERC20__factory.connect(pool.lptoken, booster.provider);
        await lp.balanceOf(booster.address);
    }
    await booster.voterProxy();
    await booster.crvLockRewards();
    const distroTokens = await booster.distributionTokenList();
    for (let i = 0; i < distroTokens.length; i++) {
        const len = await booster.distributionByTokenLength(distroTokens[i]).then(l => parseInt(l.toString()));
        for(let j = 0; j < len; j++) {
            await booster.distributionByTokens(distroTokens[i], j);
        }
    }
}
