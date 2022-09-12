import { ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "./../test-utils/constants";
import { simpleToExactAmount } from "./../test-utils/math";
import { getTimestamp } from "./../test-utils";
import { Signer } from "ethers";
import {
    MockERC20__factory,
    MockERC20,
    MockVoting,
    MockVoting__factory,
    MockWalletChecker,
    MockWalletChecker__factory,
    VoterProxy, VoterProxy__factory,
    VeWom, VeWom__factory,
    MasterWombatV2, MasterWombatV2__factory,
    MultiRewarderPerSec, MultiRewarderPerSec__factory,
    WETH, WETH__factory,
} from "../types/generated";
import {deployContract, waitForTx} from "../tasks/utils";
import { MultisigConfig, DistroList, ExtSystemConfig, NamingConfig } from "./deploySystem";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { BigNumber as BN } from "ethers";

interface DeployMocksResult {
    lptoken: MockERC20;
    crv: MockERC20;
    crvMinter: null;
    voting: MockVoting;
    votingEscrow: null;
    feeDistribution: null;
    smartWalletChecker: MockWalletChecker;
    gauges: [];
    crvBpt: null;
    balancerVault: null;
    bal: MockERC20;
    weth: MockERC20;
    addresses: ExtSystemConfig;
    namingConfig: NamingConfig;
}

/** @dev Recreates the Convex distribution list */
function getMockDistro(): DistroList {
    return {
        miningRewards: simpleToExactAmount(50, 24),
        lpIncentives: simpleToExactAmount(10, 24),
        cvxCrvBootstrap: simpleToExactAmount(2, 24),
        lbp: {
            tknAmount: simpleToExactAmount(2.2, 24),
            wethAmount: simpleToExactAmount(50),
            matching: simpleToExactAmount(2.8, 24),
        },
        airdrops: [
            {
                merkleRoot: ZERO_KEY,
                startDelay: ONE_WEEK,
                length: ONE_WEEK.mul(3),
                amount: simpleToExactAmount(2.5, 24),
            },
            {
                merkleRoot: ZERO_KEY,
                startDelay: ONE_WEEK.mul(26),
                length: ONE_WEEK.mul(8),
                amount: simpleToExactAmount(1, 24),
            },
        ],
        immutableVesting: [
            {
                period: ONE_WEEK.mul(16),
                recipients: [
                    { address: "0x1e1300EEAf333c572E4FC0133614291fa9d0df8B", amount: simpleToExactAmount(0.5, 24) },
                ],
            },
        ],
        vesting: [
            {
                period: ONE_WEEK.mul(16),
                recipients: [
                    { address: "0x1e1300EEAf333c572E4FC0133614291fa9d0df8B", amount: simpleToExactAmount(0.5, 24) }, // Team vesting
                ],
            },
            {
                period: ONE_WEEK.mul(104),
                recipients: [
                    { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(9, 24) }, // Team vesting
                    { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(2, 24) }, // Partner Treasury
                ],
            },
            {
                period: ONE_WEEK.mul(208),
                recipients: [
                    { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(17.5, 24) }, // Treasury
                ],
            },
        ],
    };
}

/** @dev Simply fetches the addresses of the given signers to act as respective multisigs */
async function getMockMultisigs(
    vestingSigner: Signer,
    treasurySigner: Signer,
    daoSigner: Signer,
): Promise<MultisigConfig> {
    return {
        vestingMultisig: await vestingSigner.getAddress(),
        treasuryMultisig: await treasurySigner.getAddress(),
        daoMultisig: await daoSigner.getAddress(),
    };
}

const zeroAddress = '0x0000000000000000000000000000000000000000';

async function deployBinanceTestMocks(tokenAddress, hre: HardhatRuntimeEnvironment, signer: Signer, debug = false): Promise<DeployMocksResult> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    // -----------------------------
    // 1. Deployments
    // -----------------------------

    const smartWalletChecker = await deployContract<MockWalletChecker>(
        hre,
        new MockWalletChecker__factory(deployer),
        "mockWalletChecker",
        [],
        {},
        debug,
    );

    // const votingEscrow = await deployContract<MockCurveVoteEscrow>(
    //     hre,
    //     new MockCurveVoteEscrow__factory(deployer),
    //     "MockCurveVoteEscrow",
    //     [smartWalletChecker.address, crvBpt.address],
    //     {},
    //     debug,
    // );

    const voting = await deployContract<MockVoting>(
        hre,
        new MockVoting__factory(deployer),
        "MockVoting",
        [],
        {},
        false,
    );

    const gauges = [];
    let lptoken;

    // for (let i = 0; i < 4; i++) {
    //     const symbol = ['BUSD', 'USDC', 'USDT', 'DAI'][i];
    //     lptoken = await deployContract<MockERC20>(
    //         hre,
    //         new MockERC20__factory(deployer),
    //         "MockLPToken",
    //         [symbol, symbol, 18, deployerAddress, 10000000],
    //         {},
    //         debug,
    //     );
    //     const gauge = await deployContract<MockCurveGauge>(
    //         hre,
    //         new MockCurveGauge__factory(deployer),
    //         "MockCurveGauge",
    //         [`TestGauge_${symbol}`, `tstGauge_${symbol}`, lptoken.address, []],
    //         {},
    //         debug,
    //     );
    //
    //     const tx = await voting.vote_for_gauge_weights(gauge.address, 1);
    //     await tx.wait();
    //     gauges.push(gauge);
    // }

    // const feeDistro = await deployContract<MockFeeDistributor>(
    //     hre,
    //     new MockFeeDistributor__factory(deployer),
    //     "MockFeeDistributor",
    //     [
    //         [lptoken.address, tokenAddress],
    //         [simpleToExactAmount(1), simpleToExactAmount(1)],
    //     ],
    //     {},
    //     debug,
    // );
    //
    // let tx = await lptoken.transfer(feeDistro.address, simpleToExactAmount(1, 22));
    // await tx.wait();

    // tx = await crv.transfer(feeDistro.address, simpleToExactAmount(1, 22));
    // await tx.wait();

    // tx = await crvBpt.setPrice(parseEther("2.40"));
    // await tx.wait();

    // const balancerVault = await deployContract<MockBalancerVault>(
    //     hre,
    //     new MockBalancerVault__factory(deployer),
    //     "MockBalancerVault",
    //     [crvBpt.address],
    //     {},
    //     debug,
    // );

    // const bal = await deployContract<MockERC20>(
    //     hre,
    //     new MockERC20__factory(deployer),
    //     "MockBAL",
    //     ["mockBAL", "mockBAL", 18, deployerAddress, 10000000],
    //     {},
    //     debug,
    // );

    // const weth = await deployContract<MockERC20>(
    //     hre,
    //     new MockERC20__factory(deployer),
    //     "MockWETH",
    //     ["mockWETH", "mockWETH", 18, deployerAddress, 10000000],
    //     {},
    //     debug,
    // );

    return {
        lptoken: null,
        crv: null,
        crvMinter: null,
        voting,
        votingEscrow: null,
        smartWalletChecker,
        feeDistribution: null,
        gauges: [],
        crvBpt: null,
        balancerVault: null,
        bal: null,
        weth: null,
        addresses: {
            token: zeroAddress,
            tokenBpt: zeroAddress,
            tokenWhale: deployerAddress,
            minter: zeroAddress,
            votingEscrow: zeroAddress,
            feeDistribution: zeroAddress,
            gaugeController: voting.address,
            voteOwnership: voting.address,
            voteParameter: voting.address,
            gauges: gauges.map(g => g.address),
            balancerVault: zeroAddress,
            balancerPoolFactories: {
                weightedPool2Tokens: ZERO_ADDRESS,
                stablePool: ZERO_ADDRESS,
                bootstrappingPool: ZERO_ADDRESS,
            },
            balancerPoolId: ZERO_KEY,
            balancerMinOutBps: "0",
            weth: zeroAddress,
            wethWhale: deployerAddress,
        },
        namingConfig: {
            cvxName: "Convex Finance",
            cvxSymbol: "CVX",
            vlCvxName: "Vote Locked CVX",
            vlCvxSymbol: "vlCVX",
            cvxCrvName: "Convex CRV",
            cvxCrvSymbol: "cvxCRV",
            tokenFactoryNamePostfix: " Convex Deposit",
        },
    };
}

async function deployTestFirstStage(hre: HardhatRuntimeEnvironment, signer: Signer, addEthMultiRewarder = true) {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();
    const waitForBlocks = 1;
    const debug = true;

    const config: any = {};

    const voting = await deployContract<MockVoting>(
        hre,
        new MockVoting__factory(deployer),
        "MockVoting",
        [],
        {},
        false,
    );
    console.log('voting', voting.address);

    const wom = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockWOM",
        ["mockWOM", "mockBAL", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const masterWombat = await deployContract<MasterWombatV2>(
        hre,
        new MasterWombatV2__factory(deployer),
        "MasterWombatV2",
        [
            wom.address,
            zeroAddress,
            152207000000000,
            375,
            Math.round(new Date().getTime() / 1000)
        ],
        {},
        debug,
    );

    const veWom = await deployContract<VeWom>(
        hre,
        new VeWom__factory(deployer),
        "VeWom",
        [wom.address, masterWombat.address],
        {},
        debug,
    );

    const lptoken = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockLP",
        ["MockLP", "MockLP", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const weth = await deployContract<WETH>(
        hre,
        new WETH__factory(deployer),
        "WETH",
        [],
        {},
        debug,
    );

    let multiRewarderAddress = ZERO_ADDRESS;
    if(addEthMultiRewarder) {
        const multiRewarder = await deployContract<MultiRewarderPerSec>(
            hre,
            new MultiRewarderPerSec__factory(deployer),
            "MultiRewarderPerSec",
            [
                masterWombat.address,
                lptoken.address,
                (await getTimestamp()).add(1),
                zeroAddress,
                152207000000000 / 2
            ],
            {},
            debug,
        );

        await signer.sendTransaction({
            to: multiRewarder.address,
            value: BN.from(10).pow(20)
        });

        multiRewarderAddress = multiRewarder.address;
    }

    let tx = await masterWombat.add('1', lptoken.address, multiRewarderAddress);
    await waitForTx(tx, true, waitForBlocks);

    tx = await wom.transfer(masterWombat.address, BN.from(10).pow(18).mul(10000));
    await waitForTx(tx, true, waitForBlocks);

    tx = await masterWombat.setVeWom(veWom.address);
    await waitForTx(tx, true, waitForBlocks);

    config.weth = weth.address;
    config.token = wom.address;
    config.gaugeController = voting.address;
    config.voteOwnership = voting.address;
    config.voteParameter = voting.address;
    config.tokenBpt = zeroAddress;
    config.masterWombat = masterWombat.address;
    config.veWom = veWom.address;

    const voterProxy = await deployContract<VoterProxy>(
        hre,
        new VoterProxy__factory(deployer),
        "VoterProxy",
        [wom.address, veWom.address, weth.address],
        {},
        true,
        waitForBlocks,
    );
    console.log('voterProxy', voterProxy.address);

    return {
        ...config,
        weth,
        voting,
        lptoken,
        voterProxy,
        veWom,
        masterWombat,
        crvMinter: null,
        crv: wom,
        feeDistribution: null,
        addresses: config,
        namingConfig: {
            cvxName: "Convex Finance",
            cvxSymbol: "CVX",
            vlCvxName: "Vote Locked CVX",
            vlCvxSymbol: "vlCVX",
            cvxCrvName: "Convex CRV",
            cvxCrvSymbol: "cvxCRV",
            tokenFactoryNamePostfix: " Convex Deposit",
        },
    } as any;
}

export { deployTestFirstStage, DeployMocksResult, getMockDistro, getMockMultisigs,deployBinanceTestMocks };
