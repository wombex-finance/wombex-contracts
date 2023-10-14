import {task} from "hardhat/config";
import {TaskArguments} from "hardhat/types";
import {deployContract, getSigner} from "../utils";
import {
    BaseRewardPool4626__factory,
    BoosterLensUI,
    BoosterLensUI__factory,
    BribesRewardFactory,
    BribesRewardFactory__factory,
    BribesTokenFactory,
    BribesTokenFactory__factory,
    EarmarkRewardsLens, EarmarkRewardsLens__factory,
    GaugeVoting,
    GaugeVoting__factory,
    GaugeVotingLens,
    GaugeVotingLens__factory,
    IAsset__factory,
    IERC20__factory,
    IWomPool__factory,
    MasterWombatV2__factory,
    PoolDepositor,
    PoolDepositor__factory,
    ProxyFactory,
    ProxyFactory__factory,
    VoterProxy,
    VoterProxy__factory,
    WETH__factory,
    Wmx__factory,
    WmxRewardPoolLens,
    WmxRewardPoolLens__factory,
    WombexLensUI,
    WombexLensUI__factory,
} from "../../types/generated";
import {deploySideChain} from "../../scripts/deploySystem";
import {impersonate, simpleToExactAmount, ZERO_ADDRESS} from "../../test-utils";
const {approvePoolDepositor} = require('../helpers');
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
        maxFeePerGas: 9e9,
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
    const tokens = [
        "0x6966553568634F4225330D559a8783DE7649C7D3",
        "0x752945079a0446AA7efB6e9E1789751cDD601c95",
        "0x04D4e1C1F3D6539071b6D3849fDaED04d48D563d",
        "0x62A83C6791A3d7950D823BB71a38e47252b6b6F4",
        "0x3f90a5a47364c0467031fB00246192d40E3D2D9D",

        "0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8",
        "0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f",
        "0x5dacE27D0b921b177Cd9C6706c6ACDeb3EC7bEa7",
        "0xC096FF2606152eD2A06dd12F15A3c0466Aa5A9fa",
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",

        "0x5E8422345238F34275888049021821E8E08CAa1f",
        "0xac3E018457B222d93114458476f3E3416Abbe38F",
        "0x724515010904518eCF638Cc6d693046B82548068",
        "0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0",
        "0x51E073D92b0c226F7B0065909440b18A85769606",

        // "0xa12BA2d89a16f57C4b714b03C7951c41c7695502",
        // "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
        // "0x94019D0fCc9699909E5b59727505E56252760524",
        // "0x25C9dd8a3774EF7C918cd28ff59cF9e29504C914",
        // "0x30D20208d987713f46DFD34EF128Bb16C404D10f",
        // "0xA35b1B31Ce002FBF2058D22F30f95D405200A15b",
        // "0x75Eaa804518a66196946598317Aed57Ef86235Fe",
        // "0xc0B314a8c08637685Fc3daFC477b92028c540CFB",
        // "0xFa66478296841b636D72a3B31Da9CDc77E902bf1"
    ];
    const symbols = [
        "LP-USDC",
        "LP-USDT",
        "LP-FRAX",
        "LP-USDT",
        "LP-agEUR",

        "agEUR",
        "EURe",
        "LP-EURe",
        "LP-WETH",
        "WETH",

        "frxETH",
        "sfrxETH",
        "LP-frxETH",
        "FXS",
        "LP-sfrxETH",

        "LP-wstETH",
        "wstETH",
        "LP-WETH",
        "LP-ETHx",
        "SD",
        "ETHx",
        "LP-USDC.e",
        "WOM",
        "WMX"
    ];
    // await lens.callStatic.getTokensPrices(tokens).then(r => r.map((v, i) => console.log(tokens[i], symbols[i], v.toString())));
    // const pool = IWomPool__factory.connect('0x9c02eaf31EFE3FeE36ebE5AEBCa12Ca979dF25cC', deployer);
    // console.log('getTokenUnderlying', await lens.callStatic.getTokenUnderlying('0x04D4e1C1F3D6539071b6D3849fDaED04d48D563d'));
    // console.log('getTokenToWithdrawFromPool', await lens.callStatic.getTokenToWithdrawFromPool('0x9c02eaf31EFE3FeE36ebE5AEBCa12Ca979dF25cC'));
    // console.log('quotePotentialWithdraw', await pool.callStatic.quotePotentialWithdraw('0x853d955aCEf822Db058eb8505911ED77F175b99e', simpleToExactAmount(1)));
    // console.log('getLpUsdOut', await lens.callStatic.getLpUsdOut('0x9c02eaf31EFE3FeE36ebE5AEBCa12Ca979dF25cC', '0x04D4e1C1F3D6539071b6D3849fDaED04d48D563d', simpleToExactAmount(1)));
    console.log('estimateInBUSDEther euro', await lens.callStatic.estimateInBUSDEther('0x1a7e4e63778b4f12a199c062f3efdd288afcbce8', simpleToExactAmount(1), 18));
    console.log('estimateInBUSDEther eth', await lens.callStatic.estimateInBUSDEther('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', simpleToExactAmount(1), 18));

    const gaugeVotingLensArgs = [
        '0x3C33848530A4FC85bdead5a732658D5A471B033A',
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

task("pool-depositor:mainnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const networkConfig = JSON.parse(fs.readFileSync('./mainnet.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: 7e9,
        maxPriorityFeePerGas: 1e9,
    })) as any;

    const treasuryMultisig = '0x1e6C59aa5B72196666c13c0521774a6971e4e991';

    const poolDepositor = await deployContract<PoolDepositor>(
        hre,
        new PoolDepositor__factory(deployer),
        "PoolDepositor",
        [networkConfig.weth, networkConfig.booster, networkConfig.masterWombat],
        {},
        debug,
        waitForBlocks,
    );
    console.log('poolDeposior', poolDepositor.address);

    await approvePoolDepositor(poolDepositor, deployer);

    // const testAddress = '0xFDF9b61Dc7C238A0b845403b16b6761A5c47d9D2';
    // const testAcc = await impersonate(testAddress, true);
    // const depositAmount = simpleToExactAmount(1, 6);
    // const lpAddress = '0x752945079a0446AA7efB6e9E1789751cDD601c95';
    // const lptContract = IAsset__factory.connect(lpAddress, testAcc);
    // const lpUnderlying = IERC20__factory.connect(await lptContract.underlyingToken(), testAcc);
    // await lpUnderlying.approve(poolDepositor.address, depositAmount).then(tx => tx.wait());
    // console.log('getDepositAmountOut', await poolDepositor.connect(testAddress).getDepositAmountOut(lpAddress, depositAmount));
    // await poolDepositor.connect(testAcc).deposit(lpAddress, depositAmount, 0, simpleToExactAmount(1), true).then(tx => tx.wait());
    // const crvRewardsAddress = await poolDepositor.getLpTokenCrvRewards(lpAddress);
    // const crvRewards = BaseRewardPool4626__factory.connect(crvRewardsAddress, testAcc);
    // await crvRewards.approve(poolDepositor.address, simpleToExactAmount(1)).then(tx => tx.wait());
    // console.log('getWithdrawAmountOut', await poolDepositor.connect(testAddress).getWithdrawAmountOut(lpAddress, lpUnderlying.address, simpleToExactAmount(0.5)));
    // await poolDepositor.connect(testAcc).withdrawFromOtherAsset(lpAddress, lpUnderlying.address, simpleToExactAmount(0.5), 0, simpleToExactAmount(1), testAddress).then(tx => tx.wait());

    await poolDepositor.transferOwnership(treasuryMultisig);
});

task("booster-lens:mainnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const network = process.env.NETWORK || hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: 6e9,
        maxPriorityFeePerGas: 1e9,
    })) as any;

    const boosterLensArgs = [
        '0xAb13D628B2216b7d5a7A15Aae66Ea8A71Ed9DB4F',
        networkConfig.voterProxy
    ];
    fs.writeFileSync('./args/boosterLens.js', 'module.exports = ' + JSON.stringify(boosterLensArgs));
    const boosterLens = await deployContract<BoosterLensUI>(
        hre,
        new BoosterLensUI__factory(deployer),
        "BoosterLensUI",
        boosterLensArgs,
        {},
        true,
        waitForBlocks,
    );
    console.log('boosterLens', boosterLens.address);
    // console.log('getBoostRatioList', await boosterLens.callStatic.getBoostRatioList('0x489833311676B566f888119c29bd997Dc6C95830', '0xa4A1533f5F939D6718B0d5CE2850F2ff55206967').then(list => list.map(br => ethers.utils.formatEther(br.value))))
});


task("earmark-rewards-lens:mainnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const network = process.env.NETWORK || hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: 6e9,
        maxPriorityFeePerGas: 1e9,
    })) as any;

    const wombexLensUI = WombexLensUI__factory.connect('0xAb13D628B2216b7d5a7A15Aae66Ea8A71Ed9DB4F', deployer);

    const earmarkRewardsLensArgs = [networkConfig.voterProxy, wombexLensUI.address, 5];
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
    // console.log('getPoolsQueue', await earmarkRewardsLens.getPoolsQueue());
    // console.log('getPidsToEarmark', await earmarkRewardsLens.getPidsToEarmark(false));
    // console.log('crv', await earmarkRewardsLens.crv());
    // console.log('estimateInBUSDEther', await wombexLensUI.callStatic.estimateInBUSDEther(await earmarkRewardsLens.crv(), simpleToExactAmount(1), 18));
    // console.log('getRewardsToExecute', await earmarkRewardsLens.callStatic.getRewardsToExecute().then(r => r.rewards));
    // const {tokensSymbols, diffBalances} = await earmarkRewardsLens.getRewards();
    // tokensSymbols.map((symbol, index) => {
    //     console.log(symbol, diffBalances[index]);
    // })
});
