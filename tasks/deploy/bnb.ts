import {task} from "hardhat/config";
import {TaskArguments} from "hardhat/types";
import {getSigner} from "../utils";
import {deployContract} from "./../utils/deploy-utils";
import {deployFirstStage} from "../../scripts/deploySystem";
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
    ExtraRewardsDistributorProxy,
    ExtraRewardsDistributorProxy__factory,
    PoolDepositor,
    PoolDepositor__factory,
    Asset__factory,
    WomSwapDepositor,
    WomSwapDepositor__factory,
    WomStakingProxy,
    WomStakingProxy__factory,
    LpVestedEscrow__factory,
    LpVestedEscrow,
    WombexLensUI,
    WombexLensUI__factory,
    BoosterEarmark,
    BoosterEarmark__factory,
    WmxRewardPoolFactory__factory,
    WmxRewardPoolFactory,
    WmxRewardPoolLens__factory,
    WmxRewardPoolLens,
    GaugeVoting,
    GaugeVoting__factory,
    GaugeVotingLens__factory,
    GaugeVotingLens,
    BribesRewardFactory,
    BribesRewardFactory__factory,
    BribesTokenFactory__factory,
    BribesTokenFactory,
    DepositToken,
    DepositToken__factory, BaseRewardPoolLocked, BaseRewardPoolLocked__factory, MultiStaker__factory, MultiStaker,
    EarmarkRewardsLens__factory, EarmarkRewardsLens
} from "../../types/generated";
import {
    createTreeWithAccounts,
    getAccountBalanceProof,
    ONE_DAY,
    simpleToExactAmount,
    ZERO_ADDRESS
} from "../../test-utils";
import assert from "assert";

const {approvePoolDepositor} = require('../helpers');

const fs = require('fs');
const ethers = require('ethers');
const _ = require('lodash');
const pIteration = require('p-iteration');

const forking = false;
const waitForBlocks = forking ? undefined : 1;

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
        {voterProxy, weth, masterWombat, crv, pool},
        {vestingMultisig, treasuryMultisig, daoMultisig},
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
    console.log('wom', bnbtConfig.wom, {
        cvxCrvRewards: bnbtConfig.cvxCrvRewards,
        cvxStakingProxy: bnbtConfig.cvxStakingProxy
    });

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
        '1667980800',
        '1731052800'
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

task("deploy-lp-escrow:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';

    const args = [
        '0xe86eaAD81C32ffbb88B7ec9B325C8f75C8c9f1Ab',
        treasuryMultisig,
        '1687996800',
        '1688083200'
    ];
    fs.writeFileSync('./args/lp-escrow.js', 'module.exports = ' + JSON.stringify(args));

    const lpEscrow = await deployContract<LpVestedEscrow>(
        hre,
        new LpVestedEscrow__factory(deployer),
        "LpVestedEscrow",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('lp escrow', lpEscrow.address);
});

task("deploy-zap:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const bnbtConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));
    const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';

    const args = [
        bnbtConfig.token,
        bnbtConfig.cvx,
        bnbtConfig.cvxCrv,
        bnbtConfig.crvDepositor,
        bnbtConfig.cvxCrvRewards,
        bnbtConfig.extraRewardsDistributor,
        bnbtConfig.womSwapDepositor,
        bnbtConfig.cvxLocker,
        treasuryMultisig
    ];
    console.log('args', args);
    fs.writeFileSync('./args/zap.js', 'module.exports = ' + JSON.stringify(args));

    const zap = await deployContract<WmxClaimZap>(
        hre,
        new WmxClaimZap__factory(deployer),
        "WmxClaimZap",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('zap', zap.address);
});

task("deploy-erdp:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const args = [
        bnbConfig.booster,
        bnbConfig.extraRewardsDistributor
    ];
    fs.writeFileSync('./args/extraRewardsDistributorProxy.js', 'module.exports = ' + JSON.stringify(args));

    const extraRewardsDistributor = await deployContract<ExtraRewardsDistributorProxy>(
        hre,
        new ExtraRewardsDistributorProxy__factory(deployer),
        "ExtraRewardsDistributorProxy",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('extraRewardsDistributorProxy', extraRewardsDistributor.address);
});

task("deploy-pool-depositor:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const args = [
        bnbConfig.weth,
        bnbConfig.booster,
        bnbConfig.masterWombat
    ];
    fs.writeFileSync('./args/poolDepositor.js', 'module.exports = ' + JSON.stringify(args));

    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('poolDepositor', poolDepositor.address);
    const booster = Booster__factory.connect(bnbConfig.booster, deployer);
    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    await poolDepositor.approveSpendingMultiplePools(Array.from(Array(poolLength).keys())).then(tx => tx.wait());
});

task("deploy-booster-earmark:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const network = process.env.NETWORK || hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(network === 'bnb' ? 3000000000 : 100000000),
    })) as any;

    const booster = Booster__factory.connect(networkConfig.booster, deployer);
    const oldBoosterEarmark = BoosterEarmark__factory.connect(await booster.earmarkDelegate(), deployer);

    const newBoosterEarmarkArgs = [booster.address, networkConfig.weth];
    fs.writeFileSync('./args/boosterEarmark.js', 'module.exports = ' + JSON.stringify(newBoosterEarmarkArgs));
    const newBoosterEarmark = await deployContract<BoosterEarmark>(
        hre,
        new BoosterEarmark__factory(deployer),
        "BoosterEarmark",
        newBoosterEarmarkArgs,
        {},
        true,
    );
    await newBoosterEarmark.setEarmarkConfig(await oldBoosterEarmark.earmarkIncentive(), await oldBoosterEarmark.earmarkPeriod()).then(tx => tx.wait());
    await newBoosterEarmark.transferOwnership(await oldBoosterEarmark.owner()).then(tx => tx.wait());
    // const tokenDistroLength = await oldBoosterEarmark.distributionByTokenLength(networkConfig.wom).then(r => parseInt(r.toString()));

    // const distros = [], shares = [], callQueues = [];
    // for(let i = 0; i < tokenDistroLength; i++) {
    //     const {distro, share, callQueue} = await oldBoosterEarmark.distributionByTokens(networkConfig.wom, i);
    //     distros.push(distro);
    //     shares.push(share);
    //     callQueues.push(callQueue);
    // }
    // await newBoosterEarmark.updateDistributionByTokens(networkConfig.wom, distros, shares, callQueues).then(tx => tx.wait());

});

task("deploy-migrators:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const network = process.env.NETWORK || hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(network === 'bnb' ? 3000000000 : 100000000),
    })) as any;

    const booster = Booster__factory.connect(networkConfig.booster, deployer);
    const boosterEarmarkAddress = await booster.earmarkDelegate();

    const newBoosterArgs = [networkConfig.voterProxy, ZERO_ADDRESS, networkConfig.cvx, networkConfig.wom, networkConfig.weth, 1500, 15000];
    fs.writeFileSync('./args/booster.js', 'module.exports = ' + JSON.stringify(newBoosterArgs));
    //
    // const newBooster = Booster__factory.connect('0xA04b7cd20e916bd3a2BE874c2B75a596284AA201', deployer);
    // const newBoosterEarmark = BoosterEarmark__factory.connect('0x8ae15034cB19F6677f666EabfBB038611e6Bf1F7', deployer);
    // const rewardFactory = RewardFactory__factory.connect('0xfaAc2A5C4788b3D1b520493CE5b808C69EBd80a2', deployer);
    // const tokenFactory = RewardFactory__factory.connect('0x5959Edad2060C79ED25eF002EDB5ef8aBBd431Af', deployer);

    const newBooster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        newBoosterArgs,
        {},
        true,
    );

    const newBoosterEarmarkArgs = [newBooster.address, networkConfig.weth];
    fs.writeFileSync('./args/boosterEarmark.js', 'module.exports = ' + JSON.stringify(newBoosterEarmarkArgs));
    const newBoosterEarmark = await deployContract<BoosterEarmark>(
        hre,
        new BoosterEarmark__factory(deployer),
        "BoosterEarmark",
        newBoosterEarmarkArgs,
        {},
        true,
    );

    await newBooster.setEarmarkDelegate(newBoosterEarmark.address).then(tx => tx.wait());

    const rewardFactoryArgs = [newBooster.address, networkConfig.wom];
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
    const boosterMigratorArgs = [networkConfig.booster, boosterEarmarkAddress, newBooster.address, rewardFactory.address, tokenFactory.address, networkConfig.weth];
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
    await newBooster.setPoolManager(newBoosterEarmark.address).then(tx => tx.wait(1));
    await newBoosterEarmark.transferOwnership(boosterMigrator.address).then(tx => tx.wait(1));

    const poolDepositorArgs = [networkConfig.weth, newBooster.address, networkConfig.masterWombat];
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

    const masterWombat = MasterWombatV2__factory.connect(networkConfig.masterWombat, deployer);
    await approvePoolDepositor(poolDepositor, deployer);
});

task("deploy-wom-swap-depositor:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const args = [bnbConfig.wom, bnbConfig.cvxCrv, '0xeEB5a751E0F5231Fc21c7415c4A4c6764f67ce2e', '0x19609b03c976cca288fbdae5c21d4290e9a4add7'];
    fs.writeFileSync('./args/womSwapDepositor.js', 'module.exports = ' + JSON.stringify(args));
    const womSwapDepositor = await deployContract<WomSwapDepositor>(
        hre,
        new WomSwapDepositor__factory(deployer),
        "WomSwapDepositor",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('womSwapDepositor', womSwapDepositor.address);
});

task("pool-depositor:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const poolDepositorArgs = [bnbConfig.weth, bnbConfig.booster, bnbConfig.masterWombat];
    fs.writeFileSync('./args/poolDepositor.js', 'module.exports = ' + JSON.stringify(poolDepositorArgs));
    // const poolDepositor = PoolDepositor__factory.connect(bnbConfig.poolDepositor, deployer);
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
    const masterWombat = MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);
    await approvePoolDepositor(poolDepositor, deployer);
});

function csvToAccountsAndAmounts(csvName) {
    const bnbLockCsv = fs.readFileSync('./tasks/data/' + csvName, {encoding: 'utf8'});
    const lines = bnbLockCsv.split(/\r?\n/);
    const accounts = [];
    const amounts = [];
    lines.forEach(line => {
        accounts.push(line.split(',')[0]);
        amounts.push(simpleToExactAmount(line.split(',')[1]));
    });
    return {accounts, amounts};
}

task("reward-pool-locked:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const {accounts: bnbAccounts, amounts: bnbAmounts} = csvToAccountsAndAmounts('BNB_lock_v1.csv');
    const {accounts: ankrBnbAccounts, amounts: ankrBnbAmounts} = csvToAccountsAndAmounts('ankrBNB_lock_v1.csv');

    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(3000000000),
    })) as any;

    fs.writeFileSync('./args/multiStaker.js', 'module.exports = ' + JSON.stringify([]));
    const multiStaker = await deployContract<MultiStaker>(
        hre,
        new MultiStaker__factory(deployer),
        "MultiStaker",
        [],
        {},
        true,
        waitForBlocks,
    );
    console.log('multiStaker', multiStaker.address);

    const bnbLpAddress = '0x0e99fBfD04c255124A168c6Ae68CcE3c7dCC5760';
    const ankrBnbLpAddress = '0xB6D83F199b361403BDa2c44712a77F55E7f8855f';
    const booster = Booster__factory.connect(bnbConfig.booster, deployer);
    const tokenFactory = TokenFactory__factory.connect(await booster.tokenFactory(), deployer);
    const namePostfix = await tokenFactory.namePostfix();
    const symbolPrefix = await tokenFactory.symbolPrefix();

    const bnbStakingToken = await deployContract<DepositToken>(
        hre,
        new DepositToken__factory(deployer),
        "DepositToken",
        [bnbConfig.booster, bnbLpAddress, namePostfix, symbolPrefix],
        {},
        true,
        waitForBlocks,
    );
    const ankrBnbStakingToken = await deployContract<DepositToken>(
        hre,
        new DepositToken__factory(deployer),
        "DepositToken",
        [bnbConfig.booster, ankrBnbLpAddress, namePostfix, symbolPrefix],
        {},
        true,
        waitForBlocks,
    );

    const bnbPoolLockedArgs = ['0', bnbStakingToken.address, bnbConfig.wom, bnbConfig.booster, bnbLpAddress, deployerAddress, 1712639772];
    fs.writeFileSync('./args/bnbPoolLocked.js', 'module.exports = ' + JSON.stringify(bnbPoolLockedArgs));
    const bnbPool = await deployContract<BaseRewardPoolLocked>(
        hre,
        new BaseRewardPoolLocked__factory(deployer),
        "BaseRewardPoolLocked",
        bnbPoolLockedArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('bnbPool', bnbPool.address);
    await bnbPool.setLock(bnbAccounts, bnbAmounts, false).then(tx => tx.wait());

    const ankrBnbPoolLockedArgs = ['0', ankrBnbStakingToken.address, bnbConfig.wom, bnbConfig.booster, ankrBnbLpAddress, deployerAddress, 1712639772];
    const ankrBnbPool = await deployContract<BaseRewardPoolLocked>(
        hre,
        new BaseRewardPoolLocked__factory(deployer),
        "BaseRewardPoolLocked",
        ankrBnbPoolLockedArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('ankrBnbPool', ankrBnbPool.address);
    await ankrBnbPool.setLock(ankrBnbAccounts, ankrBnbAmounts, false).then(tx => tx.wait());
});

task("reset-pool-locked:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const {accounts: oldBnbAccounts} = csvToAccountsAndAmounts('BNB_lock_v1.csv');
    const {accounts: oldAnkrBnbAccounts} = csvToAccountsAndAmounts('ankrBNB_lock_v1.csv');

    const {accounts: bnbAccounts, amounts: bnbAmounts} = csvToAccountsAndAmounts('BNB_lock_v2.csv');
    const {accounts: ankrBnbAccounts, amounts: ankrBnbAmounts} = csvToAccountsAndAmounts('ankrBNB_lock_v2.csv');

    const deployer = await getSigner(hre);
    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(3000000000),
    })) as any;

    const deployedBnbPool = BaseRewardPoolLocked__factory.connect('0x383A773c9bcaD46E94010D8bb704FF3E450701Ba', deployer);
    const deployedAnkrBnbPool = BaseRewardPoolLocked__factory.connect('0x8fC093fe17C7b74970277D66Cb85232D3041AdE6', deployer);

    await deployedBnbPool.setLock(oldBnbAccounts, oldBnbAccounts.map(() => '0'), false).then(tx => tx.wait());
    await deployedAnkrBnbPool.setLock(oldAnkrBnbAccounts, oldAnkrBnbAccounts.map(() => '0'), false).then(tx => tx.wait());

    await deployedBnbPool.setLock(bnbAccounts, bnbAmounts, false).then(tx => tx.wait());
    await deployedAnkrBnbPool.setLock(ankrBnbAccounts, ankrBnbAmounts, false).then(tx => tx.wait());
});

task("check-pool-locked:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const {accounts: oldBnbAccounts} = csvToAccountsAndAmounts('BNB_lock_v1.csv');
    const {accounts: oldAnkrBnbAccounts} = csvToAccountsAndAmounts('ankrBNB_lock_v1.csv');

    const {accounts: bnbAccounts, amounts: bnbAmounts} = csvToAccountsAndAmounts('BNB_lock_v2.csv');
    const {accounts: ankrBnbAccounts, amounts: ankrBnbAmounts} = csvToAccountsAndAmounts('ankrBNB_lock_v2.csv');

    const signer = await getSigner(hre);
    const deployedBnbPool = BaseRewardPoolLocked__factory.connect('0x383A773c9bcaD46E94010D8bb704FF3E450701Ba', signer);
    const deployedAnkrBnbPool = BaseRewardPoolLocked__factory.connect('0x8fC093fe17C7b74970277D66Cb85232D3041AdE6', signer);

    await pIteration.forEachSeries([bnbAccounts, ankrBnbAccounts], (accounts, accIndex) => {
        const amounts = accIndex ? ankrBnbAmounts : bnbAmounts;
        return pIteration.forEachSeries(_.chunk(accounts, 10), (chunk, i) => {
            return pIteration.forEach(chunk, async (address, j) => {
                const index = i * 10 + j;
                const balance = await (accIndex ? deployedAnkrBnbPool : deployedBnbPool).lockedBalance(address).then(r => r.toString());
                console.log('\n' + address);
                console.log(accIndex + ' amount', amounts[index].toString());
                console.log('balance ', balance);
                assert(amounts[index].toString() === balance);
            });
        });
    })
    console.log('v1 bnbAccounts not persist in v2', oldBnbAccounts.filter(acc => bnbAccounts.indexOf(acc) === -1));
    console.log('v1 ankrBnbAccounts not persist in v2', oldAnkrBnbAccounts.filter(acc => ankrBnbAccounts.indexOf(acc) === -1));
});

task("deploy-lens:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(3000000000),
    })) as any;


    const args = [
        '0x10ED43C718714eb63d5aA57B78B54704E256024E', //_UNISWAP_ROUTER
        ZERO_ADDRESS, //_UNISWAP_V3_ROUTER
        '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', //_MAIN_STABLE_TOKEN
        '0xAD6742A35fB341A9Cc6ad674738Dd8da98b94Fb1', //_WOM_TOKEN
        '0xa75d9ca2a0a1D547409D82e1B06618EC284A2CeD', //_WMX_TOKEN
        '0xa75d9ca2a0a1D547409D82e1B06618EC284A2CeD', //_WMX_MINTER
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', //_WETH_TOKEN
        '0x0415023846Ff1C6016c4d9621de12b24B2402979', //_WMX_WOM_TOKEN
        '0xeEB5a751E0F5231Fc21c7415c4A4c6764f67ce2e'  //_WOM_WMX_POOL
    ];
    fs.writeFileSync('./args/lens.js', 'module.exports = ' + JSON.stringify(args));

    // const lens = WombexLensUI__factory.connect('0xA557e3D026eA201Eb3B0e04A64d93761ca2cC42b', deployer);
    const lens = await deployContract<WombexLensUI>(
        hre,
        new WombexLensUI__factory(deployer),
        "WombexLensUI",
        args,
        {},
        true,
        waitForBlocks,
    );
    console.log('lens', lens.address);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await lens.setUsdStableTokens(['0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', '0x55d398326f99059fF775485246999027B3197955', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', '0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5', '0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40', '0x14016E85a25aeb13065688cAFB43044C2ef86784', '0x4268B8F0B87b6Eae5d897996E6b845ddbD99Adf3', '0xFa4BA88Cf97e282c505BEa095297786c16070129', '0x0A3BB08b3a15A19b4De82F8AcFc862606FB69A2D', '0xd17479997F34dd9156Deef8F95A52D81D265be9c', '0xe80772eaf6e2e18b651f160bc9158b2a5cafca65', '0xB0B195aEFA3650A6908f15CdaC7D92F8a5791B0B'], true).then(tx => tx.wait());
    await lens.setPoolsForToken(['0x312Bc7eAAF93f1C60Dc5AfC115FcCDE161055fb0', '0x0520451B19AD0bb00eD35ef391086A692CFC74B2', '0x48f6A8a0158031BaF8ce3e45344518f1e69f2A14', '0x8ad47d7ab304272322513eE63665906b64a49dA2', '0x277E777F7687239B092c8845D4d2cd083a33C903'], '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x4dFa92842d05a790252A7f374323b9C86D7b7E12'], '0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x05f727876d7C123B9Bb41507251E2Afd81EAD09A'], '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x8df1126de13bcfef999556899F469d64021adBae', '0xB0219A90EF6A24a237bC038f7B7a6eAc5e01edB0'], '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x2Ea772346486972E7690219c190dAdDa40Ac5dA4'], '0x2170Ed0880ac9A755fd29B2688956BD959F933F8').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x8b892b6Ea1d0e5B29b719d6Bd6eb9354f1cDE060'], '0x2170Ed0880ac9A755fd29B2688956BD959F933F8').then(tx => tx.wait());
    await lens.setTokensToRouter(['0x3BC5AC0dFdC871B365d159f728dd1B9A0B5481E8', '0xe48A3d7d0Bc88d552f730B62c006bC925eadB9eE'], '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7').then(tx => tx.wait());
    await lens.setTokenSwapThroughToken(['0xf307910A4c7bbc79691fD374889b36d8531B08e3','0x2170Ed0880ac9A755fd29B2688956BD959F933F8'], '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c').then(tx => tx.wait());
    await lens.setTokensTargetStable(['0xe48A3d7d0Bc88d552f730B62c006bC925eadB9eE'], '0x90c97f71e18723b0cf0dfa30ee176ab653e89f40').then(tx => tx.wait());

    const gaugeVotingLensArgs = [
        '0x3E4Bb4C5862ff6739177E3770b914534a7378CdE',
        lens.address,
    ];
    fs.writeFileSync('./args/gaugeVotingLens.js', 'module.exports = ' + JSON.stringify(gaugeVotingLensArgs));
    const gaugeVotingLens = await deployContract<GaugeVotingLens>(
        hre,
        new GaugeVotingLens__factory(deployer),
        "GaugeVotingLens",
        gaugeVotingLensArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('gaugeVotingLens', gaugeVotingLens.address);

    // console.log('getProtocolStats', await lens.callStatic.getProtocolStats('0x561050FFB188420D2605714F84EdA714DA58da69'));
    // console.log('getTotalRevenue', await lens.callStatic.getTotalRevenue('0x561050FFB188420D2605714F84EdA714DA58da69'));
    // const booster = Booster__factory.connect('0x561050FFB188420D2605714F84EdA714DA58da69', deployer);
    // const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    // for (let i = 0; i < poolLength; i++) {
    //     const {crvRewards} = await booster.poolInfo(i);
    //     console.log(i, 'getPoolRewardsInUsd', await lens.callStatic.getPoolRewardsInUsd(crvRewards).then(r => ethers.utils.formatEther(r)));
    // }
});

task("wom-staking-proxy:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const wmxStakingProxyArgs = [
        bnbConfig.wom,
        bnbConfig.cvx,
        bnbConfig.cvxCrv,
        bnbConfig.crvDepositor,
        bnbConfig.cvxLocker,
    ];
    fs.writeFileSync('./args/wmxStakingProxy.js', 'module.exports = ' + JSON.stringify(wmxStakingProxyArgs));
    const wmxStakingProxy = await deployContract<WomStakingProxy>(
        hre,
        new WomStakingProxy__factory(deployer),
        "WomStakingProxy",
        wmxStakingProxyArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('wmxStakingProxy', wmxStakingProxy.address);
    await wmxStakingProxy.setSwapConfig(bnbConfig.womSwapDepositorAddress, 3000).then(tx => tx.wait(1));
    await wmxStakingProxy.transferOwnership(treasuryMultisig).then(tx => tx.wait(1));
});

task("wmx-reward-pool-factory:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const daoMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const WmxRewardPoolFactoryArgs = [
        bnbConfig.cvxCrv,
        bnbConfig.cvx,
        daoMultisig,
        bnbConfig.cvxLocker,
        [bnbConfig.crvDepositor]
    ];
    fs.writeFileSync('./args/wmxRewardPoolFactory.js', 'module.exports = ' + JSON.stringify(WmxRewardPoolFactoryArgs));
    const wmxRewardPoolFactory = await deployContract<WmxRewardPoolFactory>(
        hre,
        new WmxRewardPoolFactory__factory(deployer),
        "WmxRewardPoolFactory",
        WmxRewardPoolFactoryArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('wmxRewardPoolFactory', wmxRewardPoolFactory.address);
});

task("wmx-reward-pool-lens:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const WmxRewardPoolLensArgs = ['0x2B37c10224c8d5432e0C5f7f0ea92b70F82E877c'];
    fs.writeFileSync('./args/wmxRewardPoolLens.js', 'module.exports = ' + JSON.stringify(WmxRewardPoolLensArgs));
    const wmxRewardPoolLens = await deployContract<WmxRewardPoolLens>(
        hre,
        new WmxRewardPoolLens__factory(deployer),
        "WmxRewardPoolLens",
        WmxRewardPoolLensArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('wmxRewardPoolLens', wmxRewardPoolLens.address);
});

task("earmark-rewards-lens:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const network = process.env.NETWORK || hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(network === 'bnb' ? 3000000000 : 100000000),
    })) as any;

    const earmarkRewardsLensArgs = [networkConfig.voterProxy, 5];
    fs.writeFileSync('./args/earmarkRewardsLens.js', 'module.exports = ' + JSON.stringify(earmarkRewardsLensArgs));
    const earmarkRewardsLens = await deployContract<EarmarkRewardsLens>(
        hre,
        new EarmarkRewardsLens__factory(deployer),
        "EarmarkRewardsLens",
        earmarkRewardsLensArgs,
        {},
        true,
        waitForBlocks,
    );
    // const earmarkRewardsLens = EarmarkRewardsLens__factory.connect('0xb76591973f0649a1978D7Caf3B93f7aa8Da5E162', deployer);
    // console.log('earmarkRewardsLens', earmarkRewardsLens.address);
    // const {tokensSymbols, diffBalances} = await earmarkRewardsLens.getRewards();
    // tokensSymbols.map((symbol, index) => {
    //     console.log(symbol, diffBalances[index]);
    // })
});

task("gauge-voting:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';
    const gaugeVotingArgs = [
        bnbConfig.cvxLocker,
        bnbConfig.booster,
        '0x04d4e1c1f3d6539071b6d3849fdaed04d48d563d',
    ];
    fs.writeFileSync('./args/gaugeVoting.js', 'module.exports = ' + JSON.stringify(gaugeVotingArgs));
    const gaugeVoting = await deployContract<GaugeVoting>(
        hre,
        new GaugeVoting__factory(deployer),
        "GaugeVoting",
        gaugeVotingArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('gaugeVoting', gaugeVoting.address);

    const gaugeVotingLensArgs = [
        gaugeVoting.address,
    ];
    fs.writeFileSync('./args/gaugeVotingLens.js', 'module.exports = ' + JSON.stringify(gaugeVotingLensArgs));
    const gaugeVotingLens = await deployContract<GaugeVotingLens>(
        hre,
        new GaugeVotingLens__factory(deployer),
        "GaugeVotingLens",
        gaugeVotingLensArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('gaugeVotingLens', gaugeVotingLens.address);

    const bribesRewardFactoryArgs = [
        gaugeVoting.address,
    ];
    fs.writeFileSync('./args/bribesRewardFactory.js', 'module.exports = ' + JSON.stringify(bribesRewardFactoryArgs));
    const bribesRewardFactory = await deployContract<BribesRewardFactory>(
        hre,
        new BribesRewardFactory__factory(deployer),
        "BribesRewardFactory",
        bribesRewardFactoryArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('bribesRewardFactory', bribesRewardFactory.address);

    const bribesTokenFactoryArgs = [
        gaugeVoting.address,
    ];
    fs.writeFileSync('./args/bribesTokenFactory.js', 'module.exports = ' + JSON.stringify(bribesTokenFactoryArgs));
    const bribesTokenFactory = await deployContract<BribesTokenFactory>(
        hre,
        new BribesTokenFactory__factory(deployer),
        "BribesTokenFactory",
        bribesTokenFactoryArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('bribesTokenFactory', bribesTokenFactory.address);

    await gaugeVoting.setFactories(bribesTokenFactory.address, bribesRewardFactory.address, ZERO_ADDRESS).then(tx => tx.wait());
    await gaugeVoting.transferOwnership(treasuryMultisig).then(tx => tx.wait());
});

task("gauge-voting-migrate:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(3000000000),
    })) as any;

    const networkConfig = JSON.parse(fs.readFileSync('./' + (process.env.NETWORK || hre.network.name) + '.json', {encoding: 'utf8'}));

    const oldGaugeVoting = GaugeVoting__factory.connect(networkConfig.gaugeVoting, deployer);
    const daoMultisig = await oldGaugeVoting.owner();

    const lpTokensToMigrate = ['0x88bEb144352BD3109c79076202Fac2bcEAb87117', '0xbd459E33307A4ae92fFFCb45C6893084CFC273B1', '0x8Df8b50B73849f0433EE3314BD956e624e67b3ce'];
    const rewards = [];
    const lpTokens = await oldGaugeVoting.getLpTokensAdded();
    console.log('lpTokens.length', lpTokens.length);
    for (let i = 0; i < lpTokens.length; i++) {
        if (lpTokensToMigrate.includes(lpTokens[i])) {
            continue;
        }
        rewards.push(await oldGaugeVoting.lpTokenRewards(lpTokens[i]));
    }
    console.log('rewards.length', rewards.length);

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
    await newGaugeVoting.registerCreatedLpTokens(rewards).then(tx => tx.wait());

    console.log('lpTokensToMigrate', lpTokensToMigrate);
    await newGaugeVoting.registerLpTokens(lpTokensToMigrate).then(tx => tx.wait());

    const lpTokensToDeactivate = ['0xf9bdc872d75f76b946e0770f96851b1f2f653cac', '0x3c42e4f84573ab8c88c8e479b7dc38a7e678d688'];
    console.log('lpTokensToDeactivate', lpTokensToDeactivate);
    for (let i = 0; i < lpTokensToDeactivate.length; i++) {
        await newGaugeVoting.setLpTokenStatus(lpTokensToDeactivate[i], '1').then(tx => tx.wait());
    }

    await newGaugeVoting.approveRewards().then(tx => tx.wait());
    await newGaugeVoting.transferOwnership(daoMultisig).then(tx => tx.wait());
});
