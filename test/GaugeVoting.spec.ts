import hre, { ethers } from "hardhat";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    Booster,
    MockERC20,
    MockERC20__factory,
    WombatBribe__factory,
    WombatBribe,
    GaugeVoting,
    GaugeVoting__factory,
    WombatVoter,
    WombatVoter__factory,
    BribesRewardFactory,
    BribesRewardFactory__factory,
    WomDepositor, BaseRewardPool4626__factory, BribesTokenFactory__factory, BribesTokenFactory,
} from "../types/generated";
import { Signer } from "ethers";
import {getTimestamp, increaseTime} from "../test-utils/time";
import {simpleToExactAmount} from "../test-utils/math";
import {impersonateAccount, ONE_DAY, ONE_HOUR, ONE_WEEK, ZERO_ADDRESS} from "../test-utils";
import {deployContract, waitForTx} from "../tasks/utils";
import {expect} from "chai";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe("GaugeVoting", () => {
    let accounts: Signer[];
    let booster: Booster, gaugeVoting: GaugeVoting, wombatVoter: WombatVoter, womDepositor: WomDepositor;
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

        ({ cvx, booster, crvDepositor: womDepositor, cvxLocker, cvxStakingProxy, cvxCrvRewards, veWom } = contracts);

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

            await booster.connect(daoSigner).setVoteDelegate(gaugeVoting.address, true).then(tx => tx.wait());
            await booster.connect(daoSigner).setVotingValid(wombatVoter.address, true).then(tx => tx.wait());

            const tokenFactory = await deployContract<BribesTokenFactory>(
                hre,
                new BribesTokenFactory__factory(deployer),
                "BribesTokenFactory",
                [gaugeVoting.address],
                {},
                true,
            );

            const rewardPoolFactory = await deployContract<BribesRewardFactory>(
                hre,
                new BribesRewardFactory__factory(deployer),
                "BribesRewardFactory",
                [gaugeVoting.address],
                {},
                true,
            );

            await gaugeVoting.setFactories(tokenFactory.address, rewardPoolFactory.address, ZERO_ADDRESS);

            rewardToken1 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockERC20", ["Mock0", "M0", 18, deployerAddress, simpleToExactAmount(1000000)], {}, true);
            rewardToken2 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockERC20", ["Mock1", "M1", 18, deployerAddress, simpleToExactAmount(1000000)], {}, true);
            rewardToken3 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockERC20", ["Mock2", "M2", 18, deployerAddress, simpleToExactAmount(1000000)], {}, true);

            await booster.connect(daoSigner).setVotingValid(rewardToken1.address, true).then(tx => tx.wait());
            await booster.connect(daoSigner).setVotingValid(rewardToken2.address, true).then(tx => tx.wait());
            await booster.connect(daoSigner).setVotingValid(rewardToken3.address, true).then(tx => tx.wait());

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

            await gaugeVoting.registerLpTokens([lptoken1.address, lptoken2.address]).then(tx => tx.wait());
            await gaugeVoting.approveRewards([rewardToken1.address, rewardToken2.address, rewardToken3.address]).then(tx => tx.wait());

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

            await mocks.crv.transfer(aliceAddress, simpleToExactAmount(2000));
            await mocks.crv.connect(alice).approve(womDepositor.address, await mocks.crv.balanceOf(aliceAddress));
            const amountToDeposit = simpleToExactAmount(200);
            await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, ZERO_ADDRESS).then(r => r.wait(1));
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

            const reward1Address = await gaugeVoting.lpTokenRewards(lptoken1.address);
            const reward2Address = await gaugeVoting.lpTokenRewards(lptoken2.address);
            const reward1 = BaseRewardPool4626__factory.connect(reward1Address, alice);
            const reward2 = BaseRewardPool4626__factory.connect(reward2Address, alice);

            expect(await reward1.balanceOf(bobAddress)).eq(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress)).gt(0);

            await gaugeVoting.connect(bob).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(5), simpleToExactAmount(5)]).then(tx => tx.wait());

            expect(await reward1.balanceOf(bobAddress)).gt(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress)).gt(0);

            await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            await increaseTime(ONE_DAY);

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(9), simpleToExactAmount(11)]).then(tx => tx.wait());

            expect(await reward1.balanceOf(bobAddress)).gt(0);
            expect(await reward1.balanceOf(aliceAddress)).gt(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress)).gt(0);

            await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            await increaseTime(ONE_DAY);

            console.log('bob claimableRewards 1', await reward1.claimableRewards(bobAddress));
            console.log('bob claimableRewards 2', await reward2.claimableRewards(bobAddress));

            console.log('alice claimableRewards 1', await reward1.claimableRewards(aliceAddress));
            console.log('alice claimableRewards 2', await reward2.claimableRewards(aliceAddress));

            await gaugeVoting.connect(poker).onVotesChanged(bobAddress, pokerAddress).then(tx => tx.wait());
            expect(await gaugeVoting.boostedUserVotes(bobAddress)).gt(0);
            expect(await reward1.balanceOf(bobAddress)).gt(0);

            await increaseTime(ONE_WEEK.mul(18));
            expect(await gaugeVoting.boostedUserVotes(bobAddress)).eq(0);

            const pokerBalancesBefore = [];
            const bobBalancesBefore = [];
            let claimableRewards = await reward1.claimableRewards(bobAddress);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                pokerBalancesBefore[i] = await token.balanceOf(pokerAddress);
                bobBalancesBefore[i] = await token.balanceOf(bobAddress);
                expect(claimableRewards.amounts[i]).gt(0);
            }

            console.log('bobAddress', bobAddress);
            console.log('claimableRewards', claimableRewards);
            await gaugeVoting.connect(poker).onVotesChanged(bobAddress, pokerAddress).then(tx => tx.wait());
            expect(await reward1.balanceOf(bobAddress)).eq(0);

            claimableRewards = await reward1.claimableRewards(bobAddress);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                expect(await token.balanceOf(pokerAddress)).gt(pokerBalancesBefore[i]);
                expect(await token.balanceOf(bobAddress)).eq(bobBalancesBefore[i]);
                expect(claimableRewards.amounts[i]).eq(0);
            }
        });
    });
});
