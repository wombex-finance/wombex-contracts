import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import {
    BaseRewardPool4626__factory,
    BaseRewardPool__factory,
    Booster__factory, BoosterEarmark__factory, BribesRewardPool__factory,
    CvxCrvToken__factory,
    DepositToken__factory,
    ExtraRewardsDistributor__factory, GaugeVoting__factory, GaugeVotingLens__factory,
    PoolDepositor__factory,
    ProxyAdmin__factory, ProxyFactory__factory, ReservoirMinter__factory,
    VoterProxy__factory,
    Wmx__factory,
    WmxClaimZap__factory,
    WmxLocker__factory,
    WmxMinter__factory,
    WmxPenaltyForwarder__factory,
    WmxRewardPool__factory, WmxRewardPoolLens__factory, WmxRewardPoolV2__factory, WombexLensUI__factory,
    WomDepositorV3__factory,
    WomStakingProxy__factory
} from "../../types/generated";
import {BigNumber as BN} from "@ethersproject/bignumber/lib/bignumber";
import {ZERO_ADDRESS} from "../../test-utils";

const ethers = require('ethers');
const axios = require('axios');
const fs = require('fs');
const childProcess = require("child_process");
const path = require("path");

const masterWombatAbi = [{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"allocPoint","type":"uint256"},{"indexed":true,"internalType":"contract IERC20","name":"lpToken","type":"address"},{"indexed":true,"internalType":"contract IRewarder","name":"rewarder","type":"address"}],"name":"Add","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Deposit","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"DepositFor","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"EmergencyWithdraw","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Harvest","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"account","type":"address"}],"name":"Paused","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"allocPoint","type":"uint256"},{"indexed":true,"internalType":"contract IRewarder","name":"rewarder","type":"address"},{"indexed":false,"internalType":"bool","name":"overwrite","type":"bool"}],"name":"Set","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"account","type":"address"}],"name":"Unpaused","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":false,"internalType":"uint256","name":"basePartition","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"boostedPartition","type":"uint256"}],"name":"UpdateEmissionPartition","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":false,"internalType":"uint256","name":"womPerSec","type":"uint256"}],"name":"UpdateEmissionRate","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"lastRewardTimestamp","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"lpSupply","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"accWomPerShare","type":"uint256"}],"name":"UpdatePool","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":false,"internalType":"address","name":"oldVeWOM","type":"address"},{"indexed":false,"internalType":"address","name":"newVeWOM","type":"address"}],"name":"UpdateVeWOM","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":true,"internalType":"uint256","name":"pid","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Withdraw","type":"event"},{"inputs":[{"internalType":"uint256","name":"_allocPoint","type":"uint256"},{"internalType":"contract IERC20","name":"_lpToken","type":"address"},{"internalType":"contract IRewarder","name":"_rewarder","type":"address"}],"name":"add","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"basePartition","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"boostedPartition","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"uint256","name":"_amount","type":"uint256"}],"name":"deposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"uint256","name":"_amount","type":"uint256"},{"internalType":"address","name":"_user","type":"address"}],"name":"depositFor","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"}],"name":"emergencyWithdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"emergencyWomWithdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"asset","type":"address"}],"name":"getAssetPid","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"contract IERC20","name":"_wom","type":"address"},{"internalType":"contract IVeWom","name":"_veWom","type":"address"},{"internalType":"uint256","name":"_womPerSec","type":"uint256"},{"internalType":"uint256","name":"_basePartition","type":"uint256"},{"internalType":"uint256","name":"_startTimestamp","type":"uint256"}],"name":"initialize","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"massUpdatePools","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256[]","name":"_pids","type":"uint256[]"}],"name":"migrate","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256[]","name":"_pids","type":"uint256[]"}],"name":"multiClaim","outputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256[]","name":"","type":"uint256[]"},{"internalType":"uint256[]","name":"","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pause","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"paused","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"address","name":"_user","type":"address"}],"name":"pendingTokens","outputs":[{"internalType":"uint256","name":"pendingRewards","type":"uint256"},{"internalType":"address","name":"bonusTokenAddress","type":"address"},{"internalType":"string","name":"bonusTokenSymbol","type":"string"},{"internalType":"uint256","name":"pendingBonusRewards","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"address","name":"","type":"address"}],"name":"pendingWom","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"poolInfo","outputs":[{"internalType":"contract IERC20","name":"lpToken","type":"address"},{"internalType":"uint256","name":"allocPoint","type":"uint256"},{"internalType":"uint256","name":"lastRewardTimestamp","type":"uint256"},{"internalType":"uint256","name":"accWomPerShare","type":"uint256"},{"internalType":"contract IRewarder","name":"rewarder","type":"address"},{"internalType":"uint256","name":"sumOfFactors","type":"uint256"},{"internalType":"uint256","name":"accWomPerFactorShare","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"poolLength","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"}],"name":"rewarderBonusTokenInfo","outputs":[{"internalType":"address","name":"bonusTokenAddress","type":"address"},{"internalType":"string","name":"bonusTokenSymbol","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"uint256","name":"_allocPoint","type":"uint256"},{"internalType":"contract IRewarder","name":"_rewarder","type":"address"},{"internalType":"bool","name":"overwrite","type":"bool"}],"name":"set","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IMasterWombat","name":"_newMasterWombat","type":"address"}],"name":"setNewMasterWombat","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IVeWom","name":"_newVeWom","type":"address"}],"name":"setVeWom","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"startTimestamp","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalAllocPoint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"unpause","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_basePartition","type":"uint256"}],"name":"updateEmissionPartition","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_womPerSec","type":"uint256"}],"name":"updateEmissionRate","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_user","type":"address"},{"internalType":"uint256","name":"_newVeWomBalance","type":"uint256"}],"name":"updateFactor","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"}],"name":"updatePool","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"address","name":"","type":"address"}],"name":"userInfo","outputs":[{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"rewardDebt","type":"uint256"},{"internalType":"uint256","name":"factor","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"veWom","outputs":[{"internalType":"contract IVeWom","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"uint256","name":"_amount","type":"uint256"}],"name":"withdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"wom","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"womPerSec","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}];
const erc20Abi = [{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_spender","type":"address"},{"name":"_value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_from","type":"address"},{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"_owner","type":"address"},{"name":"_spender","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"}];

task("info:wombat").setAction(async function (taskArguments: TaskArguments, hre) {
    const masterWombat = new ethers.Contract('0x620442Ed0c3656260B44688De36832ab4C75bAC4', masterWombatAbi, hre.ethers.provider);

    console.log('wom', await masterWombat.wom());
    console.log('veWom', await masterWombat.veWom());
    console.log('womPerSec', await masterWombat.womPerSec().then(pl => pl.toString()));
    const poolLength = parseInt(await masterWombat.poolLength().then(pl => pl.toString()));
    for (let i = 0; i < poolLength; i++) {

        const poolInfo = await masterWombat.poolInfo(i);
        const lpToken = new ethers.Contract(poolInfo.lpToken, erc20Abi, hre.ethers.provider);
        console.log(i, 'poolInfo', {
            lpToken: poolInfo.lpToken,
            lpTokenSymbol: await lpToken.symbol(),
            allocPoint: poolInfo.allocPoint.toString(),
            lastRewardTimestamp: poolInfo.lastRewardTimestamp.toString(),
            accWomPerShare: poolInfo.accWomPerShare.toString(),
            sumOfFactors: poolInfo.sumOfFactors.toString(),
            accWomPerFactorShare: poolInfo.accWomPerFactorShare.toString()
        });
    }
});


task("info:wombat:save").setAction(async function (taskArguments: TaskArguments, hre) {
    const masterWombat = new ethers.Contract('0x78baec04d81fcf87551a8495d87035911a7875c6', masterWombatAbi, hre.ethers.provider);

    const bnbtConfig = {
        masterWombat: masterWombat.address,
        wom: await masterWombat.wom(),
        veWom: await masterWombat.veWom(),
        lpTokens: []
    };
    const poolLength = parseInt(await masterWombat.poolLength().then(pl => pl.toString()));
    for (let i = 0; i < poolLength; i++) {
        const poolInfo = await masterWombat.poolInfo(i);
        bnbtConfig.lpTokens.push(poolInfo.lpToken);
    }
    fs.writeFileSync('bnbt.json', JSON.stringify(bnbtConfig, null, " "));
});

task("info:wombat:main:save").setAction(async function (taskArguments: TaskArguments, hre) {
    const masterWombat = new ethers.Contract('0xE2C07d20AF0Fb50CAE6cDD615CA44AbaAA31F9c8', masterWombatAbi, hre.ethers.provider);

    const bnbtConfig = {
        masterWombat: masterWombat.address,
        wom: await masterWombat.wom(),
        veWom: await masterWombat.veWom(),
        lpTokens: []
    };
    const poolLength = parseInt(await masterWombat.poolLength().then(pl => pl.toString()));
    for (let i = 0; i < poolLength; i++) {
        const poolInfo = await masterWombat.poolInfo(i);
        bnbtConfig.lpTokens.push(poolInfo.lpToken);
    }
    fs.writeFileSync('bnb.json', JSON.stringify(bnbtConfig, null, " "));
});


task("info:lpRewards")
    .addParam("address", "The reward's address")
    .setAction(async function (taskArgs: TaskArguments, hre) {
    const baseRewards = BaseRewardPool4626__factory.connect(taskArgs.address, hre.ethers.provider);

    const data = [
        await baseRewards.pid().then(r => r.toString()),
        await baseRewards.stakingToken(),
        await baseRewards.boosterRewardToken(),
        await baseRewards.operator(),
        // await baseRewards.rewardManager(),
        await baseRewards.asset()
    ];
    fs.writeFileSync('busdRewards.js', 'module.exports = ' + JSON.stringify(data, null, " "));
});


task("info:writeArgs").setAction(async function (taskArguments: TaskArguments, hre) {
    const {network} = hre.hardhatArguments;
    const poolConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));
    const deployerAddress = '0x177e3a199205227d0c3c86e0333125ff08fe7d81';

    if (poolConfig.proxyFactory) {
        const proxyFactory = ProxyFactory__factory.connect(poolConfig.proxyFactory, hre.ethers.provider);
        await writeArgsAndVerify(hre, 'proxyFactory', poolConfig.proxyFactory, [
            ZERO_ADDRESS
        ]);

        const proxyAdmin = ProxyAdmin__factory.connect(await proxyFactory.proxyAdmin(), hre.ethers.provider);
        writeArgs('proxyFactory', []);

        const voterProxy = VoterProxy__factory.connect(poolConfig.voterProxy, hre.ethers.provider);
        const voterProxyImpl = await proxyAdmin.getProxyImplementation(poolConfig.voterProxy);
        await writeArgsAndVerify(hre, 'voterProxy', poolConfig.voterProxy, [
            voterProxyImpl,
            proxyAdmin.address,
            voterProxy.interface.encodeFunctionData('initialize', [poolConfig.token, poolConfig.veWom, poolConfig.weth, deployerAddress])
        ]);

        console.log('voterProxyImpl', voterProxyImpl);
        await writeArgsAndVerify(hre, 'voterProxyImpl', voterProxyImpl, []);

        console.log('cvxLockerImpl', await proxyAdmin.getProxyImplementation(poolConfig.cvxLocker));
        await writeArgsAndVerify(hre, 'cvxLockerImpl', await proxyAdmin.getProxyImplementation(poolConfig.cvxLocker), []);
    }

    // const cvx = Wmx__factory.connect(poolConfig.cvx, hre.ethers.provider);
    // await writeArgsAndVerify(hre, 'cvx', poolConfig.cvx, [
    //     await cvx.vProxy(),
    //     await cvx.name(),
    //     await cvx.symbol()
    // ]);

    const booster = Booster__factory.connect(poolConfig.booster, hre.ethers.provider);
    await writeArgsAndVerify(hre, 'booster', poolConfig.booster, [
        poolConfig.voterProxy,
        await booster.reservoirMinter(),
        poolConfig.cvx,
        poolConfig.wom,
        await booster.weth(),
        await booster.minMintRatio().then(r => r.toString()),
        await booster.maxMintRatio().then(r => r.toString())
    ]);

    const boosterEarmark = BoosterEarmark__factory.connect(await booster.earmarkDelegate(), hre.ethers.provider);
    await writeArgsAndVerify(hre, 'boosterEarmark', await booster.earmarkDelegate(), [
        await boosterEarmark.booster(),
        await boosterEarmark.weth(),
    ]);

    const poolLen = await booster.poolLength().then(poolLen => parseInt(poolLen.toString()));
    const boosterPool = await booster.poolInfo(poolLen - 1);
    const crvRewards = BaseRewardPool4626__factory.connect(boosterPool.crvRewards, hre.ethers.provider);
    console.log('crvRewards', crvRewards.address);
    await writeArgsAndVerify(hre, 'crvRewards', crvRewards.address, [
        await crvRewards.pid().then(r => r.toString()),
        await crvRewards.stakingToken(),
        await crvRewards.boosterRewardToken(),
        await crvRewards.operator(),
        await crvRewards.asset()
    ]);

    const depositToken = DepositToken__factory.connect(boosterPool.token, hre.ethers.provider);
    console.log('depositToken', depositToken.address);
    await writeArgsAndVerify(hre, 'depositToken', depositToken.address, [
        await depositToken.operator(),
        boosterPool.lptoken,
        " Wombex Deposit Token",
        'wmx'
    ], 'vendor/DepositToken.sol:DepositToken');

    if (poolConfig.minter) {
        const minter = WmxMinter__factory.connect(poolConfig.minter, hre.ethers.provider);
        await writeArgsAndVerify(hre, 'minter', poolConfig.minter, [
            poolConfig.cvx,
            await minter.owner()
        ]);
    }

    if (poolConfig.reservoirMinter) {
        const reservoirMinter = ReservoirMinter__factory.connect(poolConfig.reservoirMinter, hre.ethers.provider);
        await writeArgsAndVerify(hre, 'reservoirMinter', poolConfig.reservoirMinter, [
            await reservoirMinter.token(),
            await reservoirMinter.totalSupply()
        ]);
    }

    const cvxCrv = CvxCrvToken__factory.connect(poolConfig.cvxCrv, hre.ethers.provider);
    await writeArgsAndVerify(hre, 'cvxCrv', poolConfig.cvxCrv, [
        await cvxCrv.name(),
        await cvxCrv.symbol()
    ]);

    const cvxCrvRewards = BaseRewardPool__factory.connect(poolConfig.cvxCrvRewards, hre.ethers.provider);
    await writeArgsAndVerify(hre, 'cvxCrvRewards', poolConfig.cvxCrvRewards, [
        await cvxCrvRewards.pid().then(r => r.toString()),
        await cvxCrvRewards.stakingToken(),
        await cvxCrvRewards.boosterRewardToken(),
        await cvxCrvRewards.operator()
    ]);

    if (poolConfig.initialCvxCrvStaking) {
        const initialCvxCrvStaking = WmxRewardPool__factory.connect(poolConfig.initialCvxCrvStaking, hre.ethers.provider);
        await writeArgsAndVerify(hre, 'initialCvxCrvStaking', poolConfig.initialCvxCrvStaking, [
            await initialCvxCrvStaking.stakingToken(),
            await initialCvxCrvStaking.rewardToken(),
            await initialCvxCrvStaking.rewardManager(),
            await initialCvxCrvStaking.wmxLocker(),
            await initialCvxCrvStaking.penaltyForwarder(),
            BN.from(60 * 60 * 24 * 7).toString()
        ]);
    }

    const crvDepositor = WomDepositorV3__factory.connect(poolConfig.crvDepositor, hre.ethers.provider);
    await writeArgsAndVerify(hre, 'crvDepositor', poolConfig.crvDepositor, [
        await crvDepositor.wom(),
        await crvDepositor.staker(),
        await crvDepositor.minter(),
        await crvDepositor.booster(),
        await crvDepositor.oldDepositor(),
    ]);

    const cvxStakingProxy = WomStakingProxy__factory.connect(poolConfig.cvxStakingProxy, hre.ethers.provider);
    await writeArgsAndVerify(hre, 'cvxStakingProxy', poolConfig.cvxStakingProxy, [
        await cvxStakingProxy.wom(),
        await cvxStakingProxy.wmx(),
        await cvxStakingProxy.wmxWom(),
        await cvxStakingProxy.womDepositor(),
        await cvxStakingProxy.rewards(),
    ]);

    const penaltyForwarder = WmxPenaltyForwarder__factory.connect(poolConfig.penaltyForwarder, hre.ethers.provider);
    await writeArgsAndVerify(hre, 'penaltyForwarder', poolConfig.penaltyForwarder, [
        await penaltyForwarder.distributor(),
        await penaltyForwarder.token(),
        await penaltyForwarder.distributionDelay().then(r => r.toString()),
        await penaltyForwarder.owner(),
    ]);

    const extraRewardsDistributor = ExtraRewardsDistributor__factory.connect(poolConfig.extraRewardsDistributor, hre.ethers.provider);
    await writeArgsAndVerify(hre, 'extraRewardsDistributor', poolConfig.extraRewardsDistributor, [
        await extraRewardsDistributor.wmxLocker(),
    ]);

    // const claimZap = WmxClaimZap__factory.connect(poolConfig.claimZap, hre.ethers.provider);
    // await writeArgsAndVerify(hre, 'claimZap', poolConfig.claimZap, [
    //     await claimZap.wom(),
    //     await claimZap.wmx(),
    //     await claimZap.womWmx(),
    //     await claimZap.womDepositor(),
    //     await claimZap.wmxWomRewards(),
    //     await claimZap.extraRewardsDistributor(),
    //     await claimZap.womSwapDepositor(),
    //     await claimZap.locker(),
    //     await claimZap.owner()
    // ]);

    const poolDepositor = PoolDepositor__factory.connect(poolConfig.poolDepositor, hre.ethers.provider);
    await writeArgsAndVerify(hre,'poolDepositor', poolConfig.poolDepositor, [
        await poolDepositor.weth(),
        await poolDepositor.booster(),
        await poolDepositor.masterWombat(),
    ]);

    if (poolConfig.wombexUiLens) {
        const wombexUiLens = WombexLensUI__factory.connect(poolConfig.wombexUiLens, hre.ethers.provider);
        await writeArgsAndVerify(hre,'wombexUiLens', poolConfig.wombexUiLens, [
            await wombexUiLens.UNISWAP_ROUTER(),
            await wombexUiLens.UNISWAP_V3_QUOTER(),
            await wombexUiLens.MAIN_STABLE_TOKEN(),
            await wombexUiLens.WOM_TOKEN(),
            await wombexUiLens.WMX_TOKEN(),
            await wombexUiLens.WMX_MINTER(),
            await wombexUiLens.WETH_TOKEN(),
            await wombexUiLens.WMX_WOM_TOKEN(),
        ]);
    }

    if(poolConfig.wmxRewardPoolLens) {
        const wmxRewardPoolLens = WmxRewardPoolLens__factory.connect(poolConfig.wmxRewardPoolLens, hre.ethers.provider);
        await writeArgsAndVerify(hre,'wmxRewardPoolLens', poolConfig.wmxRewardPoolLens, [
            await wmxRewardPoolLens.wmxRewardPoolFactory(),
        ]);
    }

    if (process.env.wmxRewardPool) {
        const wmxRewardPoolV2 = WmxRewardPoolV2__factory.connect(process.env.wmxRewardPool, hre.ethers.provider);
        await writeArgsAndVerify(hre, 'wmxRewardPoolV2', process.env.wmxRewardPool, [
            await wmxRewardPoolV2.stakingToken(),
            await wmxRewardPoolV2.rewardToken(),
            await wmxRewardPoolV2.rewardManager(),
            await wmxRewardPoolV2.wmxLocker(),
            await wmxRewardPoolV2.penaltyForwarder(),
            await wmxRewardPoolV2.penaltyShare(),
            '66000',
            await wmxRewardPoolV2.duration(),
            await wmxRewardPoolV2.maxCap(),
            [poolConfig.crvDepositor]
        ]);
    }

    const gaugeVoting = GaugeVoting__factory.connect(poolConfig.gaugeVoting, hre.ethers.provider);
    await writeArgsAndVerify(hre,'gaugeVoting', poolConfig.gaugeVoting, [
        await gaugeVoting.wmxLocker(),
        await gaugeVoting.booster(),
        await gaugeVoting.bribeVoter()
    ]);
    const lpTokensAdded = await gaugeVoting.getLpTokensAdded();
    if (lpTokensAdded.length) {
        const bribeRewards = BribesRewardPool__factory.connect(await gaugeVoting.lpTokenRewards(lpTokensAdded[lpTokensAdded.length - 1]), hre.ethers.provider);
        await writeArgsAndVerify(hre,'bribeRewards', bribeRewards.address, [
            await bribeRewards.stakingToken(),
            await bribeRewards.operator(),
            await bribeRewards.asset(),
            await bribeRewards.callOperatorOnGetReward(),
        ]);
    }
    await writeArgsAndVerify(hre,'gaugeVotingLens', poolConfig.gaugeVotingLens, [
        poolConfig.gaugeVoting
    ]);
    await writeArgsAndVerify(hre,'bribeRewardsFactory', await gaugeVoting.bribeRewardsFactory(), [
        poolConfig.gaugeVoting
    ]);
    await writeArgsAndVerify(hre,'bribeTokenFactory', await gaugeVoting.tokenFactory(), [
        poolConfig.gaugeVoting
    ]);
});

async function verify(networkName, address, argsName, contractName = null) {
    if (!address || await getAbi(networkName, address)) {
        return;
    }
    console.log('Verify started for contract', argsName);
    await new Promise((resolve, reject) => {
        childProcess.exec(`` +
            `ETHERSCAN_KEY=${process.env.ETHERSCAN_KEY} ` +
            `NODE_URL=${process.env.NODE_URL} ` +
            `hardhat verify --network ${networkName} ` +
            `--constructor-args args/${argsName}.js ` +
            (contractName ? `--contract contracts/${contractName} ` : '') +
            `${address}`,
            (e, output) => {
                if (e) {
                    return reject(e);
                }
                console.log('output', output);
                resolve(output);
            }
        );
    });
}

function getAbi(networkName, address) {
    const apiUri = {
        'arbitrum': 'https://api.arbiscan.io',
        'bnb': 'https://api.bscscan.com'
    }
    return axios
        .get(`${apiUri[networkName]}/api?module=contract&action=getabi&address=${address}&apikey=${process.env.ETHERSCAN_KEY}`)
        .then(r => r.data.result.indexOf('[') === 0 ? JSON.parse(r.data.result) : null);
}

function writeArgsAndVerify(hre, name, address, args, contractName = null) {
    if(address === ZERO_ADDRESS) {
        return;
    }
    console.log('writeArgsAndVerify', name, address);
    writeArgs(name, args);
    return verify(hre.network.name, address, name, contractName);
}

function writeArgs(name, args) {
    if (!fs.existsSync('./args')) {
        fs.mkdirSync('args');
    }
    fs.writeFileSync('./args/' + name + '.js', 'module.exports = ' + JSON.stringify(args, null, " "));
}


task("info:setEqualPrices").setAction(async function (taskArguments: TaskArguments, hre) {
    const {network} = hre.hardhatArguments;
    const bnbtConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    bnbtConfig.equalPrices = {};

    bnbtConfig.equalPrices[bnbtConfig.cvxCrv.toLowerCase()] = bnbtConfig.wom;

    const booster = Booster__factory.connect(bnbtConfig.booster, hre.ethers.provider);
    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    for(let i = 0; i < poolLength; i++) {
        const pool = await booster.poolInfo(i);
        bnbtConfig.equalPrices[pool.token.toLowerCase()] = pool.lptoken;
    }


    fs.writeFileSync('./' + network + '.json', JSON.stringify(bnbtConfig, null, " "), {encoding: 'utf8'})
});
