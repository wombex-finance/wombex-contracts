import {task} from "hardhat/config";
import {TaskArguments} from "hardhat/types";
import {deployContract, getSigner} from "../utils";
import {
    BaseRewardPool__factory,
    BribesRewardFactory,
    BribesRewardFactory__factory,
    BribesTokenFactory,
    BribesTokenFactory__factory,
    EarmarkRewardsLens, EarmarkRewardsLens__factory,
    GaugeVoting,
    GaugeVoting__factory,
    GaugeVotingLens,
    GaugeVotingLens__factory,
    IERC20__factory,
    MasterWombatV2__factory,
    MockWalletChecker__factory,
    ProxyFactory,
    ProxyFactory__factory,
    VoterProxy,
    VoterProxy__factory,
    WETH__factory,
    Wmx__factory,
    WmxRewardPoolFactory,
    WmxRewardPoolFactory__factory,
    WmxRewardPoolLens,
    WmxRewardPoolLens__factory,
    WombexLensUI,
    WombexLensUI__factory,
    WomDepositorV3__factory
} from "../../types/generated";
import {deploySideChain} from "../../scripts/deploySystem";
import {impersonate, simpleToExactAmount, ZERO_ADDRESS} from "../../test-utils";
const fs = require('fs');
const ethers = require('ethers');
const _ = require('lodash');
const waitForBlocks = 1;
const debug = true;

task("deploy:arbitrum").setAction(async function (taskArguments: TaskArguments, hre) {

    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const daoMultisig = '0x7429A2e8dC807c9e13Bb65edb335D6E01051aE64';
    const vestingMultisig = daoMultisig;
    const treasuryMultisig = daoMultisig;

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(100000000),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const arbitrumConfig = JSON.parse(fs.readFileSync('./arbitrum.json', {encoding: 'utf8'}));

    const weth = WETH__factory.connect(arbitrumConfig.weth, deployer);
    const masterWombat = MasterWombatV2__factory.connect(arbitrumConfig.masterWombat, deployer);
    const cvx = Wmx__factory.connect(arbitrumConfig.cvx, deployer);
    const crv = IERC20__factory.connect(arbitrumConfig.wom, deployer);

    arbitrumConfig.token = arbitrumConfig.wom;

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
        voterProxy.interface.encodeFunctionData('initialize', [arbitrumConfig.token, arbitrumConfig.veWom, weth.address, deployerAddress])
    ).then(tx => tx.wait());
    const {proxy} = res.events.filter(e => e.event === 'BuildProxy')[0].args;
    voterProxy = VoterProxy__factory.connect(proxy, deployer);

    console.log('voterProxy', voterProxy.address);

    arbitrumConfig.voterProxy = voterProxy.address;
    fs.writeFileSync('./arbitrum.json', JSON.stringify(arbitrumConfig), {encoding: 'utf8'});

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
        arbitrumConfig,
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
            arbitrumConfig[name] = contracts[name].address;
        } else {
            arbitrumConfig[name] = contracts[name].map(c => c.address);
        }
    });
    fs.writeFileSync('./arbitrum.json', JSON.stringify(arbitrumConfig), {encoding: 'utf8'});

    if (hre.network.name !== 'forking') {
        return;
    }
    const usdcAddress = '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8';
    const usdcHolderAddress = '0x62383739d68dd0f844103db8dfb05a7eded5bbe6';
    const crvHolderAddress = '0xd4ea7475ced55eae6f581f112b0603f066c72c49';
    const cvxHolderAddress = '0x7429a2e8dc807c9e13bb65edb335d6e01051ae64';
    const whitelistAddress = '0x9a65781bfff8e43e4345d6b1b5157b2657f2735d';
    const whitelistOwnerAddress = '0xc37a89cdb064ac2921fcc8b3538ac0d6a3aadf48';
    const wombatVoterAddress = '0x3f90a5a47364c0467031fb00246192d40e3d2d9d';

    const daoSigner = await impersonate(daoMultisig, true);
    const usdcHolder = await impersonate(usdcHolderAddress, true);
    const crvHolder = await impersonate(crvHolderAddress, true);
    const cvxHolder = await impersonate(cvxHolderAddress, true);
    const whitelistOwner = await impersonate(whitelistOwnerAddress, true);
    const wombatVoter = await impersonate(wombatVoterAddress, true);

    const usdc = IERC20__factory.connect(usdcAddress, usdcHolder);
    const whitelist = MockWalletChecker__factory.connect(whitelistAddress, whitelistOwner);
    const womDepositorV3 = WomDepositorV3__factory.connect(contracts.crvDepositor.address, daoSigner);

    console.log('wmxWom before', await contracts.cvxCrv.balanceOf(cvxHolderAddress));
    await womDepositorV3.connect(daoSigner).setMintManager(daoMultisig, true).then(tx => tx.wait());
    await womDepositorV3.mint(cvxHolderAddress, simpleToExactAmount(100)).then(tx => tx.wait());
    console.log('wmxWom after', await contracts.cvxCrv.balanceOf(cvxHolderAddress));

    await whitelist.approveWallet(contracts.voterProxy.address);
    await usdc.connect(usdcHolder).approve(contracts.poolDepositor.address, await usdc.balanceOf(usdcHolderAddress));
    await crv.connect(crvHolder).approve(contracts.crvDepositor.address, await crv.balanceOf(crvHolderAddress));
    await crv.connect(crvHolder).transfer(masterWombat.address, simpleToExactAmount(100));
    await cvx.connect(cvxHolder).approve(contracts.cvxLocker.address, await cvx.balanceOf(cvxHolderAddress));

    const usdcPool = await contracts.booster.poolInfo(0);
    await masterWombat.connect(wombatVoter).notifyRewardAmount(usdcPool.lptoken, simpleToExactAmount(100));

    await cvx.connect(cvxHolder).transfer(contracts.reservoirMinter.address, simpleToExactAmount(1000));
    await contracts.cvxLocker.connect(cvxHolder).lock(cvxHolderAddress, simpleToExactAmount(100));

    console.log('newDepositor.deposit');
    await contracts.crvDepositor.connect(crvHolder)['deposit(uint256,address)'](simpleToExactAmount(1), contracts.cvxCrvRewards.address).then(tx => tx.wait(1));
    console.log('poolDepositor.deposit');
    await contracts.poolDepositor.connect(usdcHolder).deposit(usdcPool.lptoken, simpleToExactAmount(1, 6), 0, true).then(tx => tx.wait(1));

    console.log('cvxCrvRewards balance', await contracts.cvxCrvRewards.balanceOf(crvHolderAddress));

    const crvRewards = BaseRewardPool__factory.connect(usdcPool.crvRewards, deployer);
    console.log('crvRewards operator', await crvRewards.operator());
    console.log('crvRewards balance', await crvRewards.balanceOf(usdcHolderAddress));

    console.log('crvRewards wom before', await crv.balanceOf(crvRewards.address));
    await contracts.boosterEarmark.earmarkRewards(0).then(tx => tx.wait(1));
    console.log('crvRewards wom after', await crv.balanceOf(crvRewards.address));

    console.log('1 wom before', await crv.balanceOf(crvHolderAddress));
    console.log('1 wmx before', await cvx.balanceOf(crvHolderAddress));
    await contracts.cvxCrvRewards.connect(crvHolder).withdraw(simpleToExactAmount(0.5), true);
    console.log('1 wom after ', await crv.balanceOf(crvHolderAddress));
    console.log('1 wmx after ', await cvx.balanceOf(crvHolderAddress));

    console.log('2 wom before', await crv.balanceOf(usdcHolderAddress));
    console.log('2 wmx before', await cvx.balanceOf(usdcHolderAddress));
    await crvRewards.connect(usdcHolder).withdrawAndUnwrap(simpleToExactAmount(0.5, 6), true);
    console.log('2 wom after ', await crv.balanceOf(usdcHolderAddress));
    console.log('2 wmx after ', await cvx.balanceOf(usdcHolderAddress));

});

task("wmx-reward-pool-factory:arbitrum").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./arbitrum.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(100000000),
    })) as any;

    const daoMultisig = '0x7429A2e8dC807c9e13Bb65edb335D6E01051aE64';
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

task("lens:arbitrum").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(100000000),
    })) as any;

    // const WmxRewardPoolLensArgs = ['0x26202630423B6736b0B1f6C853C14162194b5490'];
    // fs.writeFileSync('./args/wmxRewardPoolLens.js', 'module.exports = ' + JSON.stringify(WmxRewardPoolLensArgs));
    // const wmxRewardPoolLens = await deployContract<WmxRewardPoolLens>(
    //     hre,
    //     new WmxRewardPoolLens__factory(deployer),
    //     "WmxRewardPoolLens",
    //     WmxRewardPoolLensArgs,
    //     {},
    //     true,
    //     waitForBlocks,
    // );
    // console.log('wmxRewardPoolLens', wmxRewardPoolLens.address);


    // const gaugeVotingLensArgs = ['0x6C6fB5e7628D9b232B43ABb81E9D4b5653F46Ca0', '0x5E28771D4414D3325f57542d16516E6e58F3351E'];
    // fs.writeFileSync('./args/gaugeVotingLens.js', 'module.exports = ' + JSON.stringify(gaugeVotingLensArgs));
    // const gaugeVotingLens = await deployContract<GaugeVotingLens>(
    //     hre,
    //     new GaugeVotingLens__factory(deployer),
    //     "GaugeVotingLens",
    //     gaugeVotingLensArgs,
    //     {},
    //     true,
    //     waitForBlocks,
    // );
    // console.log('gaugeVotingLens', gaugeVotingLens.address);
    // return;

    const args = [
        '0xc873fEcbd354f5A56E00E710B90EF4201db2448d', //_UNISWAP_ROUTER
        '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', //_UNISWAP_V3_ROUTER
        '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', //_MAIN_STABLE_TOKEN
        '0x7b5eb3940021ec0e8e463d5dbb4b7b09a89ddf96', //_WOM_TOKEN
        '0x5190F06EaceFA2C552dc6BD5e763b81C73293293', //_WMX_TOKEN
        '0x96Ff1506F7aC06B95486E09529c7eFb9DfEF601E', //_WMX_MINTER
        '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', //_WETH_TOKEN
        '0xEfF2B1353Cdcaa2C3279C2bfdE72120c7FfB5E24', //_WMX_WOM_TOKEN
        '0xEE9b42b40852a53c7361F527e638B485D49750cD'  //_WOM_WMX_POOL
    ];
    fs.writeFileSync('./args/wombexLensUi.js', 'module.exports = ' + JSON.stringify(args));
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
    await lens.setUsdStableTokens(['0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', '0xe80772eaf6e2e18b651f160bc9158b2a5cafca65', '0xeb8e93a0c7504bffd8a8ffa56cd754c63aaebfe8', '0xfea7a6a0b346362bf88a9e4a88416b77a57d6c2a', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '0x17fc002b466eec40dae837fc4be5c67993ddbd6f', '0x3f56e0c36d275367b8c502090edf38289b3dea0d', '0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b', '0x17fc002b466eec40dae837fc4be5c67993ddbd6f'], true).then(tx => tx.wait());
    await lens.setTokenUniV3(['0x7b5eb3940021ec0e8e463d5dbb4b7b09a89ddf96', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'], true).then(tx => tx.wait());
    await lens.setTokensTargetStable(['0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'], '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8').then(tx => tx.wait());
    await lens.setTokensToRouter(['0x9d2f299715d94d8a7e6f5eaa8e654e8c74a988a7'], '0xCAAaB0A72f781B92bA63Af27477aA46aB8F653E7').then(tx => tx.wait());
    await lens.setTokensTargetStable(['0x9d2f299715d94d8a7e6f5eaa8e654e8c74a988a7'], '0x17fc002b466eec40dae837fc4be5c67993ddbd6f').then(tx => tx.wait());
    // console.log('getBribeTotalApr', await lens.callStatic.getBribeTotalApr('0x24d2f6be2bf9cdf3627f720cf09d4551580c1ec1', '0x3f90a5a47364c0467031fb00246192d40e3d2d9d', '0xbd7568d25338940ba212e3f299d2ccc138fa35f0', '9464106345051990800395'));

    // const lens = WombexLensUI__factory.connect('0xa2a791c8ad4f3363c3997a565f9d7c19e870c83e', deployer);
    console.log('lens', lens.address);

    const gaugeVotingLensArgs = ['0x6C6fB5e7628D9b232B43ABb81E9D4b5653F46Ca0', lens.address];
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
    console.log('getPools()', await gaugeVotingLens.callStatic.getPools().then(pools => pools.filter(p => p.symbol === 'LP-DAI+')));

    console.log('quotePotentialWithdrawalTokenToBUSD', await lens.callStatic.quotePotentialWithdrawalTokenToBUSD('0xc6bc781e20f9323012f6e422bdf552ff06ba6cd1', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '15986739405025212357290065'));
    console.log('estimateInBUSD', await lens.callStatic.estimateInBUSD('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '15986739405025212357290065', 6));
    console.log('getLpUsdOut', await lens.callStatic.getLpUsdOut('0xc6bc781e20f9323012f6e422bdf552ff06ba6cd1', '15986739405025212357290065'));
    console.log('getTvl', await lens.callStatic.getTvl('0x4181E561b42fDaD14c68b0794c215DeB9Bc80c8F'));
    // console.log('estimateInBUSD', await lens.callStatic.estimateInBUSD('0x7b5eb3940021ec0e8e463d5dbb4b7b09a89ddf96', simpleToExactAmount(1, 18), 18));
    // console.log('getTokenToWithdrawFromPool', await lens.callStatic.getTokenToWithdrawFromPool('0x4a8686df475D4c44324210FFA3Fc1DEA705296e0'));
    // // console.log('getUserBalances 0,1,2,3,4,5', await lens.callStatic.getUserBalances('0x4181E561b42fDaD14c68b0794c215DeB9Bc80c8F', '0x2f667D66dD3145F9cf9665428fd530902b0F7843', [0,1,2,3,4,5]));
    // // console.log('getUserBalances 6,7,8,9,10', await lens.callStatic.getUserBalances('0x4181E561b42fDaD14c68b0794c215DeB9Bc80c8F', '0x2f667D66dD3145F9cf9665428fd530902b0F7843', [6,7,8,9,10]));
    // // console.log('getUserBalances 11,12,13,14,15', await lens.callStatic.getUserBalances('0x4181E561b42fDaD14c68b0794c215DeB9Bc80c8F', '0x2f667D66dD3145F9cf9665428fd530902b0F7843', [11,12,13,14,15]));
    // // console.log('getUserBalances 16,17', await lens.callStatic.getUserBalances('0x4181E561b42fDaD14c68b0794c215DeB9Bc80c8F', '0x2f667D66dD3145F9cf9665428fd530902b0F7843', [16,17]));
    // console.log('getUserWmxWom', await lens.callStatic.getUserWmxWom('0x4181E561b42fDaD14c68b0794c215DeB9Bc80c8F', '0x19e6776e35e4afbffd4f51a792113382757940a8', '0x2f667D66dD3145F9cf9665428fd530902b0F7843'));
    // console.log('getUserLocker', await lens.callStatic.getUserLocker('0xdd76ce773ce8bd29d32c8389197e98a6e4c1c1a5', '0x2f667D66dD3145F9cf9665428fd530902b0F7843'));
    // console.log('getUserBalancesDefault', await lens.callStatic.getUserBalancesDefault('0x4181E561b42fDaD14c68b0794c215DeB9Bc80c8F', '0x2f667D66dD3145F9cf9665428fd530902b0F7843'));
});

task("gauge-voting:arbitrum").setAction(async function (taskArguments: TaskArguments, hre) {
    const bnbConfig = JSON.parse(fs.readFileSync('./arbitrum.json', {encoding: 'utf8'}));
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(100000000),
    })) as any;

    const treasuryMultisig = '0x7429A2e8dC807c9e13Bb65edb335D6E01051aE64';
    const gaugeVotingArgs = [
        bnbConfig.cvxLocker,
        bnbConfig.booster,
        '0x3f90a5a47364c0467031fB00246192d40E3D2D9D',
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

task("earmark-rewards-lens:arbitrum").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: ethers.BigNumber.from(100000000),
    })) as any;

    const earmarkRewardsLensArgs = ['0x24D2f6be2bF9cdf3627f720cf09D4551580C1eC1'];
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
    console.log('earmarkRewardsLens', earmarkRewardsLens.address);
    const {tokensSymbols, diffBalances} = await earmarkRewardsLens.getRewards();
    tokensSymbols.map((symbol, index) => {
        console.log(symbol, diffBalances[index]);
    })
});
