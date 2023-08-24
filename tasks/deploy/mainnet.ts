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
    Wmx__factory,
} from "../../types/generated";
import {deploySideChain} from "../../scripts/deploySystem";
import {ZERO_ADDRESS} from "../../test-utils";
const fs = require('fs');
const ethers = require('ethers');
const waitForBlocks = 1;
const debug = true;

task("deploy:mainnet").setAction(async function (taskArguments: TaskArguments, hre) {

    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const daoMultisig = '0x1e6C59aa5B72196666c13c0521774a6971e4e991';
    const vestingMultisig = daoMultisig;
    const treasuryMultisig = daoMultisig;

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: ethers.parseUnits('20', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
    })) as any;

    console.log('deployerAddress', deployerAddress, 'nonce', await hre.ethers.provider.getTransactionCount(deployerAddress), 'blockNumber', await hre.ethers.provider.getBlockNumber());
    const mainnetConfig = JSON.parse(fs.readFileSync('./mainnet.json', {encoding: 'utf8'}));

    const weth = WETH__factory.connect(mainnetConfig.weth, deployer);
    const masterWombat = MasterWombatV2__factory.connect(mainnetConfig.masterWombat, deployer);
    const cvx = Wmx__factory.connect(mainnetConfig.cvx, deployer);
    const crv = IERC20__factory.connect(mainnetConfig.wom, deployer);

    mainnetConfig.token = mainnetConfig.wom;

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
});
