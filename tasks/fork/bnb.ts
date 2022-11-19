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
    TokenFactory, TokenFactory__factory, WomSwapDepositor, WomSwapDepositor__factory, WmxClaimZap, WmxClaimZap__factory
} from "../../types/generated";
import {BN, impersonate, simpleToExactAmount} from "../../test-utils";
import {BoosterMigrator} from "../../types/generated/BoosterMigrator";
import {BoosterMigrator__factory} from "../../types/generated/factories/BoosterMigrator__factory";
import {DepositorMigrator} from "../../types/generated/DepositorMigrator";
import {DepositorMigrator__factory} from "../../types/generated/factories/DepositorMigrator__factory";
import assert from "assert";
import hre from "hardhat";

const fs = require('fs');
const ethers = require('ethers');
const {approvePoolDepositor, getBoosterValues} = require('../helpers');

const waitForBlocks = undefined;

task("test-fork:booster-migrate").setAction(async function (taskArguments: TaskArguments, hre) {
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

    await getBoosterValues(booster);

    const newBooster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        [bnbConfig.voterProxy, bnbConfig.cvx, bnbConfig.wom, bnbConfig.weth, 2000, 15000],
        {},
        true,
    );

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
    await newBooster.setPoolManager(boosterMigrator.address).then(tx => tx.wait(1));

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
    await cvxStakingProxy.setApprovals().then(tx => tx.wait(1));

    const distributionTokenList = await booster.distributionTokenList();
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

    await newBooster.earmarkRewards(0).then(tx => tx.wait(1));

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

