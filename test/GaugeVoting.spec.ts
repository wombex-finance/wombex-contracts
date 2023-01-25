import hre, { ethers } from "hardhat";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    Booster,
    SafeMoon__factory,
    SafeMoon,
    MockERC20,
    MockERC20__factory,
    WombatBribe__factory,
    WombatBribe,
    GaugeVoting,
    GaugeVoting__factory,
    WombatVoter,
    WombatVoter__factory, TokenFactory, TokenFactory__factory, BribesRewardFactory, BribesRewardFactory__factory,
} from "../types/generated";
import { Signer } from "ethers";
import {getTimestamp, increaseTime} from "../test-utils/time";
import {simpleToExactAmount} from "../test-utils/math";
import {impersonateAccount, ONE_HOUR, ONE_WEEK, ZERO_ADDRESS} from "../test-utils";
import {deployContract, waitForTx} from "../tasks/utils";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe.only("GaugeVoting", () => {
    let accounts: Signer[];
    let booster: Booster, gaugeVoting: GaugeVoting, wombatVoter: WombatVoter;
    let crv, cvx, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy;
    let rewardToken1, rewardToken2, rewardToken3, lptoken1, lptoken2, multiRewarder1, multiRewarder2;
    let mocks: any;
    let pool: Pool;
    let contracts: SystemDeployed;
    let daoSigner: Signer;

    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;
    let voteDelegate: Signer;
    let voteDelegateAddress: string;
    let poker: Signer;
    let pokerAddress: string;
    let treasuryAddress: string;

    const setup = async () => {
        mocks = await deployTestFirstStage(hre, deployer);
        ({crv} = mocks);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        ({treasuryMultisig: treasuryAddress} = multisigs);
        const distro = getMockDistro();

        contracts = await deploy(hre, deployer, daoSigner, mocks, distro, multisigs, mocks.namingConfig, mocks);

        ({ cvx, booster, cvxLocker, cvxStakingProxy, cvxCrvRewards, veWom } = contracts);

        pool = await booster.poolInfo(0);

        // transfer LP tokens to accounts
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        bob = accounts[2];
        bobAddress = await bob.getAddress();
        voteDelegate = accounts[3];
        voteDelegateAddress = await voteDelegate.getAddress();
        poker = accounts[4];
        pokerAddress = await poker.getAddress();
    };

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
        await setup();
    });

    describe("performing core functions with deflationary token", async () => {
        before(async () => {
            wombatVoter = await deployContract<WombatVoter>(
                hre,
                new WombatVoter__factory(deployer),
                "WombatVoter",
                [
                    crv.address,
                    veWom.address,
                    0,
                    (await getTimestamp()).add(1),
                    (await getTimestamp()).add(1),
                    1000
                ],
                {},
                true,
            );

            gaugeVoting = await deployContract<GaugeVoting>(
                hre,
                new GaugeVoting__factory(deployer),
                "GaugeVoting",
                [
                    cvxLocker.address,
                    booster.address,
                    wombatVoter.address
                ],
                {},
                true,
            );

            await booster.setVoteDelegate()

            const tokenFactory = await deployContract<TokenFactory>(
                hre,
                new TokenFactory__factory(deployer),
                "TokenFactory",
                [
                    gaugeVoting.address,
                    "",
                    ""
                ],
                {},
                true,
            );

            const rewardPoolFactory = await deployContract<BribesRewardFactory>(
                hre,
                new BribesRewardFactory__factory(deployer),
                "BribesRewardFactory",
                [
                    gaugeVoting.address
                ],
                {},
                true,
            );

            await gaugeVoting.setFactories(tokenFactory.address, rewardPoolFactory.address, ZERO_ADDRESS);

            rewardToken1 = await deployContract<SafeMoon>(hre, new SafeMoon__factory(deployer), "SafeMoon", [], {}, true);
            rewardToken2 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockERC20", ["Mock1", "M1", 18, deployerAddress, simpleToExactAmount(1000000)], {}, true);
            rewardToken3 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockERC20", ["Mock2", "M2", 18, deployerAddress, simpleToExactAmount(1000000)], {}, true);

            lptoken1 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockLP", ["MockLP1", "MockLP1", 18, deployerAddress, simpleToExactAmount(1000000)],{},true);
            lptoken2 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockLP", ["MockLP2", "MockLP2", 18, deployerAddress, simpleToExactAmount(1000000)],{},true);

            multiRewarder1 = await deployContract<WombatBribe>(
                hre,
                new WombatBribe__factory(deployer),
                "WombatBribe",
                [
                    wombatVoter.address,
                    ZERO_ADDRESS,
                    (await getTimestamp()).add(1),
                    rewardToken1.address,
                    152207
                ],
                {},
                true,
            );
            await multiRewarder1.addRewardToken(rewardToken2.address, 142207).then(tx => tx.wait());
            await rewardToken1.transfer(multiRewarder1.address, simpleToExactAmount(10000, 9)).then(tx => tx.wait());
            await rewardToken2.transfer(multiRewarder1.address, simpleToExactAmount(10000, 9)).then(tx => tx.wait());

            multiRewarder2 = await deployContract<WombatBribe>(
                hre,
                new WombatBribe__factory(deployer),
                "WombatBribe",
                [
                    wombatVoter.address,
                    ZERO_ADDRESS,
                    (await getTimestamp()).add(1),
                    rewardToken3.address,
                    152207
                ],
                {},
                true,
            );
            await rewardToken3.transfer(multiRewarder2.address, simpleToExactAmount(10000, 9)).then(tx => tx.wait());

            await wombatVoter.add(deployerAddress, lptoken1.address, multiRewarder1.address).then(tx => tx.wait());
            await wombatVoter.add(deployerAddress, lptoken2.address, multiRewarder2.address).then(tx => tx.wait());

            const operatorAccount = await impersonateAccount(booster.address);
            await cvx
                .connect(operatorAccount.signer)
                .mint(deployerAddress, simpleToExactAmount(1000, 18))
                .then(tx => tx.wait());

            const balance = await cvx.balanceOf(deployerAddress);
            for (const account of [alice, bob]) {
                const accountAddress = await account.getAddress();
                await cvx.transfer(accountAddress, balance.div(2)).then(tx => tx.wait());
            }
        });

        it("@method Booster.deposit", async () => {
            await cvx.connect(bob).approve(cvxLocker.address, simpleToExactAmount(10)).then(tx => tx.wait());
            await cvxLocker.connect(bob).lock(bobAddress, simpleToExactAmount(10)).then(tx => tx.wait());
            await cvxLocker.connect(bob).delegate(bobAddress).then(tx => tx.wait());
            await cvxLocker.connect(bob)['getReward(address)'](bobAddress).then(tx => tx.wait());

            await cvx.connect(alice).approve(cvxLocker.address, simpleToExactAmount(20)).then(tx => tx.wait());
            await cvxLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(20)).then(tx => tx.wait());
            await cvxLocker.connect(alice).delegate(aliceAddress).then(tx => tx.wait());
            await cvxLocker.connect(alice)['getReward(address)'](aliceAddress).then(tx => tx.wait());

            console.log('getVotes', await cvxLocker.getVotes(bobAddress));
            console.log('balanceOf', await cvxLocker.balanceOf(bobAddress));

            await increaseTime(ONE_WEEK);

            console.log('numCheckpoints', await cvxLocker.numCheckpoints(bobAddress));
            console.log('getVotes', await cvxLocker.getVotes(bobAddress));
            console.log('balanceOf', await cvxLocker.balanceOf(bobAddress));

            await gaugeVoting.registerLpTokens([lptoken1.address, lptoken2.address]).then(tx => tx.wait());

            await gaugeVoting.connect(bob).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(5), simpleToExactAmount(5)]).then(tx => tx.wait());

            await gaugeVoting.connect(poker).voteExecute(pokerAddress);
        });
    });
});
