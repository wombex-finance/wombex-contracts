import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { deployContract, logContracts, waitForTx } from "./../utils/deploy-utils";
import { parseUnits } from "@ethersproject/units";
import {
    deploy,
    updateDistributionByTokens,
} from "../../scripts/deploySystem";
import { getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { simpleToExactAmount } from "./../../test-utils/math";
import {
    VoterProxy__factory,
    ERC20__factory,
    BaseRewardPool__factory,
    MockVoting,
    MockVoting__factory,
    VoterProxy, WmxClaimZap, WmxClaimZap__factory, WETH__factory, MasterWombatV2__factory, IERC20__factory
} from "../../types/generated";

const fs = require('fs');

const forking = false;
const waitForBlocks = forking ? undefined : 3;

const zeroAddress = '0x0000000000000000000000000000000000000000';

task("deploy:bnbt").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbtConfig = JSON.parse(fs.readFileSync('./bnbt.json', {encoding: 'utf8'}));

    const voting = await deployContract<MockVoting>(
        hre,
        new MockVoting__factory(deployer),
        "MockVoting",
        [],
        {},
        false,
    );
    console.log('voting', voting.address);

    const weth = WETH__factory.connect('0x64690EB41E1Ae4A75501a54C1331ddfF5c26b8a6', deployer);
    const masterWombat = MasterWombatV2__factory.connect(bnbtConfig.masterWombat, deployer);
    const crv = IERC20__factory.connect(bnbtConfig.wom, deployer);

    bnbtConfig.token = bnbtConfig.wom;
    bnbtConfig.gaugeController = voting.address;
    bnbtConfig.voteOwnership = voting.address;
    bnbtConfig.voteParameter = voting.address;
    bnbtConfig.tokenBpt = zeroAddress;

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
    fs.writeFileSync('./bnbt.json', JSON.stringify(bnbtConfig), {encoding: 'utf8'});

    console.log('deployPhase2');
    const contracts = await deploy(
        hre,
        deployer,
        { voterProxy, weth, masterWombat, crv },
        getMockDistro(),
        await getMockMultisigs(deployer, deployer, deployer),
        {
            cvxName: "Wombex Finance",
            cvxSymbol: "WMX",
            vlCvxName: "vlWMX",
            vlCvxSymbol: "vlWMX",
            cvxCrvName: "WMX WOM",
            cvxCrvSymbol: "wmxWom",
            tokenFactoryNamePostfix: " Wombex rope",
        },
        bnbtConfig,
        true,
        waitForBlocks,
    );

    [
        'cvx', 'minter', 'booster', 'boosterOwner', 'arbitratorVault', 'cvxCrv', 'cvxCrvRewards', 'initialCvxCrvStaking',
        'crvDepositor', 'cvxLocker', 'cvxStakingProxy', 'vestedEscrows', 'drops', 'lbpBpt', 'balLiquidityProvider',
        'penaltyForwarder', 'extraRewardsDistributor', 'claimZap', 'feeCollector'
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
    fs.writeFileSync('./bnbt.json', JSON.stringify(bnbtConfig), {encoding: 'utf8'});

    logContracts(contracts as unknown as { [key: string]: { address: string } });

    const poolInfo = await contracts.booster.poolInfo(0);
    const lp = await ERC20__factory.connect(poolInfo.lptoken, deployer);
    let tx = await lp.approve(contracts.booster.address, simpleToExactAmount(1));
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.booster.deposit(0, simpleToExactAmount(1), true);
    await waitForTx(tx, true, waitForBlocks);

    await new Promise((resolve) => setTimeout(resolve, 1000 * 10));

    tx = await contracts.booster.earmarkRewards(0);
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.crvDepositor["deposit(uint256,bool,address)"](
        parseUnits('1000'),
        true,
        contracts.initialCvxCrvStaking.address,
    );
    await waitForTx(tx, true, waitForBlocks);

    tx = await lp.approve(contracts.booster.address, simpleToExactAmount(1));
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.booster.deposit(0, simpleToExactAmount(1), true);
    await waitForTx(tx, true, waitForBlocks);

    tx = await BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer)["getReward()"]();
    await waitForTx(tx, true, waitForBlocks);

    const bal = await contracts.cvx.balanceOf(deployerAddress);
    if (bal.lte(0)) {
        throw console.error("No CVX");
    }

    tx = await contracts.cvx.approve(contracts.cvxLocker.address, bal);
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.cvxLocker.lock(await deployer.getAddress(), bal);
    await waitForTx(tx, true, waitForBlocks);
});

task("bnbt:set").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const bnbtConfig = JSON.parse(fs.readFileSync('./bnbt.json', {encoding: 'utf8'}));

    const voterProxy = await VoterProxy__factory.connect(bnbtConfig.voterProxy, deployer);

    for (let i = 0; i < bnbtConfig.lpTokens.length; i++) {
        const lpToken = bnbtConfig.lpTokens[i];
        const tx = await voterProxy["setLpTokenPid(address,address,uint256)"](bnbtConfig.masterWombat, lpToken, i);
        await waitForTx(tx, true, waitForBlocks);
    }
});

task("bnbt:claimzap").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const bnbtConfig = JSON.parse(fs.readFileSync('./bnbt.json', {encoding: 'utf8'}));

    const claimZap = await deployContract<WmxClaimZap>(
        hre,
        new WmxClaimZap__factory(deployer),
        "WmxClaimZap",
        [bnbtConfig.wom, bnbtConfig.cvx, bnbtConfig.cvxCrv, bnbtConfig.crvDepositor, bnbtConfig.cvxCrvRewards, bnbtConfig.cvxLocker],
        {},
        true,
        waitForBlocks,
    );
    console.log('claimZap', claimZap.address);
    bnbtConfig['claimZap'] = claimZap.address;
    fs.writeFileSync('./bnbt.json', JSON.stringify(bnbtConfig), {encoding: 'utf8'});
});
