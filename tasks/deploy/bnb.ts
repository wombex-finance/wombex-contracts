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
    WomSwapDepositor, WomSwapDepositor__factory,
    WomStakingProxy, WomStakingProxy__factory,
    LpVestedEscrow__factory, LpVestedEscrow,
    WombexLensUI, WombexLensUI__factory,
    BoosterEarmark,
    BoosterEarmark__factory,
    WmxRewardPoolFactory__factory,
    WmxRewardPoolFactory,
    WmxRewardPoolLens__factory, WmxRewardPoolLens
} from "../../types/generated";
import {
    createTreeWithAccounts,
    getAccountBalanceProof,
    ONE_DAY,
    simpleToExactAmount,
    ZERO_ADDRESS
} from "../../test-utils";

const {approvePoolDepositor} = require('../helpers');

const fs = require('fs');
const ethers = require('ethers');
const _ = require('lodash');

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

    const masterWombat = MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);

    const tokensByPool = {};
    const poolLength = await masterWombat.poolLength().then(l => parseInt(l.toString()));
    for (let i = 0; i < poolLength; i++) {
        const {lpToken} = await masterWombat.poolInfo(i);
        const asset = Asset__factory.connect(lpToken, deployer);
        const [pool, underlying] = await Promise.all([
            asset.pool(),
            asset.underlyingToken(),
        ]);
        if (!tokensByPool[pool]) {
            tokensByPool[pool] = [];
        }
        tokensByPool[pool] = tokensByPool[pool].concat([underlying, lpToken]);
    }

    const pools = []
    _.forEach(tokensByPool, (tokens, pool) => {
        pools.push({
            address: pool,
            tokens: _.uniq(tokens)
        })
    })

    for (let i = 0; i < pools.length; i++) {
        await poolDepositor.approveSpendingByPool(pools[i].tokens, pools[i].address);
        await poolDepositor.approveSpendingByPool(pools[i].tokens, bnbConfig.booster);
    }
});


task("deploy-migrators:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    // const treasuryMultisig = '0x35D32110d9a6f02d403061C851618756B3bC597F';

    const newBoosterArgs = [bnbConfig.voterProxy, bnbConfig.cvx, bnbConfig.wom, bnbConfig.weth, 1500, 15000];
    fs.writeFileSync('./args/booster.js', 'module.exports = ' + JSON.stringify(newBoosterArgs));

    const newBooster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        newBoosterArgs,
        {},
        true,
    );

    const newBoosterEarmarkArgs = [newBooster.address, bnbConfig.weth];
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
    // const newBooster = Booster__factory.connect('0x561050ffb188420d2605714f84eda714da58da69', deployer);
    // const newBoosterEarmark = BoosterEarmark__factory.connect('0x9bdcb245234b4d0dfa998d0f8da72e5ccd0f9df4', deployer);

    const rewardFactoryArgs = [newBooster.address, bnbConfig.wom];
    fs.writeFileSync('./args/rewardFactory.js', 'module.exports = ' + JSON.stringify(rewardFactoryArgs));
    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        rewardFactoryArgs,
        {},
        true,
    );//0x6d317CF62c55BB96b933fDC637F7e08100628B39

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
    );//0xc20Ae367683Eb5f4FBb2b0ec7912E1c5BA32C2B5

    console.log('deployContract BoosterMigrator');
    const boosterMigratorArgs = [bnbConfig.booster, ZERO_ADDRESS, newBooster.address, rewardFactory.address, tokenFactory.address, bnbConfig.weth];
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

    const masterWombat = MasterWombatV2__factory.connect(bnbConfig.masterWombat, deployer);
    await approvePoolDepositor(masterWombat, poolDepositor, deployer);
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
    await approvePoolDepositor(masterWombat, poolDepositor, deployer);
});

task("deploy-lens:bnb").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    // const bnbtConfig = JSON.parse(fs.readFileSync('./bnb.json', {encoding: 'utf8'}));

    const args = [
    ];
    fs.writeFileSync('./args/lens.js', 'module.exports = ' + JSON.stringify(args));

    // const lens = WombexLensUI__factory.connect('0x49ce4648979238653be2B45b142BE8bD676BF083', deployer);
    const lens = await deployContract<WombexLensUI>(
        hre,
        new WombexLensUI__factory(deployer),
        "WombexLensUI",
        args,
        {},
        true,
        waitForBlocks,
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await lens.setUsdStableTokens(['0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', '0x55d398326f99059fF775485246999027B3197955', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', '0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5', '0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40', '0x14016E85a25aeb13065688cAFB43044C2ef86784', '0x4268B8F0B87b6Eae5d897996E6b845ddbD99Adf3', '0xFa4BA88Cf97e282c505BEa095297786c16070129', '0x0A3BB08b3a15A19b4De82F8AcFc862606FB69A2D', '0xd17479997F34dd9156Deef8F95A52D81D265be9c'], true).then(tx => tx.wait(3));
    await lens.setPoolsForToken(['0x312Bc7eAAF93f1C60Dc5AfC115FcCDE161055fb0', '0x0520451B19AD0bb00eD35ef391086A692CFC74B2', '0x48f6A8a0158031BaF8ce3e45344518f1e69f2A14', '0x8ad47d7ab304272322513eE63665906b64a49dA2', '0x277E777F7687239B092c8845D4d2cd083a33C903'], '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56').then(tx => tx.wait(3));
    await lens.setPoolsForToken(['0x4dFa92842d05a790252A7f374323b9C86D7b7E12'], '0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x05f727876d7C123B9Bb41507251E2Afd81EAD09A'], '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x8df1126de13bcfef999556899F469d64021adBae', '0xB0219A90EF6A24a237bC038f7B7a6eAc5e01edB0'], '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c').then(tx => tx.wait());
    await lens.setPoolsForToken(['0x2Ea772346486972E7690219c190dAdDa40Ac5dA4'], '0x2170Ed0880ac9A755fd29B2688956BD959F933F8').then(tx => tx.wait());
    await lens.setTokensToRouter(['0x3BC5AC0dFdC871B365d159f728dd1B9A0B5481E8'], '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7').then(tx => tx.wait(3));
    await lens.setTokenSwapThroughBnb(['0xf307910A4c7bbc79691fD374889b36d8531B08e3','0x2170Ed0880ac9A755fd29B2688956BD959F933F8'], true).then(tx => tx.wait(3));
    console.log('lens', lens.address);
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
