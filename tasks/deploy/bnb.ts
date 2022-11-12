import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { deployContract, logContracts, waitForTx } from "./../utils/deploy-utils";
import { deployFirstStage } from "../../scripts/deploySystem";
import {
    VoterProxy__factory,
    VoterProxy,
    WETH__factory,
    MasterWombatV2__factory,
    IERC20__factory,
    Pool__factory,
    WmxClaimZap,
    WmxClaimZap__factory,
    IMasterWombatRewarder__factory,
    WmxRewardPool,
    WmxRewardPool__factory,
    WmxMerkleDrop,
    WmxMerkleDrop__factory,
    WmxVestedEscrowLockOnly,
    WmxVestedEscrowLockOnly__factory,
    Booster,
    Booster__factory,
    RewardFactory,
    RewardFactory__factory,
    TokenFactory,
    TokenFactory__factory,
    BoosterMigrator,
    BoosterMigrator__factory,
    DepositorMigrator,
    DepositorMigrator__factory,
    PoolDepositor, PoolDepositor__factory
} from "../../types/generated";
import {
    createTreeWithAccounts,
    getAccountBalanceProof, ONE_DAY,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO_ADDRESS
} from "../../test-utils";

const fs = require('fs');
const ethers = require('ethers');

const forking = false;
const waitForBlocks = forking ? undefined : 3;

task("deploy:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    //BNB
    const daoMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const vestingMultisig = daoMultisig;
    const treasuryMultisig = daoMultisig;
    const wbnb = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbtConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const weth = WETH__factory.connect(wbnb, deployer);
    const masterWombat = MasterWombatV2__factory.connect(bnbtConfig.masterWombat, deployer);
    const pool = Pool__factory.connect(bnbtConfig.pool, deployer);
    const crv = IERC20__factory.connect(bnbtConfig.wom, deployer);

    bnbtConfig.token = bnbtConfig.wom;

    const voterProxy = await deployContract<VoterProxy>(
        hre,
        new VoterProxy__factory(deployer),
        "VoterProxy",
        [bnbtConfig.token, bnbtConfig.veWom, weth.address],
        {},
        true,
        waitForBlocks,
    );
    console.log('voterProxy', voterProxy.address);

    bnbtConfig.voterProxy = voterProxy.address;
    fs.writeFileSync('./bnb.json', JSON.stringify(bnbtConfig), {encoding: 'utf8'});

    console.log('deployFirstStage');
    const contracts = await deployFirstStage(
        hre,
        deployer,
        { voterProxy, weth, masterWombat, crv, pool },
        { vestingMultisig,  treasuryMultisig, daoMultisig },
        {
            cvxName: "Wombex Token",
            cvxSymbol: "WMX",
            vlCvxName: "Vote Locked Wombex Token",
            vlCvxSymbol: "vlWMX",
            cvxCrvName: "Wombex WOM",
            cvxCrvSymbol: "wmxWom",
            tokenFactoryNamePostfix: " Wombex Deposit Token",
        },
        bnbtConfig,
        true,
        waitForBlocks,
    );

    [
        'cvx', 'minter', 'booster', 'boosterOwner', 'arbitratorVault', 'cvxCrv', 'cvxCrvRewards', 'initialCvxCrvStaking',
        'crvDepositor', 'cvxLocker', 'cvxStakingProxy', 'vestedEscrows', 'drops', 'lbpBpt', 'balLiquidityProvider',
        'penaltyForwarder', 'extraRewardsDistributor', 'claimZap', 'feeCollector', 'poolDepositor'
    ].map(name => {
        if (!contracts[name]) {
            return;
        }
        if (contracts[name].address) {
            bnbtConfig[name] = contracts[name].address;
        } else {
            bnbtConfig[name] = contracts[name].map(c => c.address);
        }
    });
    fs.writeFileSync('./bnb.json', JSON.stringify(bnbtConfig), {encoding: 'utf8'});
});

task("bnb:all-distro-tokens").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const bnbtConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const masterWombat = MasterWombatV2__factory.connect(bnbtConfig.masterWombat, deployer);

    const wbnb = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    console.log('wom', bnbtConfig.wom, {cvxCrvRewards: bnbtConfig.cvxCrvRewards, cvxStakingProxy: bnbtConfig.cvxStakingProxy});

    let bonusRewardTokens = [];
    const poolLength = await masterWombat.poolLength().then(l => parseInt(l.toString()));
    for (let i = 0; i < poolLength; i++) {
        const {rewarder} = await masterWombat.poolInfo(i);
        if (rewarder !== ZERO_ADDRESS) {
            const rewarderContract = await IMasterWombatRewarder__factory.connect(rewarder, deployer);
            bonusRewardTokens = bonusRewardTokens.concat(await rewarderContract.rewardTokens())
        }
    }
    let printed = {};
    bonusRewardTokens.forEach(rt => {
        if (rt === ZERO_ADDRESS) {
            rt = wbnb;
        }
        if (printed[rt.toLowerCase()]) {
            return;
        }
        console.log('bonus token', rt, {cvxCrvRewards: bnbtConfig.cvxCrvRewards, cvxLocker: bnbtConfig.cvxLocker});

        printed[rt.toLowerCase()] = true;
    })
});

task("deploy-bootstrap:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const args = [
        bnbConfig.cvxCrv,
        bnbConfig.cvx,
        treasuryMultisig,
        bnbConfig.cvxLocker,
        bnbConfig.penaltyForwarder,
        1800
    ];
    fs.writeFileSync('./args/bootstrap.js', 'module.exports = ' + JSON.stringify(args));

    const bootstrap = await deployContract<WmxRewardPool>(
        hre,
        new WmxRewardPool__factory(deployer),
        "WmxRewardPool",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('bootstrap', bootstrap.address);
});

task("deploy-airdrop:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));
    const treeList = JSON.parse(fs.readFileSync('./tasks/data/airdrop.js', {encoding: 'utf8'}));

    const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const treeObj = {};
    treeList.forEach(i => {
        treeObj[i.holder_address.toLowerCase()] = simpleToExactAmount(i.wmx_amount).toString();
    });

    fs.writeFileSync('./args/airdropObj.json', JSON.stringify(treeObj));

    const tree = createTreeWithAccounts(treeObj);

    const treeProof = {};
    treeList.forEach(i => {
        treeProof[i.holder_address.toLowerCase()] = getAccountBalanceProof(tree, i.holder_address, simpleToExactAmount(i.wmx_amount)).toString();
    });
    fs.writeFileSync('./args/airdropProof.json', JSON.stringify(treeProof));

    const args = [
        treasuryMultisig,
        tree.getHexRoot(),
        bnbConfig.cvx,
        bnbConfig.cvxLocker,
        1800,
        ONE_DAY.mul(15),
    ];
    fs.writeFileSync('./args/airdrop.js', 'module.exports = ' + JSON.stringify(args));

    const airdrop = await deployContract<WmxMerkleDrop>(
        hre,
        new WmxMerkleDrop__factory(deployer),
        "WmxMerkleDrop",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('airdrop', airdrop.address);
});

task("deploy-escrow:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const bnbtConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const args = [
        bnbtConfig.cvx,
        treasuryMultisig,
        bnbtConfig.cvxLocker,
        '1666302008',
        '1729374008'
    ];
    fs.writeFileSync('./args/escrow.js', 'module.exports = ' + JSON.stringify(args));

    const escrow = await deployContract<WmxVestedEscrowLockOnly>(
        hre,
        new WmxVestedEscrowLockOnly__factory(deployer),
        "WmxVestedEscrowLockOnly",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('escrow', escrow.address);
});


task("deploy-migrators:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    // const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const newBoosterArgs = [bnbConfig.voterProxy, bnbConfig.cvx, bnbConfig.wom, bnbConfig.weth, 2000, 15000];
    fs.writeFileSync('./args/booster.js', 'module.exports = ' + JSON.stringify(newBoosterArgs));

    const newBooster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        newBoosterArgs,
        {},
        true,
    );

    const rewardFactoryArgs = [newBooster.address, bnbConfig.wom];
    fs.writeFileSync('./args/rewardFactory.js', 'module.exports = ' + JSON.stringify(rewardFactoryArgs));
    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        rewardFactoryArgs,
        {},
        true,
    );

    const tokenFactoryNamePostfix = ' Wombex Deposit Token';
    const cvxSymbol = 'WMX';
    const tokenFactoryArgs = [newBooster.address, tokenFactoryNamePostfix, cvxSymbol.toLowerCase()];
    fs.writeFileSync('./args/tokenFactory.js', 'module.exports = ' + JSON.stringify(tokenFactoryArgs));
    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        tokenFactoryArgs,
        {},
        true,
    );

    console.log('deployContract BoosterMigrator');
    const boosterMigratorArgs = [bnbConfig.booster, newBooster.address, rewardFactory.address, tokenFactory.address, bnbConfig.weth];
    fs.writeFileSync('./args/boosterMigrator.js', 'module.exports = ' + JSON.stringify(boosterMigratorArgs));
    const boosterMigrator = await deployContract<BoosterMigrator>(
        hre,
        new BoosterMigrator__factory(deployer),
        "BoosterMigrator",
        boosterMigratorArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('boosterMigrator', boosterMigrator.address);

    await newBooster.setOwner(boosterMigrator.address).then(tx => tx.wait(1));
    await newBooster.setPoolManager(boosterMigrator.address).then(tx => tx.wait(1));

    console.log('deployContract DepositorMigrator');
    const depositorMigratorArgs = [bnbConfig.crvDepositor, ['0xD684e0090bD4E11246c0F4d0aeFFEbd2aE252828'], [5]];
    fs.writeFileSync('./args/depositorMigrator.js', 'module.exports = ' + JSON.stringify(depositorMigratorArgs));
    const depositorMigrator = await deployContract<DepositorMigrator>(
        hre,
        new DepositorMigrator__factory(deployer),
        "DepositorMigrator",
        depositorMigratorArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('depositorMigrator', depositorMigrator.address);

    const poolDepositorArgs = [bnbConfig.weth, newBooster.address, bnbConfig.masterWombat];
    fs.writeFileSync('./args/poolDepositor.js', 'module.exports = ' + JSON.stringify(poolDepositorArgs));
    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        poolDepositorArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('poolDepositor', poolDepositor.address);
});

