import {task} from "hardhat/config";
import {TaskArguments} from "hardhat/types";
import {deployContract, getSigner} from "../utils";
import {
    IERC20__factory,
    MasterWombatV2__factory,
    ProxyFactory,
    ProxyFactory__factory,
    VoterProxy,
    VoterProxy__factory,
    WETH__factory,
    Wmx__factory, WmxRewardPoolLens, WmxRewardPoolLens__factory,
} from "../../types/generated";
import {deploySideChain} from "../../scripts/deploySystem";
import {impersonate, ZERO_ADDRESS} from "../../test-utils";
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
