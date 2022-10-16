import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { deployContract, logContracts, waitForTx } from "./../utils/deploy-utils";
import { parseUnits } from "@ethersproject/units";
import {
    deploy, deployFirstStage,
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
    VoterProxy,
    WmxClaimZap,
    WmxClaimZap__factory,
    WETH__factory,
    MasterWombatV2__factory,
    IERC20__factory,
    Pool__factory
} from "../../types/generated";

const fs = require('fs');
const ethers = require('ethers');

const forking = false;
const waitForBlocks = forking ? undefined : 3;

task("deploy:bnbt").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const vestingMultisig = deployerAddress;
    const treasuryMultisig = deployerAddress;
    const daoMultisig = deployerAddress;

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(5000000000),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const bnbtConfig = JSON.parse(fs.readFileSync('./bnbt.json', {encoding: 'utf8'}));

    const weth = WETH__factory.connect('0x64690EB41E1Ae4A75501a54C1331ddfF5c26b8a6', deployer);
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
    fs.writeFileSync('./bnbt.json', JSON.stringify(bnbtConfig), {encoding: 'utf8'});

    console.log('deployPhase2');
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
    fs.writeFileSync('./bnbt.json', JSON.stringify(bnbtConfig), {encoding: 'utf8'});
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
