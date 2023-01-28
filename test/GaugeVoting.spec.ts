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
            await rewardToken1.transfer(multiRewarder1.address, simpleToExactAmount(100000, 9)).then(tx => tx.wait());
            await rewardToken2.transfer(multiRewarder1.address, simpleToExactAmount(100000, 9)).then(tx => tx.wait());

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
            await rewardToken3.transfer(multiRewarder2.address, simpleToExactAmount(100000, 9)).then(tx => tx.wait());

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

            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));
            expect(await gaugeVoting.boostedUserVotes(bobAddress, false)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, false)).eq(simpleToExactAmount(20));

            console.log('numCheckpoints', await cvxLocker.numCheckpoints(bobAddress));
            console.log('getVotes', await cvxLocker.getVotes(bobAddress));
            console.log('balanceOf', await cvxLocker.balanceOf(bobAddress));

            const reward1Address = await gaugeVoting.lpTokenRewards(lptoken1.address);
            const reward2Address = await gaugeVoting.lpTokenRewards(lptoken2.address);
            const reward1 = BaseRewardPool4626__factory.connect(reward1Address, alice);
            const reward2 = BaseRewardPool4626__factory.connect(reward2Address, alice);

            expect(await reward1.balanceOf(bobAddress)).eq(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));

            await gaugeVoting.connect(bob).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(5), simpleToExactAmount(5)]).then(tx => tx.wait());

            expect(await reward1.balanceOf(bobAddress)).eq(simpleToExactAmount(5));
            expect(await reward1.balanceOf(aliceAddress)).eq(0);
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));

            await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            await increaseTime(ONE_DAY);

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [simpleToExactAmount(9), simpleToExactAmount(11)]).then(tx => tx.wait());

            expect(await reward1.balanceOf(bobAddress)).eq(simpleToExactAmount(5));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));
            expect(await gaugeVoting.boostedUserVotes(bobAddress, true)).eq(simpleToExactAmount(10));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));

            await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            await increaseTime(ONE_DAY);

            console.log('bob claimableRewards 1', await reward1.claimableRewards(bobAddress));
            console.log('bob claimableRewards 2', await reward2.claimableRewards(bobAddress));

            console.log('alice claimableRewards 1', await reward1.claimableRewards(aliceAddress));
            console.log('alice claimableRewards 2', await reward2.claimableRewards(aliceAddress));

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

            console.log('bobAddress', bobAddress);
            console.log('claimableRewards', claimableRewards);
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

        it("@method Booster.deposit", async () => {
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(0);
            const incrEther = simpleToExactAmount(1);
            const decrEther = '-' + simpleToExactAmount(1).toString();
            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther])).to.be.revertedWith("no votes");
            console.log('1 lockedBalances', await cvxLocker.lockedBalances(aliceAddress));
            await cvxLocker.connect(alice).processExpiredLocks(true).then(tx => tx.wait());
            console.log('2 lockedBalances', await cvxLocker.lockedBalances(aliceAddress));
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(simpleToExactAmount(20));
            expect(await gaugeVoting.userVotes(aliceAddress)).eq(simpleToExactAmount(20));
            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther])).to.be.revertedWith("votes overflow");

            const reward1 = BaseRewardPool4626__factory.connect(await gaugeVoting.lpTokenRewards(lptoken1.address), alice);
            const reward2 = BaseRewardPool4626__factory.connect(await gaugeVoting.lpTokenRewards(lptoken2.address), alice);

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [decrEther, decrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.userVotes(aliceAddress)).eq(simpleToExactAmount(18));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(8));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [decrEther, decrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.userVotes(aliceAddress)).eq(simpleToExactAmount(16));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(7));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));

            await gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.userVotes(aliceAddress)).eq(simpleToExactAmount(18));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(8));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await gaugeVoting.connect(alice).vote([lptoken1.address], [incrEther]).then(tx => tx.wait());
            expect(await gaugeVoting.userVotes(aliceAddress)).eq(simpleToExactAmount(19));
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));
            expect(await reward2.balanceOf(aliceAddress)).eq(simpleToExactAmount(10));

            await expect(gaugeVoting.connect(alice).vote([lptoken1.address, lptoken2.address], [incrEther, incrEther])).to.be.revertedWith("votes overflow");

            await increaseTime(ONE_WEEK.mul(20));

            const reward1Tokens = [rewardToken1, rewardToken2];
            const rewardPool1Balance = {};
            for(let i = 0; i < reward1Tokens.length; i++) {
                rewardPool1Balance[rewardToken1.address.toLowerCase()] = await reward1Tokens[i].balanceOf(reward1.address);
            }

            let res = await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());

            const lpTokensArr = [lptoken1.address, lptoken2.address];
            const VoteExecuteEvent = res.events.filter(e => e.event === 'VoteExecute')[0];
            expect(VoteExecuteEvent).not.eq(undefined);
            expect(VoteExecuteEvent.args.lpTokens).deep.eq(lpTokensArr);

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
            expect(await gaugeVoting.boostedUserVotes(aliceAddress, true)).eq(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(simpleToExactAmount(9));

            await increaseTime(ONE_WEEK.mul(2));

            res = await gaugeVoting.connect(poker).voteExecute(pokerAddress).then(tx => tx.wait());
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
            console.log('claimableRewards', claimableRewards);
            expect(claimableRewards.tokens.length).gt(0);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                aliceBalancesBefore[i] = await token.balanceOf(aliceAddress);
                expect(claimableRewards.amounts[i]).gt(0);
            }
            await reward1["getReward(address,bool)"](aliceAddress, false).then(tx => tx.wait());
            expect(await gaugeVoting.userVotes(aliceAddress)).eq(0);
            expect(await reward1.balanceOf(aliceAddress)).eq(0);

            claimableRewards = await reward1.claimableRewards(aliceAddress);
            expect(claimableRewards.tokens.length).gt(0);
            for (let i = 0; i < claimableRewards.tokens.length; i++) {
                const token = BaseRewardPool4626__factory.connect(claimableRewards.tokens[i], alice);
                expect(await token.balanceOf(aliceAddress)).gt(aliceBalancesBefore[i]);
                expect(claimableRewards.amounts[i]).eq(0);
            }
        });
    });
});
