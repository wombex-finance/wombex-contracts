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
    WomDepositor__factory,
    Booster,
    IERC20__factory,
    BaseRewardPool__factory,
    RewardFactory,
    RewardFactory__factory,
    TokenFactory,
    TokenFactory__factory,
    WomSwapDepositor,
    WomSwapDepositor__factory,
    WmxClaimZap,
    WmxClaimZap__factory,
    BoosterEarmark__factory,
    BoosterEarmark,
    GaugeVoting,
    GaugeVoting__factory,
    BribesRewardFactory,
    BribesRewardFactory__factory, GaugeVotingLens__factory, GaugeVotingLens
} from "../../types/generated";
import {BN, impersonate, simpleToExactAmount, ZERO_ADDRESS, increaseTime} from "../../test-utils";
import {BoosterMigrator} from "../../types/generated/BoosterMigrator";
import {BoosterMigrator__factory} from "../../types/generated/factories/BoosterMigrator__factory";
import {DepositorMigrator} from "../../types/generated/DepositorMigrator";
import {DepositorMigrator__factory} from "../../types/generated/factories/DepositorMigrator__factory";
import assert from "assert";
import {expect} from "chai";

const fs = require('fs');
const ethers = require('ethers');
const {approvePoolDepositor, getBoosterValues} = require('../helpers');

const waitForBlocks = undefined;

task("test-fork:booster-and-depositor-migrate").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await hre.ethers.provider.listAccounts().then(accounts => hre.ethers.provider.getSigner(accounts[9]))
    const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const customSlotAccount = '0xD684e0090bD4E11246c0F4d0aeFFEbd2aE252828';
    const customSlotSigner = await impersonate(customSlotAccount, true);

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const booster = Booster__factory.connect(bnbConfig.booster, deployer);
    const voterProxy = VoterProxy__factory.connect(bnbConfig.voterProxy, deployer);
    const cvxStakingProxy = WomStakingProxy__factory.connect(bnbConfig.cvxStakingProxy, deployer);
    const cvxLocker = WmxLocker__factory.connect(bnbConfig.cvxLocker, deployer);
    const womDepositor = WomDepositor__factory.connect(bnbConfig.crvDepositor, deployer);
    const masterWombat = MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);

    const mwPoolLength = await masterWombat.poolLength().then(pl => parseInt(pl.toString()));
    const userInfoList = [];
    for (let i = 0; i < mwPoolLength; i++) {
        userInfoList[i] = await masterWombat.userInfo(i, voterProxy.address);
        console.log('mw userInfo', i, userInfoList[i].amount.toString());
    }

    const oldBoosterOwner = await booster.owner();
    console.log('boosterOwner', oldBoosterOwner);
    const oldDepositorOwner = await womDepositor.owner();
    console.log('depositorOwner', oldDepositorOwner);
    const oldVoterPoxyOwner = await voterProxy.owner();
    console.log('oldVoterPoxyOwner', oldVoterPoxyOwner);

    const oldDepositorConfig = {
        lockDays: await womDepositor.lockDays(),
        lastLockAt: await womDepositor.lastLockAt(),
        smartLockPeriod: await womDepositor.smartLockPeriod(),
        checkOldSlot: await womDepositor.checkOldSlot(),
        currentSlot: await womDepositor.currentSlot(),
        customLockSlotsLen: await womDepositor.connect(customSlotSigner).getCustomLockSlotsLength(customSlotAccount),
        minter: await womDepositor.minter(),
        staker: await womDepositor.staker()
    };

    const customLockSlots = {};
    const oldCustomLockSlotsLen = await womDepositor.connect(customSlotSigner).getCustomLockSlotsLength(customSlotAccount).then(cs => parseInt(cs.toString()));
    console.log("oldCustomLockSlotsLen", oldCustomLockSlotsLen);
    for (let i = 0; i < oldCustomLockSlotsLen; i++) {
        customLockSlots[i] = await womDepositor.customLockSlots(customSlotAccount, i);
        console.log('customLockSlot', i, customLockSlots[i].amount.toString());
    }

    const oldBoosterEarmark = BoosterEarmark__factory.connect(bnbConfig.booster, deployer);
    await getBoosterValues(booster, oldBoosterEarmark);

    const newBooster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        [bnbConfig.voterProxy, bnbConfig.cvx, bnbConfig.wom, bnbConfig.weth, 2000, 15000],
        {},
        true,
    );

    const newBoosterEarmark = await deployContract<BoosterEarmark>(
        hre,
        new BoosterEarmark__factory(deployer),
        "BoosterEarmark",
        [newBooster.address, bnbConfig.weth],
        {},
        true,
    );

    await newBooster.setEarmarkDelegate(newBoosterEarmark.address);

    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [newBooster.address, bnbConfig.wom],
        {},
        true,
    );
    const tokenFactoryNamePostfix = ' Wombex Deposit Token';
    const cvxSymbol = 'WMX';

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [newBooster.address, tokenFactoryNamePostfix, cvxSymbol.toLowerCase()],
        {},
        true,
    );

    console.log('deployContract BoosterMigrator');
    const boosterMigrator = await deployContract<BoosterMigrator>(
        hre,
        new BoosterMigrator__factory(deployer),
        "BoosterMigrator",
        [booster.address, newBooster.address, rewardFactory.address, tokenFactory.address, bnbConfig.weth],
        {},
        true,
        waitForBlocks,
    );
    console.log('boosterMigrator', boosterMigrator.address);

    await newBooster.setOwner(boosterMigrator.address).then(tx => tx.wait(1));
    await newBooster.setPoolManager(newBoosterEarmark.address).then(tx => tx.wait(1));
    await newBoosterEarmark.transferOwnership(boosterMigrator.address).then(tx => tx.wait(1));

    console.log('deployContract DepositorMigrator');
    const depositorMigrator = await deployContract<DepositorMigrator>(
        hre,
        new DepositorMigrator__factory(deployer),
        "DepositorMigrator",
        [bnbConfig.crvDepositor, ['0xD684e0090bD4E11246c0F4d0aeFFEbd2aE252828'], [oldCustomLockSlotsLen]],
        {},
        true,
        waitForBlocks,
    );
    console.log('depositorMigrator', depositorMigrator.address);

    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        [bnbConfig.weth, newBooster.address, bnbConfig.masterWombat],
        {},
        true,
        waitForBlocks,
    );
    console.log('poolDepositor', poolDepositor.address);

    const daoSigner = await impersonate(await booster.owner(), true);

    await booster.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));
    await voterProxy.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));

    console.log('migration...');

    let tx = await boosterMigrator.migrate().then(tx => tx.wait(1));
    const newBoosterAddress = tx.events.filter(e => e.event === 'Migrated')[0].args.newBooster;

    console.log('newBooster', newBoosterAddress);
    console.log('newBooster owner', await newBooster.owner());
    console.log('voterProxy owner', await voterProxy.owner());

    await approvePoolDepositor(masterWombat, poolDepositor, deployer);

    await womDepositor.connect(daoSigner).transferOwnership(depositorMigrator.address).then(tx => tx.wait(1));
    await voterProxy.connect(daoSigner).setOwner(depositorMigrator.address).then(tx => tx.wait(1));

    console.log('migration...');

    tx = await depositorMigrator.migrate().then(tx => tx.wait(1));
    const newDepositorAddress = tx.events.filter(e => e.event === 'Migrated')[0].args.newDepositor;
    const newDepositor = await WomDepositor__factory.connect(newDepositorAddress, deployer);

    console.log('newDepositor', newDepositorAddress);
    console.log('newDepositor owner', await newDepositor.owner());

    const slotEnds = {};
    const lockedCustomSlots = {};
    const releasedCustomSlots = {};
    const oldCurrentSlot = await womDepositor.currentSlot().then(cs => parseInt(cs.toString()));
    for (let i = 0; i <= oldCurrentSlot; i++) {
        slotEnds[i] = await womDepositor.slotEnds(i);
        lockedCustomSlots[i] = await womDepositor.lockedCustomSlots(i);
        releasedCustomSlots[i] = await womDepositor.releasedCustomSlots(i);
    }

    await cvxStakingProxy.connect(daoSigner).setConfig(newDepositorAddress, bnbConfig.cvxLocker).then(tx => tx.wait(1));

    const distributionTokenList = await oldBoosterEarmark.distributionTokenList();
    for (let i = 0; i < distributionTokenList.length; i++) {
        await cvxLocker.connect(daoSigner).approveRewardDistributor(distributionTokenList[i], newBoosterAddress, true).then(tx => tx.wait(1)).catch(e => {});
    }

    assert(oldBoosterOwner === (await booster.owner()));
    assert(oldBoosterOwner === (await newBooster.owner()));
    assert(oldDepositorOwner === (await womDepositor.owner()));
    assert(oldDepositorOwner === (await newDepositor.owner()));
    assert(oldVoterPoxyOwner === (await voterProxy.owner()));

    for (let i = 0; i < mwPoolLength; i++) {
        process.stdout.write('Check masterWombat userInfo: ' + i + '\r');
        const newUserInfo = await masterWombat.userInfo(i, voterProxy.address);
        assert(newUserInfo.amount.toString() === userInfoList[i].amount.toString());
    }
    console.log("userInfo check finish            ");

    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    const newPoolLength = await newBooster.poolLength().then(l => parseInt(l.toString()));
    assert(poolLength === newPoolLength);
    for (let i = 0; i < poolLength; i++) {
        process.stdout.write('Check booster pool: ' + i + '\r');
        const oldPool = await booster.poolInfo(i);
        const newPool = await newBooster.poolInfo(i);
        assert(oldPool.crvRewards === newPool.crvRewards);
        assert(oldPool.lptoken === newPool.lptoken);
        assert(oldPool.token === newPool.token);
        assert(oldPool.gauge === newPool.gauge);
        assert(!oldPool.shutdown);
        assert(!newPool.shutdown);
    }
    console.log("newPoolLength check finish              ");

    const newCurrentSlot = await newDepositor.currentSlot().then(cs => parseInt(cs.toString()));
    for (let i = 0; i <= newCurrentSlot; i++) {
        process.stdout.write('Check newDepositor slot: ' + i + '\r');
        assert(slotEnds[i].toString() === await newDepositor.slotEnds(i).then(se => se.toString()));
        assert(lockedCustomSlots[i] === await newDepositor.lockedCustomSlots(i));
        assert(releasedCustomSlots[i] === await newDepositor.releasedCustomSlots(i));
    }
    console.log("newCurrentSlot check finish              ");

    const newCustomLockSlotsLen = await newDepositor.getCustomLockSlotsLength(customSlotAccount).then(cs => parseInt(cs.toString()));
    console.log("newCustomLockSlotsLen", newCustomLockSlotsLen);
    for (let i = 0; i < newCustomLockSlotsLen; i++) {
        process.stdout.write('Check newDepositor customLockSlot: ' + i + '\r');
        const newCustomSlot = await newDepositor.customLockSlots(customSlotAccount, i);
        assert(customLockSlots[i].amount.toString() === newCustomSlot.amount.toString());
        assert(customLockSlots[i].number.toString() === newCustomSlot.number.toString());
    }
    console.log("newCustomLockSlotsLen check finish                  ");

    assert(oldDepositorConfig.lockDays.toString() === await newDepositor.lockDays().then(cs => cs.toString()));
    assert(oldDepositorConfig.smartLockPeriod.toString() === await newDepositor.smartLockPeriod().then(cs => cs.toString()));
    assert(await womDepositor.lastLockAt().then(cs => cs.toString()) === await newDepositor.lastLockAt().then(cs => cs.toString()));
    assert(await womDepositor.checkOldSlot().then(cs => cs.toString()) === await newDepositor.checkOldSlot().then(cs => cs.toString()));
    assert(await womDepositor.currentSlot().then(cs => cs.toString()) === await newDepositor.currentSlot().then(cs => cs.toString()));
    assert(oldDepositorConfig.customLockSlotsLen.toString() === await newDepositor.getCustomLockSlotsLength(customSlotAccount).then(cs => cs.toString()));
    assert(oldDepositorConfig.minter === await newDepositor.minter());
    assert(oldDepositorConfig.staker === await newDepositor.staker());

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

    const cvxCrvRewards = BaseRewardPool__factory.connect(bnbConfig.cvxCrvRewards, deployer);
    console.log('cvxCrvRewards balance', await cvxCrvRewards.balanceOf(womHolderAddress));

    const busdPool = await newBooster.poolInfo(0);
    const crvRewards = BaseRewardPool__factory.connect(busdPool.crvRewards, deployer);
    console.log('crvRewards operator', await crvRewards.operator());
    console.log('crvRewards balance', await crvRewards.balanceOf(busdHolderAddress));

    await newBoosterEarmark.earmarkRewards(0).then(tx => tx.wait(1));

    console.log('1 wom before', await wom.balanceOf(womHolderAddress));
    console.log('1 wmx before', await wmx.balanceOf(womHolderAddress));
    await cvxCrvRewards.connect(womHolder).withdraw(simpleToExactAmount(0.5), true);
    console.log('1 wom after ', await wom.balanceOf(womHolderAddress));
    console.log('1 wmx after ', await wmx.balanceOf(womHolderAddress));

    console.log('2 wom before', await wom.balanceOf(busdHolderAddress));
    console.log('2 wmx before', await wmx.balanceOf(busdHolderAddress));
    await crvRewards.connect(busdHolder).withdrawAndUnwrap(simpleToExactAmount(0.5), true);
    console.log('2 wom after ', await wom.balanceOf(busdHolderAddress));
    console.log('2 wmx after ', await wmx.balanceOf(busdHolderAddress));
});

task("test-fork:booster-migrate").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await hre.ethers.provider.listAccounts().then(accounts => hre.ethers.provider.getSigner(accounts[9]))
    const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const booster = Booster__factory.connect(bnbConfig.booster, deployer);
    const voterProxy = VoterProxy__factory.connect(bnbConfig.voterProxy, deployer);
    const cvxLocker = WmxLocker__factory.connect(bnbConfig.cvxLocker, deployer);
    const womDepositor = WomDepositor__factory.connect(bnbConfig.crvDepositor, deployer);
    const masterWombat = MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);
    const oldBoosterEarmark = BoosterEarmark__factory.connect(bnbConfig.booster, deployer);

    const mwPoolLength = await masterWombat.poolLength().then(pl => parseInt(pl.toString()));
    const userInfoList = [];
    for (let i = 0; i < mwPoolLength; i++) {
        userInfoList[i] = await masterWombat.userInfo(i, voterProxy.address);
        console.log('mw userInfo', i, userInfoList[i].amount.toString());
    }

    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    let activePoolList = [];
    for (let i = 0; i < poolLength; i++) {
        const poolInfo = await booster.poolInfo(i);
        if (!poolInfo.shutdown) {
            activePoolList.push(i);
        }
    }

    const oldBoosterOwner = await booster.owner();
    console.log('boosterOwner', oldBoosterOwner);
    const oldVoterPoxyOwner = await voterProxy.owner();
    console.log('oldVoterPoxyOwner', oldVoterPoxyOwner);

    await getBoosterValues(booster, oldBoosterEarmark);

    console.log('const newBooster = await deployContract<Booster>');
    const newBooster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        [bnbConfig.voterProxy, bnbConfig.cvx, bnbConfig.wom, bnbConfig.weth, 2000, 15000],
        {},
        true,
    );

    const newBoosterEarmark = await deployContract<BoosterEarmark>(
        hre,
        new BoosterEarmark__factory(deployer),
        "BoosterEarmark",
        [newBooster.address, bnbConfig.weth],
        {},
        true,
    );

    await newBooster.setEarmarkDelegate(newBoosterEarmark.address);

    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [newBooster.address, bnbConfig.wom],
        {},
        true,
    );
    const tokenFactoryNamePostfix = ' Wombex Deposit Token';
    const cvxSymbol = 'WMX';

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [newBooster.address, tokenFactoryNamePostfix, cvxSymbol.toLowerCase()],
        {},
        true,
    );

    console.log('deployContract BoosterMigrator');
    const boosterMigrator = await deployContract<BoosterMigrator>(
        hre,
        new BoosterMigrator__factory(deployer),
        "BoosterMigrator",
        [booster.address, ZERO_ADDRESS, newBooster.address, rewardFactory.address, tokenFactory.address, bnbConfig.weth],
        {},
        true,
        waitForBlocks,
    );
    console.log('boosterMigrator', boosterMigrator.address);

    await newBooster.setOwner(boosterMigrator.address).then(tx => tx.wait(1));
    await newBooster.setPoolManager(newBoosterEarmark.address).then(tx => tx.wait(1));
    await newBoosterEarmark.transferOwnership(boosterMigrator.address).then(tx => tx.wait(1));

    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        [bnbConfig.weth, newBooster.address, bnbConfig.masterWombat],
        {},
        true,
        waitForBlocks,
    );
    console.log('poolDepositor', poolDepositor.address);

    const daoSigner = await impersonate(await booster.owner(), true);

    await booster.connect(daoSigner).setPoolManager(boosterMigrator.address).then(tx => tx.wait(1));
    await booster.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));
    await voterProxy.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));

    console.log('migration...');

    await boosterMigrator.migrate().then(tx => tx.wait(1));

    console.log('newBooster', newBooster.address);
    console.log('newBooster owner', await newBooster.owner());
    console.log('voterProxy owner', await voterProxy.owner());

    await approvePoolDepositor(masterWombat, poolDepositor, deployer);

    const distributionTokenList = await oldBoosterEarmark.distributionTokenList();
    for (let i = 0; i < distributionTokenList.length; i++) {
        await cvxLocker.connect(daoSigner).approveRewardDistributor(distributionTokenList[i], newBooster.address, true).then(tx => tx.wait(1)).catch(e => {});
    }

    await womDepositor.connect(daoSigner).setBooster(newBooster.address, 0).then(tx => tx.wait(1));
    await newBooster.connect(daoSigner).setPaused(false).then(tx => tx.wait(1));

    assert(oldBoosterOwner === (await booster.owner()));
    assert(oldBoosterOwner === (await newBooster.owner()));
    assert(oldVoterPoxyOwner === (await voterProxy.owner()));

    for (let i = 0; i < mwPoolLength; i++) {
        process.stdout.write('Check masterWombat userInfo: ' + i + '\r');
        const newUserInfo = await masterWombat.userInfo(i, voterProxy.address);
        assert(newUserInfo.amount.toString() === userInfoList[i].amount.toString());
    }
    console.log("userInfo check finish            ");

    const newPoolLength = await newBooster.poolLength().then(l => parseInt(l.toString()));
    assert(activePoolList.length === newPoolLength);
    for (let i = 0; i < newPoolLength; i++) {
        process.stdout.write('Check booster pool: ' + i + '\r');
        const oldPool = await booster.poolInfo(activePoolList[i]);
        const newPool = await newBooster.poolInfo(i);
        assert(oldPool.crvRewards === newPool.crvRewards);
        assert(oldPool.lptoken === newPool.lptoken);
        assert(oldPool.token === newPool.token);
        assert(oldPool.gauge === newPool.gauge);
        assert(!oldPool.shutdown);
        assert(!newPool.shutdown);
    }
    console.log("newPoolLength check finish              ");

    const womHolderAddress = '0x3153793ad16670053c9f6ef49dbb650fa7c56a5b';
    const busdHolderAddress = '0xf977814e90da44bfa03b6295a0616a897441acec';
    const busdLpAddress = await masterWombat.poolInfo(0).then(p => p.lpToken);

    const womHolder = await impersonate(womHolderAddress, true);
    const busdHolder = await impersonate(busdHolderAddress, true);

    const wom = ERC20__factory.connect(bnbConfig.wom, deployer);
    const wmx = ERC20__factory.connect(bnbConfig.cvx, deployer);
    const busd = ERC20__factory.connect('0xe9e7cea3dedca5984780bafc599bd69add087d56', deployer);

    await busd.connect(busdHolder).approve(poolDepositor.address, await busd.balanceOf(busdHolderAddress));

    const oldMW = MasterWombatV2__factory.connect(await newBooster.poolInfo('0').then(p => p.gauge), deployer);
    // await voterProxy.connect(daoSigner).setLpTokensPid(oldMW.address).then(tx => tx.wait());
    const lpTokenBalance = {};
    const mwLen = await oldMW.poolLength().then(len => parseInt(len.toString()));
    for (let i = 0; i < mwLen; i++) {
        const pool = await oldMW.poolInfo(i);
        const pid = await voterProxy.lpTokenToPid(oldMW.address, pool.lpToken).then(p => p.toString());
        const pidSet = await voterProxy.lpTokenPidSet(oldMW.address, pool.lpToken);
        lpTokenBalance[pool.lpToken] = {
            pid,
            pidSet,
            balance: await oldMW.userInfo(pid, voterProxy.address).then(u => u.amount.toString()),
        };
        // await newMasterWombat.add(pool.allocPoint, pool.lpToken, pool.rewarder).then(tx => tx.wait());
    }
    console.log('lpTokenBalance', lpTokenBalance);

    const newMasterWombat = MasterWombatV2__factory.connect('0x489833311676B566f888119c29bd997Dc6C95830', deployer);
    const newMasterWombatOwner = await impersonate(await newMasterWombat.owner(), true);
    await voterProxy.connect(daoSigner).setLpTokensPid(newMasterWombat.address).then(tx => tx.wait());
    // await newMasterWombat.connect(newMasterWombatOwner).unpause();
    const pids = Array.from(Array(await newBooster.poolLength().then(pl => parseInt(pl.toString()))).keys());
    await newBoosterEarmark.connect(daoSigner).gaugeMigrate(newMasterWombat.address, pids).then(tx => tx.wait());

    for (let i = 0; i < mwLen; i++) {
        const pool = await oldMW.poolInfo(i);
        const olBalance = await oldMW.userInfo(await voterProxy.lpTokenToPid(oldMW.address, pool.lpToken), voterProxy.address).then(u => u.amount);
        expect(olBalance).eq(0);
        const pid = await voterProxy.lpTokenToPid(newMasterWombat.address, pool.lpToken);
        const pidSet = await voterProxy.lpTokenPidSet(newMasterWombat.address, pool.lpToken);
        const newBalance = await newMasterWombat.userInfo(pid, voterProxy.address).then(u => u.amount);
        const rewardTokens = pidSet ? await voterProxy.getGaugeRewardTokens(pool.lpToken, newMasterWombat.address) : null;
        console.log('pool.lpToken', pid.toString(), pidSet, pool.lpToken, pidSet ? newBalance.toString() : null, 'rewardTokens', rewardTokens);
        // if (pidSet) {
        //     expect(newBalance).eq(lpTokenBalance[pool.lpToken].balance);
        // }
    }

    for (let i = 0; i < newPoolLength; i++) {
        const newPool = await newBooster.poolInfo(i);
        console.log(i, 'newPool.gauge', newPool.gauge);
    }

    console.log('poolDepositor.deposit');
    await poolDepositor.connect(busdHolder).deposit(busdLpAddress, simpleToExactAmount(1), 0, true).then(tx => tx.wait(1));

    const cvxCrvRewards = BaseRewardPool__factory.connect(bnbConfig.cvxCrvRewards, deployer);
    console.log('cvxCrvRewards balance', await cvxCrvRewards.balanceOf(womHolderAddress));

    const busdPool = await newBooster.poolInfo(0);
    const crvRewards = BaseRewardPool__factory.connect(busdPool.crvRewards, deployer);
    console.log('crvRewards operator', await crvRewards.operator());
    console.log('crvRewards balance', await crvRewards.balanceOf(busdHolderAddress));

    for(let i = 0; i < newPoolLength; i++) {
        const res = await newBoosterEarmark.earmarkRewards(i).then(tx => tx.wait(1));
        console.log('earmarkRewards events', res.events.filter(e => e.event === 'EarmarkRewardsTransfer').map(e => ({
            pid: e.args.pid.toString(),
            lpToken: e.args.lpToken,
            rewardToken: e.args.rewardToken,
            amount: e.args.amount.toString(),
        })));
    }

    console.log('1 wom before', await wom.balanceOf(womHolderAddress));
    console.log('1 wmx before', await wmx.balanceOf(womHolderAddress));
    await cvxCrvRewards.connect(womHolder).withdraw(simpleToExactAmount(0.5), true);
    console.log('1 wom after ', await wom.balanceOf(womHolderAddress));
    console.log('1 wmx after ', await wmx.balanceOf(womHolderAddress));

    console.log('2 wom before', await wom.balanceOf(busdHolderAddress));
    console.log('2 wmx before', await wmx.balanceOf(busdHolderAddress));
    await crvRewards.connect(busdHolder).withdrawAndUnwrap(simpleToExactAmount(0.5), true);
    console.log('2 wom after ', await wom.balanceOf(busdHolderAddress));
    console.log('2 wmx after ', await wmx.balanceOf(busdHolderAddress));
});

task("test-fork:check-earmark").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await hre.ethers.provider.listAccounts().then(accounts => hre.ethers.provider.getSigner(accounts[9]))
    const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const booster = Booster__factory.connect(bnbConfig.booster, deployer);
    const voterProxy = VoterProxy__factory.connect(bnbConfig.voterProxy, deployer);
    const masterWombat = MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);
    const wom = ERC20__factory.connect(bnbConfig.wom, deployer);

    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    let totalPending = BN.from('0');
    for (let i = 0; i < poolLength; i++) {
        const pool = await booster.poolInfo(i);
        const pendingCrvRewards = await booster.lpPendingRewards(pool.lptoken, bnbConfig.wom);
        console.log(i, "   Pending           ", pendingCrvRewards.toString());
        totalPending = pendingCrvRewards.add(totalPending);
    }
    const pool5 = await booster.poolInfo(5);
    const womBoosterBalanceBefore = await wom.balanceOf(booster.address);
    console.log('womBoosterBalanceBefore', womBoosterBalanceBefore.toString());
    const voterProxyBalanceBefore = await wom.balanceOf(voterProxy.address);
    console.log('voterProxyBalanceBefore', voterProxyBalanceBefore.toString());
    console.log('totalPending           ', totalPending.toString());
    console.log('totalBalance           ', womBoosterBalanceBefore.add(voterProxyBalanceBefore).toString());
});

task("test-fork:wom-swap-depositor").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await hre.ethers.provider.listAccounts().then(accounts => hre.ethers.provider.getSigner(accounts[9]))
    const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const womSwapDepositor = await deployContract<WomSwapDepositor>(
        hre,
        new WomSwapDepositor__factory(deployer),
        "WomSwapDepositor",
        [bnbConfig.wom, bnbConfig.cvxCrv, '0xeEB5a751E0F5231Fc21c7415c4A4c6764f67ce2e', '0x19609b03c976cca288fbdae5c21d4290e9a4add7'],
        {},
        true,
        waitForBlocks,
    );
    console.log('womSwapDepositor', womSwapDepositor.address);

    const zap = await deployContract<WmxClaimZap>(
        hre,
        new WmxClaimZap__factory(deployer),
        "WmxClaimZap",
        [
            bnbConfig.token,
            bnbConfig.cvx,
            bnbConfig.cvxCrv,
            bnbConfig.crvDepositor,
            bnbConfig.cvxCrvRewards,
            bnbConfig.extraRewardsDistributor,
            womSwapDepositor.address,
            bnbConfig.cvxLocker,
            deployerAddress
        ],
        {},
        true,
        waitForBlocks,
    );
    console.log('zap', zap.address);

    const womHolderAddress = '0xc37a89cdb064ac2921fcc8b3538ac0d6a3aadf48';
    const womHolder = await impersonate(womHolderAddress, true);

    const wom = ERC20__factory.connect(bnbConfig.wom, deployer);
    await wom.connect(womHolder).approve(womSwapDepositor.address, await wom.balanceOf(womHolderAddress));

    await womSwapDepositor.connect(womHolder).deposit(simpleToExactAmount(1), bnbConfig.cvxCrvRewards, '0', new Date().getTime().toString());

    console.log('womSwapDepositor quote 1', await womSwapDepositor.quotePotentialSwap(simpleToExactAmount(1)));
    console.log('womSwapDepositor quote 2', await womSwapDepositor.quotePotentialSwap(simpleToExactAmount(2)));
    console.log('womSwapDepositor quote 1000', await womSwapDepositor.quotePotentialSwap(simpleToExactAmount(1000)));
    console.log('womSwapDepositor quote 1000000', await womSwapDepositor.quotePotentialSwap(simpleToExactAmount(1000000)));

    const wmxWomRewards = BaseRewardPool__factory.connect(bnbConfig.cvxCrvRewards, deployer);
    console.log('wmxWomRewards balance', await wmxWomRewards.balanceOf(womHolderAddress));

    const pendingRewardsUserAddress = '0x46919f4016befb3c9a01e72a1cfc395695276a01';
    const pendingRewardsUser = await impersonate(pendingRewardsUserAddress, true);

    const wmxWom = ERC20__factory.connect(bnbConfig.cvxCrv, deployer);
    console.log('wmxWomRewards balance', await wmxWomRewards.balanceOf(womHolderAddress));
    const wmxWomBalanceBefore = await wmxWom.balanceOf(pendingRewardsUserAddress);
    const womBalanceBefore = await wom.balanceOf(pendingRewardsUserAddress);

    const booster = Booster__factory.connect(bnbConfig.booster, deployer);
    const pool0RewardsAddress = await booster.poolInfo(0).then(pi => pi.crvRewards);

    await wom.connect(pendingRewardsUser).approve(zap.address, simpleToExactAmount(999999999)).then(tx => tx.wait(1));
    await zap.connect(pendingRewardsUser).claimRewards([pool0RewardsAddress], [], [], [], simpleToExactAmount(1), simpleToExactAmount(1), '0', '256')
    console.log('wom received', await wom.balanceOf(pendingRewardsUserAddress).then(b => b.sub(womBalanceBefore)));
    console.log('wmxWom received', await wmxWom.balanceOf(pendingRewardsUserAddress).then(b => b.sub(wmxWomBalanceBefore)));
});

task("test-fork:booster-earmark").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    // const deployer = await hre.ethers.provider.listAccounts().then(accounts => hre.ethers.provider.getSigner(accounts[9]))
    // const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    // console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const daoMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';

    const boosterEarmark = await deployContract<BoosterEarmark>(
        hre,
        new BoosterEarmark__factory(deployer),
        "BoosterEarmark",
        [bnbConfig.booster, bnbConfig.weth],
        {},
        true,
        waitForBlocks,
    );
    console.log('boosterEarmark', boosterEarmark.address);

    await boosterEarmark.transferOwnership(daoMultisig).then(tx => tx.wait());

    const dao = await impersonate(daoMultisig, true);

    const booster = Booster__factory.connect(bnbConfig.booster, dao);
    const oldBoosterEarmark = BoosterEarmark__factory.connect(await booster.earmarkDelegate(), deployer);
    await booster.connect(dao).setEarmarkDelegate(boosterEarmark.address).then(tx => tx.wait());
    await oldBoosterEarmark.connect(dao).setBoosterPoolManager(boosterEarmark.address).then(tx => tx.wait());

    console.log('migrateDistribution');
    await boosterEarmark.connect(dao).migrateDistribution(oldBoosterEarmark.address).then(tx => tx.wait());

    await getBoosterValues(booster, boosterEarmark);

    console.log('earmarkRewards 10');
    await boosterEarmark.earmarkRewards(10).then(tx => tx.wait());
    console.log('earmarkRewards success');
});

task("test-fork:gauge-voting-migrate").setAction(async function (taskArguments: TaskArguments, hre) {
    // const deployer = await getSigner(hre);
    const deployer = await hre.ethers.provider.listAccounts().then(accounts => hre.ethers.provider.getSigner(accounts[9]))
    // const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const gaugeVotingLens = await deployContract<GaugeVotingLens>(
        hre,
        new GaugeVotingLens__factory(deployer),
        "GaugeVotingLens",
        ['0x01F5cf0ddf7654714DA2a8D712Ce55687aC6057c'],
        {},
        true,
        waitForBlocks,
    );
    console.log("getUserRewards", await gaugeVotingLens.getUserRewards('0x2f667D66dD3145F9cf9665428fd530902b0F7843', 2));
    return;

    // console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const daoMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';

    const oldGaugeVoting = GaugeVoting__factory.connect('0xfC41ACe00811cfF97EB6BAdF42f3d2B9f1ceB3d4', deployer);

    const newGaugeVoting = await deployContract<GaugeVoting>(
        hre,
        new GaugeVoting__factory(deployer),
        "GaugeVoting",
        [await oldGaugeVoting.wmxLocker(), await oldGaugeVoting.booster(), await oldGaugeVoting.bribeVoter()],
        {},
        true,
        waitForBlocks,
    );
    console.log('newGaugeVoting', newGaugeVoting.address);
    const bribesRewardFactory = await deployContract<BribesRewardFactory>(
        hre,
        new BribesRewardFactory__factory(deployer),
        "BribesRewardFactory",
        [newGaugeVoting.address],
        {},
        true,
        waitForBlocks,
    );
    console.log('bribesRewardFactory', bribesRewardFactory.address);
    await newGaugeVoting.setFactories(ZERO_ADDRESS, bribesRewardFactory.address, await oldGaugeVoting.stakingToken()).then(tx => tx.wait());
    const rewards = ["0x1623955a87DC65B19482864d7a1F7213F0e3e04A", "0x24373CF57213874C989444d9712780D4CD7ee0bd", "0x4EB829FB1d7c9d14a214d26419bff94776853b91", "0xa140a78a0a2c4d7B2478C61C8F76F36E0C774C0f", "0x5623EBb81b9a10aD599BaCa9A309F2c409fC498c"];
    await newGaugeVoting.registerCreatedLpTokens(rewards).then(tx => tx.wait());
    await newGaugeVoting.approveRewards().then(tx => tx.wait());
    await newGaugeVoting.transferOwnership(daoMultisig).then(tx => tx.wait());

    const dao = await impersonate(daoMultisig, true);

    const booster = Booster__factory.connect(bnbConfig.booster, dao);

    console.log('migration...');
    await oldGaugeVoting.connect(dao).migrateRewards(rewards, newGaugeVoting.address).then(tx => tx.wait());
    await oldGaugeVoting.connect(dao).migrateStakingToken(newGaugeVoting.address).then(tx => tx.wait());
    await booster.connect(dao).setVoteDelegate(newGaugeVoting.address, true).then(tx => tx.wait());

    console.log('getVotesDelta 1', await newGaugeVoting.getVotesDelta());

    let res = await newGaugeVoting.voteExecute(daoMultisig).then(tx => tx.wait());
    console.log('1 events', res.events.filter(e => e.event));

    res = await newGaugeVoting.voteExecute(daoMultisig).then(tx => tx.wait());
    console.log('2 events', res.events.filter(e => e.event));

    console.log('getVotesDelta 2', await newGaugeVoting.getVotesDelta());

    await increaseTime(24 * 60 * 60);

    res = await newGaugeVoting.voteExecute(daoMultisig).then(tx => tx.wait());
    console.log('3 events', res.events.filter(e => e.event));

    const rewardToken = IERC20__factory.connect("0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5", deployer);
    for (let i = 0; i < rewards.length; i++) {
        console.log('rewardToken balance', await rewardToken.balanceOf(rewards[i]));
    }
});


