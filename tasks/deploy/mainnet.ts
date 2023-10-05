import {task} from "hardhat/config";
import {TaskArguments} from "hardhat/types";
import {deployContract, getSigner} from "../utils";
import {
    BribesRewardFactory, BribesRewardFactory__factory, BribesTokenFactory, BribesTokenFactory__factory,
    GaugeVoting, GaugeVoting__factory, GaugeVotingLens, GaugeVotingLens__factory,
    IERC20__factory,
    MasterWombatV2__factory,
    ProxyFactory,
    ProxyFactory__factory,
    VoterProxy,
    VoterProxy__factory,
    WETH__factory,
    Wmx__factory, WmxRewardPoolLens, WmxRewardPoolLens__factory, WombexLensUI, WombexLensUI__factory,
} from "../../types/generated";
import {deploySideChain} from "../../scripts/deploySystem";
import {impersonate, simpleToExactAmount, ZERO_ADDRESS} from "../../test-utils";
const fs = require('fs');
const ethers = require('ethers');
const waitForBlocks = 1;
const debug = true;

task("deploy:mainnet").setAction(async function (taskArguments: TaskArguments, hre) {

    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    if (hre.network.name === 'forking') {
        await impersonate(deployerAddress, true);
    }

    const daoMultisig = '0x1e6C59aa5B72196666c13c0521774a6971e4e991';
    const vestingMultisig = daoMultisig;
    const treasuryMultisig = daoMultisig;

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: ethers.utils.parseUnits('20', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const mainnetConfig = JSON.parse(fs.readFileSync('./mainnet.json', {encoding: 'utf8'}));

    const weth = WETH__factory.connect(mainnetConfig.weth, deployer);
    const masterWombat = MasterWombatV2__factory.connect(mainnetConfig.masterWombat, deployer);
    const cvx = Wmx__factory.connect(mainnetConfig.cvx, deployer);
    const crv = IERC20__factory.connect(mainnetConfig.wom, deployer);

    mainnetConfig.token = mainnetConfig.wom;

    const balanceBefore = ethers.utils.formatEther(await hre.ethers.provider.getBalance(deployerAddress));
    const proxyFactory = await deployContract<ProxyFactory>(
        hre,
        new ProxyFactory__factory(deployer),
        "ProxyFactory",
        [ZERO_ADDRESS],
        {},
        debug,
        waitForBlocks,
    );
    await proxyFactory.createProxyAdmin(daoMultisig).then(tx => tx.wait());

    let voterProxy = await deployContract<VoterProxy>(
        hre,
        new VoterProxy__factory(deployer),
        "VoterProxy",
        [],
        {},
        true,
        waitForBlocks,
    );

    const res = await proxyFactory.build(
        voterProxy.address,
        voterProxy.interface.encodeFunctionData('initialize', [mainnetConfig.token, ZERO_ADDRESS, weth.address, deployerAddress])
    ).then(tx => tx.wait());
    const {proxy} = res.events.filter(e => e.event === 'BuildProxy')[0].args;
    voterProxy = VoterProxy__factory.connect(proxy, deployer);

    console.log('voterProxy', voterProxy.address);

    mainnetConfig.voterProxy = voterProxy.address;
    fs.writeFileSync('./mainnet.json', JSON.stringify(mainnetConfig), {encoding: 'utf8'});

    console.log('deploySideChain');
    const contracts = await deploySideChain(
        hre,
        deployer,
        {voterProxy, weth, masterWombat, crv},
        cvx,
        proxyFactory,
        {vestingMultisig, treasuryMultisig, daoMultisig},
        {
            cvxSymbol: "WMX",
            vlCvxName: "Vote Locked Wombex Token",
            vlCvxSymbol: "vlWMX",
            cvxCrvName: "Wombex WOM",
            cvxCrvSymbol: "wmxWom",
            tokenFactoryNamePostfix: " Wombex Deposit Token",
        },
        mainnetConfig,
        true,
        waitForBlocks,
    );

    [
        'booster', 'cvxCrv', 'cvxCrvRewards', 'reservoirMinter',
        'crvDepositor', 'cvxLocker', 'cvxStakingProxy', 'proxyFactory',
        'penaltyForwarder', 'extraRewardsDistributor', 'claimZap', 'feeCollector', 'poolDepositor'
    ].map(name => {
        if (!contracts[name]) {
            return;
        }
        if (contracts[name].address) {
            mainnetConfig[name] = contracts[name].address;
        } else {
            mainnetConfig[name] = contracts[name].map(c => c.address);
        }
    });
    fs.writeFileSync('./mainnet.json', JSON.stringify(mainnetConfig), {encoding: 'utf8'});

    const balanceAfter = ethers.utils.formatEther(await hre.ethers.provider.getBalance(deployerAddress));
    console.log('balance spent', parseFloat(balanceBefore) - parseFloat(balanceAfter));
});

task("wmx-reward-pool-lens:mainnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: ethers.utils.parseUnits('30', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
    })) as any;

    const WmxRewardPoolLensArgs = ['0x8Dd933f261545ef9be70559AccE057dd2A1Ec4e8'];
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

task("gauge-voting:mainnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const networkConfig = JSON.parse(fs.readFileSync('./mainnet.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: 12e9,
        maxPriorityFeePerGas: 1e9,
    })) as any;

    const treasuryMultisig = '0x1e6C59aa5B72196666c13c0521774a6971e4e991';
    const gaugeVotingArgs = [
        networkConfig.cvxLocker,
        networkConfig.booster,
        '0x32A936CbA2629619b46684cDf923CB556f09442c',
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

    const args = [
        '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', //_UNISWAP_ROUTER
        '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', //_UNISWAP_V3_ROUTER
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', //_MAIN_STABLE_TOKEN
        '0xc0B314a8c08637685Fc3daFC477b92028c540CFB', //_WOM_TOKEN
        '0xFa66478296841b636D72a3B31Da9CDc77E902bf1', //_WMX_TOKEN
        '0x96ff1506f7ac06b95486e09529c7efb9dfef601e', //_WMX_MINTER
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', //_WETH_TOKEN
        '0xEfF2B1353Cdcaa2C3279C2bfdE72120c7FfB5E24', //_WMX_WOM_TOKEN
    ];
    fs.writeFileSync('./args/lens.js', 'module.exports = ' + JSON.stringify(args));
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
    await lens.setUsdStableTokens(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0x853d955acef822db058eb8505911ed77f175b99e'], true).then(tx => tx.wait());
    await lens.setTokenUniV3Fee(['0x1a7e4e63778b4f12a199c062f3efdd288afcbce8'], 100).then(tx => tx.wait());
    // await lens.setTokenSwapThroughToken(['0x1a7e4e63778b4f12a199c062f3efdd288afcbce8'], ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']).then(tx => tx.wait());
    console.log('estimateInBUSDEther euro', await lens.callStatic.estimateInBUSDEther('0x1a7e4e63778b4f12a199c062f3efdd288afcbce8', simpleToExactAmount(1), 18));
    console.log('estimateInBUSDEther eth', await lens.callStatic.estimateInBUSDEther('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', simpleToExactAmount(1), 18));

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

    const gaugeVotingLensArgs = [
        gaugeVoting.address,
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

});
