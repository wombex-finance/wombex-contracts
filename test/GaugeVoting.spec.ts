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
    WomDepositor,
    BaseRewardPool4626__factory,
    BribesTokenFactory__factory,
    BribesTokenFactory,
    BribesRewardPool__factory,
    BribesRewardPool,
    BribesVotingToken__factory,
    GaugeVotingLens,
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
    let booster: Booster, gaugeVoting: GaugeVoting, gaugeVotingLens: GaugeVotingLens, wombatVoter: WombatVoter, womDepositor: WomDepositor;
    let crv, cvx, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy;
    let rewardToken1, rewardToken2, rewardToken3, lptoken1, lptoken2, multiRewarder1, multiRewarder2;
    let reward1: BribesRewardPool, reward2: BribesRewardPool;
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

    describe("performing vote functions", async () => {
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

            // gaugeVotingLens = await deployContract<GaugeVotingLens>(
            //     hre,
            //     new GaugeVotingLens__factory(deployer),
            //     "GaugeVotingLens",
            //     [gaugeVoting.address],
            //     {},
            //     true,
            // );

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

            lptoken1 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockLP", ["MockLP1", "MLP1", 18, deployerAddress, simpleToExactAmount(1000000)],{},true);
            lptoken2 = await deployContract<MockERC20>(hre, new MockERC20__factory(deployer), "MockLP", ["MockLP2", "MLP2", 18, deployerAddress, simpleToExactAmount(1000000)],{},true);

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
            await rewardToken1.transfer(multiRewarder1.address, simpleToExactAmount(100000, 18)).then(tx => tx.wait());
            await rewardToken2.transfer(multiRewarder1.address, simpleToExactAmount(100000, 18)).then(tx => tx.wait());

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
            await rewardToken3.transfer(multiRewarder2.address, simpleToExactAmount(100000, 18)).then(tx => tx.wait());

            await wombatVoter.add(deployerAddress, lptoken1.address, multiRewarder1.address).then(tx => tx.wait());
            await wombatVoter.add(deployerAddress, lptoken2.address, multiRewarder2.address).then(tx => tx.wait());

            await gaugeVoting.registerLpTokens([lptoken1.address, lptoken2.address]).then(tx => tx.wait());
            // await gaugeVoting.approveRewards().then(tx => tx.wait());

            await gaugeVoting.transferOwnership(await daoSigner.getAddress()).then(tx => tx.wait());

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

            reward1 = BribesRewardPool__factory.connect(await gaugeVoting.lpTokenRewards(lptoken1.address), alice);
            reward2 = BribesRewardPool__factory.connect(await gaugeVoting.lpTokenRewards(lptoken2.address), alice);
        });

        it("BribesRewardPool should have proper values", async () => {
            expect(await reward1.name()).eq("MockLP1 Bribes Vault");
            expect(await reward1.symbol()).eq("MLP1-bribes");
            expect(await reward1.pid()).eq(0);
            expect(await reward1.operator()).eq(gaugeVoting.address);
            expect(await reward1.boosterRewardToken()).eq(ZERO_ADDRESS);
            expect(await reward1.stakingToken()).eq(await gaugeVoting.stakingToken());
            expect(await reward1.asset()).eq(lptoken1.address);
            expect(await reward1.callOperatorOnGetReward()).eq(true);
            expect(await reward1.duration()).eq(ONE_WEEK);
            expect(await reward1.DURATION()).eq(ONE_WEEK);
            expect(await reward1.newRewardRatio()).eq(830);
            expect(await reward1.NEW_REWARD_RATIO()).eq(830);
            expect(await reward1.pid()).eq(0);
        });

        it("GaugeVoting should BribesRewardPool set config", async () => {
            await expect(gaugeVoting.updateBribeRewardsConfig([reward1.address], false)).to.be.revertedWith("Ownable: caller is not the owner");
            await gaugeVoting.connect(daoSigner).updateBribeRewardsConfig([reward1.address], false).then(tx => tx.wait(1));
            expect(await reward1.callOperatorOnGetReward()).eq(false);
            await gaugeVoting.connect(daoSigner).updateBribeRewardsConfig([reward1.address], true).then(tx => tx.wait(1));
            expect(await reward1.callOperatorOnGetReward()).eq(true);

            await expect(gaugeVoting.updateRatioConfig([reward1.address], ONE_DAY, 100)).to.be.revertedWith("Ownable: caller is not the owner");
            await gaugeVoting.connect(daoSigner).updateRatioConfig([reward1.address], ONE_DAY, 100).then(tx => tx.wait(1));
            expect(await reward1.duration()).eq(ONE_DAY);
            expect(await reward1.DURATION()).eq(ONE_DAY);
            expect(await reward1.newRewardRatio()).eq(100);
            expect(await reward1.NEW_REWARD_RATIO()).eq(100);
            await gaugeVoting.connect(daoSigner).updateRatioConfig([reward1.address], ONE_WEEK, 830).then(tx => tx.wait(1));
            expect(await reward1.duration()).eq(ONE_WEEK);
            expect(await reward1.DURATION()).eq(ONE_WEEK);
            expect(await reward1.newRewardRatio()).eq(830);
            expect(await reward1.NEW_REWARD_RATIO()).eq(830);

            expect(await reward1.tokenRewards(rewardToken1.address).then(r => r.paused)).eq(false);
            await expect(gaugeVoting.setRewardTokenPausedInPools([reward1.address], rewardToken1.address, true)).to.be.revertedWith("Ownable: caller is not the owner");
            await gaugeVoting.connect(daoSigner).setRewardTokenPausedInPools([reward1.address], rewardToken1.address, true).then(tx => tx.wait(1));
            expect(await reward1.tokenRewards(rewardToken1.address).then(r => r.paused)).eq(true);
            await gaugeVoting.connect(daoSigner).setRewardTokenPausedInPools([reward1.address], rewardToken1.address, false).then(tx => tx.wait(1));
            expect(await reward1.tokenRewards(rewardToken1.address).then(r => r.paused)).eq(false);
        });

        it("GaugeVoting should migrate BribesRewardPool and staking token", async () => {
            const stakingToken = BribesVotingToken__factory.connect(await gaugeVoting.stakingToken(), deployer);
            expect(await stakingToken.operator()).eq(gaugeVoting.address);
            await expect(gaugeVoting.migrateStakingToken(deployerAddress)).to.be.revertedWith("Ownable: caller is not the owner");
            await gaugeVoting.connect(daoSigner).migrateStakingToken(deployerAddress).then(tx => tx.wait(1));
            expect(await stakingToken.operator()).eq(deployerAddress);
            await expect(stakingToken.connect(daoSigner).updateOperator(gaugeVoting.address)).to.be.revertedWith("!authorized");
            await stakingToken.connect(deployer).updateOperator(gaugeVoting.address).then(tx => tx.wait(1));
            expect(await stakingToken.operator()).eq(gaugeVoting.address);

            await expect(gaugeVoting.migrateRewards([reward1.address], deployerAddress)).to.be.revertedWith("Ownable: caller is not the owner");
            await gaugeVoting.connect(daoSigner).migrateRewards([reward1.address], deployerAddress).then(tx => tx.wait(1));
            expect(await reward1.operator()).eq(deployerAddress);

            await expect(reward1.connect(daoSigner).updateOperatorData(gaugeVoting.address, 0)).to.be.revertedWith("!authorized");
            await reward1.connect(deployer).updateOperatorData(gaugeVoting.address, 0).then(tx => tx.wait(1));
            expect(await reward1.operator()).eq(gaugeVoting.address);
        });

        it("BribesRewardPool direct stake and withdraw methods should be disabled", async () => {
            await lptoken1.transfer(bobAddress, simpleToExactAmount(10)).then(tx => tx.wait());
            await lptoken1.connect(bob).approve(reward1.address, simpleToExactAmount(10)).then(tx => tx.wait());
            await expect(reward1.connect(bob).deposit(simpleToExactAmount(10), bobAddress)).to.be.revertedWith("Transaction reverted: function selector was not recognized and there's no fallback function");
            await expect(reward1.connect(bob).mint(simpleToExactAmount(10), bobAddress)).to.be.revertedWith("Transaction reverted: function selector was not recognized and there's no fallback function");

            await expect(reward1.connect(bob).stake(simpleToExactAmount(10))).to.be.revertedWith("disabled");
            await expect(reward1.connect(bob).stakeFor(bobAddress, simpleToExactAmount(10))).to.be.revertedWith("!operator");
            await expect(reward1.connect(bob).stakeAll()).to.be.revertedWith("disabled");
            await expect(reward1.connect(bob)['withdraw(uint256,bool)'](simpleToExactAmount(10), false)).to.be.revertedWith("disabled");
            await expect(reward1.connect(bob)['withdraw(uint256,address,address)'](simpleToExactAmount(1), bobAddress, bobAddress)).to.be.revertedWith("disabled");
            await expect(reward1.connect(bob)['redeem(uint256,address,address)'](simpleToExactAmount(1), bobAddress, bobAddress)).to.be.revertedWith("disabled");
            await expect(reward1.connect(bob).withdrawAndUnwrap(simpleToExactAmount(10), false)).to.be.revertedWith("disabled");
            await expect(reward1.connect(bob).withdrawAllAndUnwrap(false)).to.be.revertedWith("disabled");
            await expect(reward1.connect(bob).withdrawAndUnwrapFrom(bobAddress, simpleToExactAmount(10), bobAddress)).to.be.revertedWith("!operator");
        });

        it("GaugeVoting config should be able to change by owner", async () => {
            // expect(await gaugeVotingLens.getPools(ZERO_ADDRESS).then(pools => pools.map(p => p.lpToken))).deep.eq([lptoken1.address, lptoken2.address]);
            expect(await gaugeVoting.getLpTokensAdded()).deep.eq([lptoken1.address, lptoken2.address]);
            expect(await gaugeVoting.votePeriod()).eq(0);
            expect(await gaugeVoting.voteThreshold()).eq(0);
            expect(await gaugeVoting.voteIncentive()).eq(0);
            expect(await gaugeVoting.executeOnVote()).eq(false);

            await expect(gaugeVoting.setVotingConfig(ONE_DAY, simpleToExactAmount(10), 100, true, true)).to.be.revertedWith("Ownable: caller is not the owner");
            await gaugeVoting.connect(daoSigner).setVotingConfig(ONE_DAY, simpleToExactAmount(10), 100, true, false).then(tx => tx.wait(1));

            expect(await gaugeVoting.votePeriod()).eq(ONE_DAY);
            expect(await gaugeVoting.voteThreshold()).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.voteIncentive()).eq(100);
            expect(await gaugeVoting.executeOnVote()).eq(true);
            expect(await gaugeVoting.addRewardOnExecute()).eq(false);

            await gaugeVoting.connect(daoSigner).setVotingConfig(0, 0, 0, false, true).then(tx => tx.wait(1));

            expect(await gaugeVoting.votePeriod()).eq(0);
            expect(await gaugeVoting.voteThreshold()).eq(0);
            expect(await gaugeVoting.voteIncentive()).eq(0);
            expect(await gaugeVoting.executeOnVote()).eq(false);
            expect(await gaugeVoting.addRewardOnExecute()).eq(true);

            expect(await gaugeVoting.nftLocker()).eq(ZERO_ADDRESS);
            await expect(gaugeVoting.setNftLocker(deployerAddress)).to.be.revertedWith("Ownable: caller is not the owner");
            await gaugeVoting.connect(daoSigner).setNftLocker(deployerAddress).then(tx => tx.wait(1));
            expect(await gaugeVoting.nftLocker()).eq(deployerAddress);
            await gaugeVoting.connect(daoSigner).setNftLocker(ZERO_ADDRESS).then(tx => tx.wait(1));
            expect(await gaugeVoting.nftLocker()).eq(ZERO_ADDRESS);
        });

        it("methods vote, voteExecute and onVotesChanged should work properly", async () => {
            await cvx.connect(bob).approve(cvxLocker.address, simpleToExactAmount(10)).then(tx => tx.wait());
            await cvxLocker.connect(bob).lock(bobAddress, simpleToExactAmount(10)).then(tx => tx.wait());
            await cvxLocker.connect(bob)['getReward(address)'](bobAddress).then(tx => tx.wait());

            await cvx.connect(alice).approve(cvxLocker.address, simpleToExactAmount(20)).then(tx => tx.wait());
            await cvxLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(20)).then(tx => tx.wait());
            await cvxLocker.connect(alice)['getReward(address)'](aliceAddress).then(tx => tx.wait());

            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));
            expect(await gaugeVoting.boostedUserVotes(bobAddress, false)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, false)).eq(simpleToExactAmount(20));

            expect(await reward1.balanceOf(bobAddress)).eq(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));

            await gaugeVoting.connect(bob).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(5), simpleToExactAmount(5)]).then(tx => tx.wait());

            // console.log('gaugeVotingLens.getPools', await gaugeVotingLens.getPools());
            expect(await reward1.balanceOf(bobAddress)).eq(simpleToExactAmount(5));
            expect(await reward1.balanceOf(aliceAddress)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));

            await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());
            // console.log('gaugeVotingLens.getPools', await gaugeVotingLens.getPools());

            await increaseTime(ONE_DAY);

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(9), simpleToExactAmount(11)]).then(tx => tx.wait());
            // console.log('gaugeVotingLens.getPools', await gaugeVotingLens.getPools());

            expect(await reward1.balanceOf(bobAddress)).eq(simpleToExactAmount(5));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));

            await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            await increaseTime(ONE_DAY);

            await gaugeVoting.connect(poker).onVotesChanged(bobAddress, pokerAddress).then(tx => tx.wait());
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await reward1.balanceOf(bobAddress)).eq(simpleToExactAmount(5));

            await increaseTime(ONE_WEEK.mul(18));
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress, false)).eq(simpleToExactAmount(10));

            await cvxLocker.connect(bob).processExpiredLocks(false).then(tx => tx.wait());
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress, false)).eq(0);

            const pokerBalancesBefore = [];
            const bobBalancesBefore = [];
            let claimableRewards = await reward1.claimableRewards(bobAddress);
            expect(claimableRewards.tokens.length).gt(0);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                pokerBalancesBefore[i] = await token.balanceOf(pokerAddress);
                bobBalancesBefore[i] = await token.balanceOf(bobAddress);
                expect(claimableRewards.amounts[i]).gt(0);
            }

            await gaugeVoting.connect(poker).onVotesChanged(bobAddress, pokerAddress).then(tx => tx.wait());
            expect(await reward1.balanceOf(bobAddress)).eq(0);

            claimableRewards = await reward1.claimableRewards(bobAddress);
            expect(claimableRewards.tokens.length).gt(0);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                expect(await token.balanceOf(pokerAddress)).gt(pokerBalancesBefore[i]);
                expect(await token.balanceOf(bobAddress)).eq(bobBalancesBefore[i]);
                expect(claimableRewards.amounts[i]).eq(0);
            }
        });

        it("re-vote and GaugeVoting callback should work properly", async () => {
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(0);
            const incrEther = simpleToExactAmount(1);
            const decrEther = '-' + simpleToExactAmount(1).toString();
            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther])).to.be.revertedWith("no votes");
            await cvxLocker.connect(alice).processExpiredLocks(true).then(tx => tx.wait());
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(simpleToExactAmount(20));
            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther])).to.be.revertedWith("votes overflow");

            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther])).to.be.revertedWith("votes overflow");

            let res = await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [decrEther, decrEther]).then(tx => tx.wait());
            console.log('vote cumulativeGasUsed', res.cumulativeGasUsed)
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(simpleToExactAmount(18));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(8));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [decrEther, decrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(simpleToExactAmount(16));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(7));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(simpleToExactAmount(18));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(8));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await gaugeVoting.connect(alice).vote([lptoken1.address], [incrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(simpleToExactAmount(19));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken1.address, lptoken1.address, lptoken1.address], [decrEther, decrEther, decrEther, decrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(simpleToExactAmount(15));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(5));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address, lptoken2.address], [incrEther, incrEther, decrEther])).to.be.revertedWith("< lastDelta");

            res = await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken1.address, lptoken1.address, lptoken1.address, lptoken1.address, lptoken1.address], [decrEther, incrEther, incrEther, incrEther, incrEther, incrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(simpleToExactAmount(19));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            let VoteExecuteEvent = res.events.filter(e => e.event === 'VoteExecute')[0];
            expect(VoteExecuteEvent).eq(undefined);

            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther])).to.be.revertedWith("votes overflow");

            await increaseTime(ONE_WEEK.mul(1));

            const reward1Tokens = [rewardToken1, rewardToken2];
            const rewardPool1Balance = {};
            for(let i = 0; i < reward1Tokens.length; i++) {
                rewardPool1Balance[rewardToken1.address.toLowerCase()] = await reward1Tokens[i].balanceOf(reward1.address);
            }

            await gaugeVoting.connect(daoSigner).setVotingConfig(0, 0, 100, true, true);
            res = await gaugeVoting.connect(alice).vote([lptoken1.address], [incrEther]).then(tx => tx.wait());

            const lpTokensArr = [lptoken1.address, lptoken2.address];
            VoteExecuteEvent = res.events.filter(e => e.event === 'VoteExecute')[0];
            expect(VoteExecuteEvent).not.eq(undefined);
            expect(VoteExecuteEvent.args.lpTokens).deep.eq(lpTokensArr);

            let TransferIncentiveRewards = res.events.filter(e => e.event === 'TransferRewards' && !e.args.queueRewards)[0];
            expect(TransferIncentiveRewards).not.eq(undefined);
            expect(TransferIncentiveRewards.args.recipient).eq(aliceAddress);
            expect(TransferIncentiveRewards.args.rewardAmount).gt(0);

            let DistributeBribeRewardsEvents = res.events.filter(e => e.event === 'DistributeBribeRewards');
            expect(DistributeBribeRewardsEvents.length).eq(2);
            let rewardsDistributed = {};
            DistributeBribeRewardsEvents.forEach((e, i) => {
                expect(e.args.lpToken).eq(lpTokensArr[i]);
                rewardsDistributed[reward1.address.toLowerCase()] = true;
                expect(e.args.rewardAmounts.length).gt(0);
                e.args.rewardAmounts.forEach((amount) => {
                    expect(amount).gt(0);
                });
            });

            for(let i = 0; i < reward1Tokens.length; i++) {
                expect(await reward1Tokens[i].balanceOf(reward1.address)).gt(rewardPool1Balance[rewardToken1.address.toLowerCase()]);
            }

            expect(rewardsDistributed[reward1.address.toLowerCase()]).eq(true);

            await increaseTime(ONE_WEEK.mul(20));

            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await gaugeVoting.connect(daoSigner).setVotingConfig(0, 0, 0, false, true);
            res = await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            TransferIncentiveRewards = res.events.filter(e => e.event === 'TransferRewards' && !e.args.queueRewards)[0];
            expect(TransferIncentiveRewards).eq(undefined);

            DistributeBribeRewardsEvents = res.events.filter(e => e.event === 'DistributeBribeRewards');
            expect(DistributeBribeRewardsEvents.length).eq(2);
            DistributeBribeRewardsEvents.forEach((e, i) => {
                expect(e.args.lpToken).eq(lpTokensArr[i]);
                expect(e.args.rewardAmounts.length).gt(0);
                e.args.rewardAmounts.forEach((amount) => {
                    expect(amount).gt(0);
                });
            });

            const aliceBalancesBefore = [];
            let claimableRewards = await reward1.claimableRewards(aliceAddress);
            expect(claimableRewards.tokens.length).gt(0);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                aliceBalancesBefore[i] = await token.balanceOf(aliceAddress);
                expect(claimableRewards.amounts[i]).gt(0);
            }
            // console.log('getUserRewards', await gaugeVotingLens.getUserRewards(aliceAddress, 2));
            res = await reward1["getReward(address,bool)"](aliceAddress, false).then(tx => tx.wait());
            console.log('getReward cumulativeGasUsed', res.cumulativeGasUsed)
            expect(await gaugeVoting.getUserVoted(aliceAddress)).eq(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(0);

            claimableRewards = await reward1.claimableRewards(aliceAddress);
            expect(claimableRewards.tokens.length).gt(0);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                expect(await token.balanceOf(aliceAddress)).gt(aliceBalancesBefore[i]);
                expect(claimableRewards.amounts[i]).eq(0);
            }
        });

        it("GaugeVoting should burn deprecated BribesRewardPool", async () => {
            await cvxLocker.connect(alice).processExpiredLocks(true).then(tx => tx.wait());
            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(1), simpleToExactAmount(1)]).then(tx => tx.wait());
            await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            const stakingToken = BribesVotingToken__factory.connect(await gaugeVoting.stakingToken(), deployer);

            const newGaugeVoting = await deployContract<GaugeVoting>(
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
            await booster.connect(daoSigner).setVoteDelegate(newGaugeVoting.address, true).then(tx => tx.wait());
            const rewardPoolFactory = await deployContract<BribesRewardFactory>(
                hre,
                new BribesRewardFactory__factory(deployer),
                "BribesRewardFactory",
                [newGaugeVoting.address],
                {},
                true,
            );

            await gaugeVoting.connect(daoSigner).migrateStakingToken(newGaugeVoting.address).then(tx => tx.wait());
            await newGaugeVoting.setFactories(ZERO_ADDRESS, rewardPoolFactory.address, stakingToken.address).then(tx => tx.wait());

            const rewardPool1Address = await gaugeVoting.lpTokenRewards(lptoken1.address);
            const rewardPool2Address = await gaugeVoting.lpTokenRewards(lptoken2.address);
            await newGaugeVoting.registerCreatedLpTokens([rewardPool1Address]).then(tx => tx.wait());
            await newGaugeVoting.registerLpTokens([lptoken2.address]).then(tx => tx.wait());

            await newGaugeVoting.transferOwnership(await daoSigner.getAddress()).then(tx => tx.wait());

            await expect(newGaugeVoting.burnDeprecatedPools([rewardPool1Address])).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(newGaugeVoting.connect(daoSigner).burnDeprecatedPools([rewardPool1Address])).to.be.revertedWith("!deprecated");

            expect(await newGaugeVoting.getUserVoted(aliceAddress)).lt(await gaugeVoting.getUserVoted(aliceAddress));

            expect(await stakingToken.balanceOf(rewardPool1Address)).gt(0);
            const balance = await stakingToken.balanceOf(rewardPool2Address);
            expect(balance).gt(0);
            const totalSupplyBefore = await stakingToken.totalSupply();
            await newGaugeVoting.connect(daoSigner).burnDeprecatedPools([rewardPool2Address]).then(tx => tx.wait());
            expect(totalSupplyBefore).gt(await stakingToken.totalSupply());
            expect(totalSupplyBefore.sub(balance)).eq(await stakingToken.totalSupply());
            expect(await stakingToken.balanceOf(rewardPool2Address)).eq(0);

            const deprecatedPool = BribesRewardPool__factory.connect(rewardPool2Address, deployer);

            expect(await deprecatedPool.balanceOf(aliceAddress)).gt(0);

            const rewardTokenBalance = await rewardToken1.balanceOf(aliceAddress);
            await reward1["getReward(address,bool)"](aliceAddress, false).then(tx => tx.wait());
            expect(await rewardToken1.balanceOf(aliceAddress)).gt(rewardTokenBalance);
        });
    });
});
