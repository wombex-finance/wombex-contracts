import { BigNumber as BN, ContractReceipt, Signer } from "ethers";
import {
    ExtraRewardsDistributor,
    WmxClaimZap__factory,
    WmxClaimZap,
    Booster__factory,
    Booster,
    VoterProxy,
    RewardFactory__factory,
    RewardFactory,
    TokenFactory__factory,
    TokenFactory,
    CvxCrvToken__factory,
    CvxCrvToken,
    BaseRewardPool__factory,
    BaseRewardPool,
    WmxLocker,
    WmxLocker__factory,
    WomStakingProxy,
    WomStakingProxy__factory,
    Wmx,
    Wmx__factory,
    WmxMinter,
    WmxMinter__factory,
    WmxPenaltyForwarder__factory,
    WmxPenaltyForwarder,
    ExtraRewardsDistributor__factory,
    WmxRewardPool,
    WmxRewardPool__factory,
    WmxVestedEscrow,
    WmxVestedEscrow__factory,
    WmxMerkleDrop,
    WmxMerkleDrop__factory,
    IMasterWombatRewarder__factory,
    VeWom,
    MasterWombatV2,
    WETH,
    IERC20,
    Pool,
    PoolDepositor,
    PoolDepositor__factory,
    BoosterEarmark,
    BoosterEarmark__factory,
    ReservoirMinter,
    ReservoirMinter__factory,
    ProxyFactory,
    ProxyFactory__factory, WomDepositorV3__factory, WomDepositorV3
} from "../types/generated";
import { deployContract, waitForTx } from "../tasks/utils";
import { ZERO_ADDRESS, ONE_WEEK } from "../test-utils/constants";
import { simpleToExactAmount } from "../test-utils/math";
import { HardhatRuntimeEnvironment } from "hardhat/types";
const {approvePoolDepositor} = require('../tasks/helpers');

interface AirdropData {
    merkleRoot: string;
    startDelay: BN;
    length: BN;
    amount: BN;
}

interface VestingRecipient {
    address: string;
    amount: BN;
}

interface VestingGroup {
    period: BN;
    recipients: VestingRecipient[];
}

interface LBPData {
    tknAmount: BN;
    wethAmount: BN;
    matching: BN;
}
interface DistroList {
    miningRewards: BN;
    lpIncentives: BN;
    cvxCrvBootstrap: BN;
    lbp: LBPData;
    airdrops: AirdropData[];
    immutableVesting: VestingGroup[];
    vesting: VestingGroup[];
}
interface BalancerPoolFactories {
    weightedPool2Tokens: string;
    stablePool: string;
    bootstrappingPool: string;
}
interface ExtSystemConfig {
    authorizerAdapter?: string;
    token: string;
    tokenBpt: string;
    tokenWhale?: string;
    minter: string;
    votingEscrow: string;
    feeDistribution: string;
    gaugeController: string;
    voteOwnership?: string;
    voteParameter?: string;
    gauges?: string[];
    balancerVault: string;
    balancerPoolFactories: BalancerPoolFactories;
    balancerPoolId: string;
    balancerMinOutBps: string;
    weth: string;
    wethWhale?: string;
    treasury?: string;
    keeper?: string;
    staBAL3?: string;
    staBAL3Whale?: string;
    feeToken?: string;
    ldo?: string;
    ldoWhale?: string;
    stEthGaugeLdoDepositor?: string;
}

interface NamingConfig {
    cvxName?: string;
    cvxSymbol?: string;
    vlCvxName: string;
    vlCvxSymbol: string;
    cvxCrvName: string;
    cvxCrvSymbol: string;
    tokenFactoryNamePostfix: string;
}

interface MultisigConfig {
    vestingMultisig: string;
    treasuryMultisig: string;
    daoMultisig: string;
}

interface BalancerPoolDeployed {
    poolId: string;
    address: string;
}
interface Phase1Deployed {
    voterProxy: VoterProxy;
    veWom?: VeWom;
    pool?: Pool;
    masterWombat?: MasterWombatV2;
    weth?: WETH;
    crv?: IERC20;
}

interface Factories {
    rewardFactory: RewardFactory;
    stashFactory: any;
    tokenFactory: TokenFactory;
    proxyFactory: any;
}
interface Phase2Deployed extends Phase1Deployed {
    cvx: Wmx;
    minter: WmxMinter;
    booster: Booster;
    boosterEarmark: BoosterEarmark;
    boosterOwner: any;
    factories: Factories;
    arbitratorVault: any;
    cvxCrv: CvxCrvToken;
    cvxCrvBpt: BalancerPoolDeployed;
    cvxCrvRewards: BaseRewardPool;
    initialCvxCrvStaking: WmxRewardPool;
    crvDepositor: any;
    crvDepositorWrapper: any;
    poolManager: any;
    poolManagerProxy: any;
    poolManagerSecondaryProxy: any;
    cvxLocker: WmxLocker;
    cvxStakingProxy: WomStakingProxy;
    chef: any;
    vestedEscrows: WmxVestedEscrow[];
    drops: WmxMerkleDrop[];
    lbpBpt: BalancerPoolDeployed;
    balLiquidityProvider: any;
    penaltyForwarder: any;
    extraRewardsDistributor: ExtraRewardsDistributor;
}

interface Phase3Deployed extends Phase2Deployed {
    pool8020Bpt: BalancerPoolDeployed;
}
interface SystemDeployed extends Phase3Deployed {
    claimZap: WmxClaimZap;
    feeCollector: any;
    rewardDepositWrapper: any;
    poolDepositor: PoolDepositor;
    reservoirMinter?: any;
    proxyFactory?: any;
}

/**
 * FLOW
 * Phase 1: Voter Proxy, get whitelisted on Curve system
 * Phase 2: cvx, booster, factories, cvxCrv, crvDepositor, poolManager, vlCVX + stakerProxy
 *           - Schedule: Vesting streams
 *           - Schedule: 2% emission for cvxCrv staking
 *           - Create:   cvxCRV/CRV BPT Stableswap
 *           - Schedule: chef (or other) & cvxCRV/CRV incentives
 *           - Schedule: Airdrop(s)
 *           - Schedule: LBP
 * Phase 2.1: Enable swapping and start weight decay on LBP
 * Phase 3: Liquidity from LBP taken and used for AURA/ETH pool
 *          Airdrops & initial farming begins like clockwork
 * Phase 4: Pools, claimzap & farming
 * Phase 5: Governance - Bravo, GaugeVoting, VoteForwarder, update roles
 */

async function deploy(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    daoSigner: Signer,
    deployment: Phase1Deployed,
    distroList: DistroList,
    multisigs: MultisigConfig,
    naming: NamingConfig,
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<SystemDeployed> {
    const { ethers } = hre;
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const firstStage = await deployFirstStage(hre, signer, deployment, multisigs, naming, config, debug, waitForBlocks);
    const {cvxCrv, cvx, cvxLocker: wmxLocker, penaltyForwarder, booster, cvxCrvRewards } = firstStage;

    let initialCvxCrvStaking;
    let drops: WmxMerkleDrop[] = [];
    const vestedEscrows = [];
    // STAGE 2

    const DELAY = ONE_WEEK;

    console.log('initialCvxCrvStaking', [cvxCrv.address, cvx.address, multisigs.treasuryMultisig, wmxLocker.address, penaltyForwarder.address, DELAY])
    initialCvxCrvStaking = await deployContract<WmxRewardPool>(
        hre,
        new WmxRewardPool__factory(deployer),
        "WmxRewardPool",
        [cvxCrv.address, cvx.address, multisigs.treasuryMultisig, wmxLocker.address, penaltyForwarder.address, 3000, DELAY],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await booster.connect(daoSigner).setLockRewardContracts(cvxCrvRewards.address, wmxLocker.address);
    await waitForTx(tx, debug, waitForBlocks);

    const premineIncetives = distroList.lpIncentives
        .add(distroList.airdrops.reduce((p, c) => p.add(c.amount), BN.from(0)))
        .add(distroList.cvxCrvBootstrap)
        .add(distroList.lbp.tknAmount)
        .add(distroList.lbp.matching);
    const totalVested = distroList.vesting
        .concat(distroList.immutableVesting)
        .reduce((p, c) => p.add(c.recipients.reduce((pp, cc) => pp.add(cc.amount), BN.from(0))), BN.from(0));
    const premine = premineIncetives.add(totalVested);
    const checksum = premine.add(distroList.miningRewards);
    if (!checksum.eq(simpleToExactAmount(100, 24)) || !premine.eq(simpleToExactAmount(50, 24))) {
        console.log(checksum.toString());
        throw console.error();
    }
    // -----------------------------
    // 2.2. Token liquidity:
    //     - Schedule: vesting (team, treasury, etc)
    //     - Schedule: 2% emission for cvxCrv staking
    //     - Create:   cvxCRV/CRV BPT Stableswap
    //     - Schedule: chef (or other) & cvxCRV/CRV incentives
    //     - Schedule: Airdrop(s)
    //     - Schedule: LBP
    // -----------------------------
    //
    // -----------------------------
    // 2.2.1 Schedule: vesting (team, treasury, etc)
    // -----------------------------

    const currentTime = BN.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    const vestingStart = currentTime.add(DELAY);

    const vestingDistro = distroList.vesting
        .map(v => ({ ...v, admin: multisigs.daoMultisig }))
        .concat(distroList.immutableVesting.map(v => ({ ...v, admin: ZERO_ADDRESS })));

    for (let i = 0; i < vestingDistro.length; i++) {
        const vestingGroup = vestingDistro[i];
        const groupVestingAmount = vestingGroup.recipients.reduce((p, c) => p.add(c.amount), BN.from(0));
        const vestingEnd = vestingStart.add(vestingGroup.period);

        console.log('vestedEscrow', [cvx.address, vestingGroup.admin, wmxLocker.address, vestingStart, vestingEnd])
        const vestedEscrow = await deployContract<WmxVestedEscrow>(
            hre,
            new WmxVestedEscrow__factory(deployer),
            "WmxVestedEscrow",
            [cvx.address, vestingGroup.admin, wmxLocker.address, vestingStart, vestingEnd],
            {},
            debug,
            waitForBlocks,
        );

        tx = await cvx.connect(daoSigner).transfer(deployerAddress, groupVestingAmount);

        tx = await cvx.approve(vestedEscrow.address, groupVestingAmount);
        await waitForTx(tx, debug, waitForBlocks);
        const vestingAddr = vestingGroup.recipients.map(m => m.address);
        const vestingAmounts = vestingGroup.recipients.map(m => m.amount);
        tx = await vestedEscrow.fund(vestingAddr, vestingAmounts);
        await waitForTx(tx, debug, waitForBlocks);

        vestedEscrows.push(vestedEscrow);
    }

    // -----------------------------
    // 2.2.2 Schedule: 2% emission for cvxCrv staking
    // -----------------------------

    console.log('cvx.transfer', initialCvxCrvStaking.address, distroList.cvxCrvBootstrap)
    tx = await cvx.connect(daoSigner).transfer(initialCvxCrvStaking.address, distroList.cvxCrvBootstrap);
    await waitForTx(tx, debug, waitForBlocks);

    // -----------------------------
    // 2.2.5 Schedule: Airdrop(s)
    // -----------------------------

    const dropCount = distroList.airdrops.length;
    drops = [];
    for (let i = 0; i < dropCount; i++) {
        const { merkleRoot, startDelay, length, amount } = distroList.airdrops[i];
        const airdrop = await deployContract<WmxMerkleDrop>(
            hre,
            new WmxMerkleDrop__factory(deployer),
            "WmxMerkleDrop",
            [
                multisigs.treasuryMultisig,
                merkleRoot,
                cvx.address,
                wmxLocker.address,
                startDelay,
                length,
            ],
            {},
            debug,
            waitForBlocks,
        );
        tx = await cvx.connect(daoSigner).transfer(airdrop.address, amount);
        await waitForTx(tx, debug, waitForBlocks);
        drops.push(airdrop);
    }

    return {
        ...deployment,
        ...firstStage,
        initialCvxCrvStaking,
        vestedEscrows,
        drops,
    };
}

async function deployFirstStage(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase1Deployed,
    multisigs: MultisigConfig,
    naming: NamingConfig,
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<SystemDeployed> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const { token } = config;
    const { voterProxy, masterWombat } = deployment;

    // -----------------------------
    // 2: cvx, booster, factories, cvxCrv, crvDepositor, poolManager, vlCVX + stakerProxy
    //        - Schedule: Vesting streams
    //        - Schedule: 2% emission for cvxCrv staking
    //        - Create:   cvxCRV/CRV BPT Stableswap
    //        - Schedule: chef (or other) & cvxCRV/CRV incentives
    //        - Schedule: Airdrop(s)
    //        - Schedule: LBP
    // -----------------------------
    // POST-2: TreasuryDAO: LBP.updateWeightsGradually
    //         TreasuryDAO: LBP.setSwapEnabled

    // -----------------------------
    // 2.1 Core system:
    //     - cvx
    //     - booster
    //     - factories (reward, token, proxy, stash)
    //     - cvxCrv (cvxCrv, crvDepositor)
    //     - pool management (poolManager + 2x proxies)
    //     - vlCVX + ((stkCVX && stakerProxy) || fix)
    // -----------------------------

    console.log('deployContract<Wmx>')
    const cvx = await deployContract<Wmx>(
        hre,
        new Wmx__factory(deployer),
        "Wmx",
        [voterProxy.address, naming.cvxName, naming.cvxSymbol],
        {},
        debug,
        waitForBlocks,
    );
    console.log('cvx', cvx.address)

    const minter = await deployContract<WmxMinter>(
        hre,
        new WmxMinter__factory(deployer),
        'WmxMinter',
        [cvx.address, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );
    console.log('minter', minter.address, [cvx.address, multisigs.daoMultisig]);

    const booster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        [voterProxy.address, ZERO_ADDRESS, cvx.address, token, deployment.weth.address, 5000, 15000],
        {},
        debug,
        waitForBlocks,
    );
    console.log('booster', booster.address);

    const boosterEarmark = await deployContract<BoosterEarmark>(
        hre,
        new BoosterEarmark__factory(deployer),
        "BoosterEarmark",
        [booster.address, deployment.weth.address],
        {},
        debug,
        waitForBlocks,
    );
    console.log('boosterEarmark', boosterEarmark.address);

    await booster.setEarmarkDelegate(boosterEarmark.address);

    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        [deployment.weth.address, booster.address, masterWombat.address],
        {},
        debug,
        waitForBlocks,
    );
    console.log('poolDeposior', poolDepositor.address)

    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [booster.address, token],
        {},
        debug,
        waitForBlocks,
    );
    console.log('rewardFactory', rewardFactory.address, [booster.address, naming.tokenFactoryNamePostfix, naming.cvxSymbol.toLowerCase()])

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [booster.address, naming.tokenFactoryNamePostfix, naming.cvxSymbol.toLowerCase()],
        {},
        debug,
        waitForBlocks,
    );
    console.log('tokenFactory', tokenFactory.address);

    const cvxCrv = await deployContract<CvxCrvToken>(
        hre,
        new CvxCrvToken__factory(deployer),
        "CvxCrv",
        [naming.cvxCrvName, naming.cvxCrvSymbol],
        {},
        debug,
        waitForBlocks,
    );
    console.log('cvxCrv', cvxCrv.address);

    const womDepositor = await deployContract<WomDepositorV3>(
        hre,
        new WomDepositorV3__factory(deployer),
        "WomDepositorV3",
        [token, voterProxy.address, cvxCrv.address, boosterEarmark.address, ZERO_ADDRESS],
        {},
        debug,
        waitForBlocks,
    );
    console.log('womDepositor', womDepositor.address);

    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        hre,
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, token, booster.address],
        {},
        debug,
        waitForBlocks,
    );
    console.log('cvxCrvRewards', cvxCrvRewards.address);

    const proxyFactory = await deployContract<ProxyFactory>(
        hre,
        new ProxyFactory__factory(deployer),
        "ProxyFactory",
        [ZERO_ADDRESS],
        {},
        debug,
        waitForBlocks,
    );
    await proxyFactory.createProxyAdmin(multisigs.daoMultisig).then(tx => tx.wait());
    console.log('proxyFactory', proxyFactory.address);

    let wmxLocker = await deployContract<WmxLocker>(
        hre,
        new WmxLocker__factory(deployer),
        "WmxLocker",
        [],
        {},
        debug,
        waitForBlocks,
    );

    const res = await proxyFactory.build(
        wmxLocker.address,
        wmxLocker.interface.encodeFunctionData('initialize', [naming.vlCvxName, naming.vlCvxSymbol, cvx.address, cvxCrv.address, cvxCrvRewards.address, await deployer.getAddress()])
    ).then(tx => tx.wait());
    const {proxy} = res.events.filter(e => e.event === 'BuildProxy')[0].args;

    wmxLocker = WmxLocker__factory.connect(proxy, deployer);
    console.log('wmxLocker', wmxLocker.address);

    const wmxStakingProxy = await deployContract<WomStakingProxy>(
        hre,
        new WomStakingProxy__factory(deployer),
        "WomStakingProxy",
        [
            config.token,
            cvx.address,
            cvxCrv.address,
            womDepositor.address,
            wmxLocker.address,
        ],
        {},
        debug,
        waitForBlocks,
    );
    console.log('wmxStakingProxy', wmxStakingProxy.address);
    const extraRewardsDistributor = await deployContract<ExtraRewardsDistributor>(
        hre,
        new ExtraRewardsDistributor__factory(deployer),
        "ExtraRewardsDistributor",
        [wmxLocker.address],
        {},
        debug,
        waitForBlocks,
    );
    console.log('extraRewardsDistributor', extraRewardsDistributor.address);
    const penaltyForwarder = await deployContract<WmxPenaltyForwarder>(
        hre,
        new WmxPenaltyForwarder__factory(deployer),
        "WmxPenaltyForwarder",
        [extraRewardsDistributor.address, cvx.address, ONE_WEEK.mul(7).div(2), multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );
    console.log('penaltyForwarder', penaltyForwarder.address);

    let tx = await wmxLocker.addReward(cvxCrv.address, wmxStakingProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await wmxLocker.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    console.log('voterProxy.setOperator')
    tx = await voterProxy.setOperator(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('womDepositor.setLockConfig')
    tx = await womDepositor.setLockConfig(1461, 2 * 60 * 60);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('cvxCrv.setOperator')
    tx = await cvxCrv.setOperator(womDepositor.address);
    await waitForTx(tx, debug, waitForBlocks);

    console.log(' voterProxy.setDepositor')
    tx = await voterProxy.setDepositor(womDepositor.address);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('booster.setFactories')
    tx = await booster.setFactories(rewardFactory.address, tokenFactory.address);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('booster.setVoteDelegate')
    tx = await booster.setVoteDelegate(multisigs.daoMultisig, true);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('booster.setEarmarkConfig')
    tx = await boosterEarmark.setEarmarkConfig(10, 60 * 60);
    await waitForTx(tx, debug, waitForBlocks);

    await boosterEarmark.updateBoosterAndDepositor().then(tx => tx.wait());

    console.log('booster.setExtraRewardsDistributor')
    tx = await booster.setExtraRewardsDistributor(extraRewardsDistributor.address);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('booster.setFeeManager')
    tx = await booster.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('booster.modifyWhitelist')
    tx = await extraRewardsDistributor.modifyWhitelist(penaltyForwarder.address, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await extraRewardsDistributor.modifyWhitelist(booster.address, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setPoolManager(deployerAddress);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setPoolManager(boosterEarmark.address);
    await waitForTx(tx, debug, waitForBlocks);

    await updateDistributionByTokens(signer, {
        booster,
        boosterEarmark,
        voterProxy,
        cvxCrvRewards,
        masterWombat: deployment.masterWombat,
        cvxLocker: wmxLocker,
        weth: deployment.weth,
        crv: deployment.crv,
        cvxStakingProxy: wmxStakingProxy}
    );

    await proxyFactory.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());

    tx = await boosterEarmark.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await wmxLocker.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await wmxStakingProxy.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('voterProxy.setOwner')
    tx = await voterProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await womDepositor.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    console.log('booster.transferOwnership')
    tx = await extraRewardsDistributor.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    const claimZap = await deployContract<WmxClaimZap>(
        hre,
        new WmxClaimZap__factory(deployer),
        "WmxClaimZap",
        [token, cvx.address, cvxCrv.address, womDepositor.address, cvxCrvRewards.address, extraRewardsDistributor.address, wmxLocker.address, wmxLocker.address, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );
    console.log('claimZap', claimZap.address)

    console.log('cvx.init')
    tx = await cvx.init(multisigs.daoMultisig, minter.address);
    await waitForTx(tx, debug, waitForBlocks);


    return {
        ...deployment,
        cvx,
        minter,
        booster,
        boosterEarmark,
        poolDepositor,
        proxyFactory,
        boosterOwner: null,
        cvxCrvBpt: null,
        cvxStakingProxy: wmxStakingProxy,
        chef: null,
        lbpBpt: null,
        balLiquidityProvider: null,
        factories: {
            rewardFactory,
            stashFactory: null,
            tokenFactory,
            proxyFactory: null,
        },
        arbitratorVault: null,
        cvxCrv,
        cvxCrvRewards,
        initialCvxCrvStaking: null,
        crvDepositor: womDepositor as any,
        crvDepositorWrapper: null,
        poolManager: null,
        cvxLocker: wmxLocker,
        vestedEscrows: [],
        drops: [],
        feeCollector: null,
        claimZap,
        penaltyForwarder,
        extraRewardsDistributor,
        poolManagerProxy: null,
        poolManagerSecondaryProxy: null,
        rewardDepositWrapper: null,
        pool8020Bpt: null,
    };
}

async function deploySideChain(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase1Deployed,
    cvx: IERC20,
    proxyFactory: ProxyFactory,
    multisigs: MultisigConfig,
    naming: NamingConfig,
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<SystemDeployed> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const { token } = config;
    const { voterProxy, masterWombat } = deployment;

    // -----------------------------
    // 2: cvx, booster, factories, cvxCrv, crvDepositor, poolManager, vlCVX + stakerProxy
    //        - Schedule: Vesting streams
    //        - Schedule: 2% emission for cvxCrv staking
    //        - Create:   cvxCRV/CRV BPT Stableswap
    //        - Schedule: chef (or other) & cvxCRV/CRV incentives
    //        - Schedule: Airdrop(s)
    //        - Schedule: LBP
    // -----------------------------
    // POST-2: TreasuryDAO: LBP.updateWeightsGradually
    //         TreasuryDAO: LBP.setSwapEnabled

    // -----------------------------
    // 2.1 Core system:
    //     - cvx
    //     - booster
    //     - factories (reward, token, proxy, stash)
    //     - cvxCrv (cvxCrv, crvDepositor)
    //     - pool management (poolManager + 2x proxies)
    //     - vlCVX + ((stkCVX && stakerProxy) || fix)
    // -----------------------------

    const reservoirMinter = await deployContract<ReservoirMinter>(
        hre,
        new ReservoirMinter__factory(deployer),
        'ReservoirMinter',
        [cvx.address, '58752703517148923654981765'],
        {},
        debug,
        waitForBlocks,
    );
    console.log('reservoirMinter', reservoirMinter.address);

    const booster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        [voterProxy.address, reservoirMinter.address, cvx.address, token, deployment.weth.address, 5000, 15000],
        {},
        debug,
        waitForBlocks,
    );
    console.log('booster', booster.address);

    await reservoirMinter.setMinter(booster.address, true).then(tx => tx.wait());

    const boosterEarmark = await deployContract<BoosterEarmark>(
        hre,
        new BoosterEarmark__factory(deployer),
        "BoosterEarmark",
        [booster.address, deployment.weth.address],
        {},
        debug,
        waitForBlocks,
    );
    console.log('boosterEarmark', boosterEarmark.address);

    await booster.setEarmarkDelegate(boosterEarmark.address);

    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        [deployment.weth.address, booster.address, masterWombat.address],
        {},
        debug,
        waitForBlocks,
    );
    console.log('poolDeposior', poolDepositor.address);

    await approvePoolDepositor(poolDepositor, signer);

    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [booster.address, token],
        {},
        debug,
        waitForBlocks,
    );
    console.log('rewardFactory', rewardFactory.address, [booster.address, token]);

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [booster.address, naming.tokenFactoryNamePostfix, naming.cvxSymbol.toLowerCase()],
        {},
        debug,
        waitForBlocks,
    );

    const cvxCrv = await deployContract<CvxCrvToken>(
        hre,
        new CvxCrvToken__factory(deployer),
        "CvxCrv",
        [naming.cvxCrvName, naming.cvxCrvSymbol],
        {},
        debug,
        waitForBlocks,
    );

    const womDepositor = await deployContract<WomDepositorV3>(
        hre,
        new WomDepositorV3__factory(deployer),
        "WomDepositorV3",
        [token, voterProxy.address, cvxCrv.address, booster.address, ZERO_ADDRESS],
        {},
        debug,
        waitForBlocks,
    );

    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        hre,
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, token, booster.address],
        {},
        debug,
        waitForBlocks,
    );

    let wmxLocker = await deployContract<WmxLocker>(
        hre,
        new WmxLocker__factory(deployer),
        "WmxLocker",
        [],
        {},
        debug,
        waitForBlocks,
    );
    const res = await proxyFactory.build(
        wmxLocker.address,
        wmxLocker.interface.encodeFunctionData('initialize', [naming.vlCvxName, naming.vlCvxSymbol, cvx.address, cvxCrv.address, cvxCrvRewards.address, await deployer.getAddress()])
    ).then(tx => tx.wait());
    const {proxy} = res.events.filter(e => e.event === 'BuildProxy')[0].args;

    wmxLocker = WmxLocker__factory.connect(proxy, deployer);

    const wmxStakingProxy = await deployContract<WomStakingProxy>(
        hre,
        new WomStakingProxy__factory(deployer),
        "WomStakingProxy",
        [
            config.token,
            cvx.address,
            cvxCrv.address,
            womDepositor.address,
            wmxLocker.address,
        ],
        {},
        debug,
        waitForBlocks,
    );
    const extraRewardsDistributor = await deployContract<ExtraRewardsDistributor>(
        hre,
        new ExtraRewardsDistributor__factory(deployer),
        "ExtraRewardsDistributor",
        [wmxLocker.address],
        {},
        debug,
        waitForBlocks,
    );
    const penaltyForwarder = await deployContract<WmxPenaltyForwarder>(
        hre,
        new WmxPenaltyForwarder__factory(deployer),
        "WmxPenaltyForwarder",
        [extraRewardsDistributor.address, cvx.address, ONE_WEEK.mul(7).div(2), multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    await booster.setMintParams(6000, reservoirMinter.address, ZERO_ADDRESS).then(tx => tx.wait());
    await booster.setLockRewardContracts(cvxCrvRewards.address, wmxLocker.address).then(tx => tx.wait());
    console.log('booster.setFactories')
    await booster.setFactories(rewardFactory.address, tokenFactory.address).then(tx => tx.wait());
    console.log('booster.setVoteDelegate')
    await booster.setVoteDelegate(multisigs.daoMultisig, true).then(tx => tx.wait());
    console.log('booster.setExtraRewardsDistributor')
    await booster.setExtraRewardsDistributor(extraRewardsDistributor.address).then(tx => tx.wait());
    console.log('booster.setFeeManager')
    await booster.setFeeManager(multisigs.daoMultisig).then(tx => tx.wait());
    await wmxLocker.addReward(cvxCrv.address, wmxStakingProxy.address).then(tx => tx.wait());
    await wmxLocker.setApprovals().then(tx => tx.wait());
    console.log('voterProxy.setOperator')
    await voterProxy.setOperator(booster.address).then(tx => tx.wait());
    console.log('voterProxy.setDepositor')
    await voterProxy.setDepositor(womDepositor.address).then(tx => tx.wait());
    console.log('womDepositor.setLockConfig')
    await womDepositor.setLockConfig(1461, 24 * 60 * 60).then(tx => tx.wait());
    console.log('cvxCrv.setOperator')
    await cvxCrv.setOperator(womDepositor.address).then(tx => tx.wait());
    console.log('boosterEarmark.setEarmarkConfig')
    await boosterEarmark.setEarmarkConfig(10, 24 * 60 * 60).then(tx => tx.wait());
    console.log('extraRewardsDistributor.modifyWhitelist')
    await extraRewardsDistributor.modifyWhitelist(penaltyForwarder.address, true).then(tx => tx.wait());
    await extraRewardsDistributor.modifyWhitelist(booster.address, true).then(tx => tx.wait());
    await booster.setPoolManager(deployerAddress).then(tx => tx.wait());
    await booster.setPoolManager(boosterEarmark.address).then(tx => tx.wait());

    await updateDistributionByTokens(signer, {
        booster,
        boosterEarmark,
        voterProxy,
        cvxCrvRewards,
        masterWombat: deployment.masterWombat,
        cvxLocker: wmxLocker,
        weth: deployment.weth,
        crv: deployment.crv,
        cvxStakingProxy: wmxStakingProxy}
    );

    await proxyFactory.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());
    await boosterEarmark.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());
    await wmxLocker.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());
    await wmxStakingProxy.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());
    console.log('voterProxy.setOwner')
    await voterProxy.setOwner(multisigs.daoMultisig).then(tx => tx.wait());
    await booster.setOwner(multisigs.daoMultisig).then(tx => tx.wait());
    await womDepositor.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());
    await reservoirMinter.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());
    console.log('booster.transferOwnership')
    await extraRewardsDistributor.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());
    await poolDepositor.transferOwnership(multisigs.daoMultisig).then(tx => tx.wait());

    const claimZap = await deployContract<WmxClaimZap>(
        hre,
        new WmxClaimZap__factory(deployer),
        "WmxClaimZap",
        [token, cvx.address, cvxCrv.address, womDepositor.address, cvxCrvRewards.address, extraRewardsDistributor.address, wmxLocker.address, wmxLocker.address, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );
    console.log('claimZap', claimZap.address)

    return {
        ...deployment,
        cvx: cvx as Wmx,
        minter: null,
        booster,
        reservoirMinter,
        boosterEarmark,
        poolDepositor,
        boosterOwner: null,
        cvxCrvBpt: null,
        cvxStakingProxy: wmxStakingProxy,
        chef: null,
        lbpBpt: null,
        balLiquidityProvider: null,
        factories: {
            rewardFactory,
            stashFactory: null,
            tokenFactory,
            proxyFactory: null,
        },
        arbitratorVault: null,
        cvxCrv,
        cvxCrvRewards,
        initialCvxCrvStaking: null,
        crvDepositor: womDepositor as any,
        crvDepositorWrapper: null,
        poolManager: null,
        cvxLocker: wmxLocker,
        vestedEscrows: [],
        drops: [],
        feeCollector: null,
        claimZap,
        penaltyForwarder,
        extraRewardsDistributor,
        poolManagerProxy: null,
        poolManagerSecondaryProxy: null,
        rewardDepositWrapper: null,
        pool8020Bpt: null,
    };
}

async function updateDistributionByTokens(signer, deployment, waitForBlocks = 1) {
    const {booster, boosterEarmark, voterProxy, masterWombat, cvxLocker, cvxCrvRewards, weth, crv, cvxStakingProxy} = deployment;

    const poolLength = await masterWombat.poolLength().then(l => parseInt(l.toString()));

    // _lockRewards: cvxCrvRewards.address
    // _stakerRewards: cvxStakingProxy.address => auraLocker.address
    // booster.setFees(550, 1100, 50, 0);
    // function setFees(uint256 _lockFees, uint256 _stakerFees, uint256 _callerFees, uint256 _platform) external{

    console.log('voterProxy.setLpTokensPid', masterWombat.address);
    let tx = await voterProxy.connect(signer).setLpTokensPid(masterWombat.address);
    await waitForTx(tx, true, waitForBlocks);

    console.log('booster.updateDistributionByTokens', poolLength);
    tx = await boosterEarmark.connect(signer).updateDistributionByTokens(
        crv.address,
        [cvxCrvRewards.address, cvxStakingProxy.address],
        [500, 1000],
        [true, true]
    );
    await waitForTx(tx, true, waitForBlocks);

    for (let i = 0; i < poolLength; i++) {
        console.log('masterWombat.poolInfo');
        const {lpToken, rewarder} = await masterWombat.poolInfo(i);

        console.log('booster.addPool');
        tx = await boosterEarmark.connect(signer).addPool(lpToken, masterWombat.address);
        await waitForTx(tx, true, waitForBlocks);

        if (rewarder !== ZERO_ADDRESS) {
            const rewarderContract = await IMasterWombatRewarder__factory.connect(rewarder, signer);
            const tokens = await rewarderContract.rewardTokens();
            for(let i = 0; i < tokens.length; i++) {
                let token = tokens[i];
                if (token === ZERO_ADDRESS) {
                    token = weth.address;
                    console.log('tokens[i] = weth.address')
                }
                tx = await boosterEarmark.connect(signer).updateDistributionByTokens(
                    token,
                    [cvxCrvRewards.address, cvxLocker.address],
                    [500, 1000],
                    [true, true]
                );
                await waitForTx(tx, true, waitForBlocks);

                if (await cvxLocker.rewardData(token).then(rd => rd.lastUpdateTime.toString()) === '0') {
                    console.log('cvxLocker.connect(signer).addReward', token);
                    tx = await cvxLocker.connect(signer).addReward(token, booster.address);
                    await waitForTx(tx, true, waitForBlocks);
                }
            }
        }
    }
}

export {
    DistroList,
    MultisigConfig,
    ExtSystemConfig,
    BalancerPoolDeployed,
    NamingConfig,
    deploy,
    deployFirstStage,
    deploySideChain,
    updateDistributionByTokens,
    Phase1Deployed,
    Phase2Deployed,
    Phase3Deployed,
    SystemDeployed,
};
