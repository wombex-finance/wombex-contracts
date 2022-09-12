import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deploy, updateDistributionByTokens, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    Booster,
    ERC20__factory,
    BaseRewardPool__factory, MockVoting, MockVoting__factory,
} from "../types/generated";
import { Signer} from "ethers";
import { increaseTime, increaseTimeTo } from "../test-utils/time";
import {simpleToExactAmount} from "../test-utils/math";
import {impersonateAccount} from "../test-utils";
import {deployContract} from "../tasks/utils";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe("Booster", () => {
    let accounts: Signer[];
    let booster: Booster;
    let cvx, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy;
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
    let treasuryAddress: string;

    const setup = async () => {
        mocks = await deployTestFirstStage(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        ({treasuryMultisig: treasuryAddress} = multisigs);
        const distro = getMockDistro();

        contracts = await deploy(hre, deployer, mocks, distro, multisigs, mocks.namingConfig, mocks);
        console.log('updateDistributionByTokens');
        await updateDistributionByTokens(daoSigner, contracts);
        console.log('({ booster, booster, cvxLocker, cvxCrvRewards } = deployment)');
        // await deployment.poolManager.connect(daoSigner).setProtectPool(false);
        // await deployment.booster.connect(daoSigner).setFeeInfo(mocks.lptoken.address, mocks.feeDistribution.address);
        // await deployment.booster.connect(daoSigner).setFeeInfo(mocks.crv.address, mocks.feeDistribution.address);

        ({ cvx, booster, booster, cvxLocker, cvxStakingProxy, cvxCrvRewards, veWom } = contracts);

        console.log('pool = await booster.poolInfo(0)');
        pool = await booster.poolInfo(0);

        // transfer LP tokens to accounts
        console.log('const balance = await mocks.lptoken.balanceOf(deployerAddress)');
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            console.log('const tx = await mocks.lptoken.transfer(accountAddress, share)');
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        bob = accounts[2];
        bobAddress = await bob.getAddress();
        voteDelegate = accounts[3];
        voteDelegateAddress = await voteDelegate.getAddress();
    };

    async function getBoosterReward(tx) {
        tx = await tx.wait(1);
        const log = tx.events.find(e => e.address.toLowerCase() === booster.address.toLowerCase());
        return booster.interface.decodeEventLog('RewardClaimed', log.data, log.topics);
    }

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
        await setup();

        const operatorAccount = await impersonateAccount(booster.address);
        let tx = await cvx
            .connect(operatorAccount.signer)
            .mint(aliceAddress, simpleToExactAmount(100, 18));
        await tx.wait();

        const cvxAmount = simpleToExactAmount(100);
        tx = await cvx.connect(alice).approve(cvxLocker.address, cvxAmount);
        await tx.wait();
        tx = await cvxLocker.connect(alice).lock(aliceAddress, cvxAmount);
        await tx.wait();
    });

    describe("performing core functions", async () => {
        it("@method Booster.deposit", async () => {
            const stake = false;
            const amount = ethers.utils.parseEther("1000");
            let tx = await mocks.lptoken.connect(bob).approve(booster.address, amount);
            await tx.wait();

            tx = await booster.connect(bob).deposit(0, amount, stake);
            await tx.wait();

            const depositToken = ERC20__factory.connect(pool.token, deployer);
            const balance = await depositToken.balanceOf(bobAddress);

            expect(balance).to.equal(amount);
        });

        it("@method BaseRewardPool.stake", async () => {
            const depositToken = ERC20__factory.connect(pool.token, bob);
            const balance = await depositToken.balanceOf(bobAddress);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            let tx = await depositToken.approve(crvRewards.address, balance);
            await tx.wait();

            const stakedBalanceBefore = await crvRewards.balanceOf(bobAddress);

            tx = await crvRewards.stake(balance);
            await tx.wait();

            const stakedBalanceAfter = await crvRewards.balanceOf(bobAddress);

            expect(stakedBalanceAfter.sub(stakedBalanceBefore)).to.equal(balance);
        });

        it("@method BaseRewardPool.getReward", async () => {
            await increaseTime(60 * 60 * 24 * 6);

            let tx = await booster.earmarkRewards(0);
            await tx.wait();

            await increaseTime(60 * 60 * 24 * 6);

            tx = await booster.earmarkRewards(0);
            await tx.wait();

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            const queuedRewards = await crvRewards.tokenRewards(mocks.crv.address).then(r => r.queuedRewards);
            expect(queuedRewards).gt(0);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            tx = await crvRewards["getReward(address,bool)"](bobAddress, false);
            const boosterReward = await getBoosterReward(tx);

            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);
            expect(await cvx.balanceOf(bobAddress)).gt(cvxBalanceBefore);

            const crvBalance = await mocks.crv.balanceOf(bobAddress);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = await crvRewards.rewardPerToken(mocks.crv.address);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });

        it("@method BaseRewardPool.processIdleRewards()", async () => {
            await increaseTime(60 * 60 * 24 * 6);
            await booster.earmarkRewards(0);
            await increaseTime(60 * 60 * 24 * 6);
            await booster.earmarkRewards(0);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            const queuedRewards = await crvRewards.tokenRewards(mocks.crv.address).then(r => r.queuedRewards);
            expect(queuedRewards).gt(0);

            const periodFinish = await crvRewards.tokenRewards(mocks.crv.address).then(r => r.periodFinish);
            await increaseTimeTo(periodFinish);

            await crvRewards.processIdleRewards();
            const queuedRewardsAfter = await crvRewards.tokenRewards(mocks.crv.address).then(r => r.queuedRewards);
            expect(queuedRewardsAfter).eq(0);
        });

        it("@method BaseRewardPool.getReward with lock ", async () => {
            expect(await booster.extraRewardsDist()).eq(contracts.extraRewardsDistributor.address);
            expect(await booster.cvxLocker()).eq(contracts.cvxLocker.address);

            await increaseTime(60 * 60 * 24 * 6);

            let tx = await booster.earmarkRewards(0);
            await tx.wait();

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            const extraDistrBalanceBefore = await cvx.balanceOf(contracts.extraRewardsDistributor.address);
            const lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            tx = await crvRewards["getReward(address,bool)"](bobAddress, true);
            const boosterReward = await getBoosterReward(tx);

            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(true);

            expect(await cvx.balanceOf(bobAddress)).eq(cvxBalanceBefore);
            expect(await cvx.balanceOf(contracts.extraRewardsDistributor.address)).eq(extraDistrBalanceBefore);
            expect(await contracts.cvxLocker.balances(bobAddress).then(b => b.locked)).gt(lockerBalanceBefore);

            const crvBalance = await mocks.crv.balanceOf(bobAddress);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = await crvRewards.rewardPerToken(mocks.crv.address);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });

        it("@method BaseRewardPool.getReward with lock and mintRatio", async () => {
            expect(await booster.extraRewardsDist()).eq(contracts.extraRewardsDistributor.address);
            expect(await booster.cvxLocker()).eq(contracts.cvxLocker.address);

            await increaseTime(60 * 60 * 24 * 6);

            let tx = await booster.earmarkRewards(0);
            await tx.wait();

            await expect(booster.setMintRatio(8000)).to.be.revertedWith("!auth");
            await expect(booster.connect(daoSigner).setMintRatio(7999)).to.be.revertedWith("!boundaries");
            await expect(booster.connect(daoSigner).setMintRatio(12001)).to.be.revertedWith("!boundaries");
            const mintRatio = 8000;
            tx = await booster.connect(daoSigner).setMintRatio(mintRatio);
            await tx.wait();

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            const extraDistrBalanceBefore = await cvx.balanceOf(contracts.extraRewardsDistributor.address);
            const lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            tx = await crvRewards["getReward(address,bool)"](bobAddress, true);
            const boosterReward = await getBoosterReward(tx);

            expect(boosterReward.mintAmount).eq(boosterReward.amount.mul(mintRatio).div(10000));
            expect(boosterReward.lock).eq(true);

            expect(await cvx.balanceOf(bobAddress)).eq(cvxBalanceBefore);
            expect(await cvx.balanceOf(contracts.extraRewardsDistributor.address)).eq(extraDistrBalanceBefore);
            expect(await contracts.cvxLocker.balances(bobAddress).then(b => b.locked)).gt(lockerBalanceBefore);

            const crvBalance = await mocks.crv.balanceOf(bobAddress);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = await crvRewards.rewardPerToken(mocks.crv.address);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });

        it("@method BaseRewardPool.getReward without lock", async () => {
            expect(await booster.extraRewardsDist()).eq(contracts.extraRewardsDistributor.address);
            expect(await booster.cvxLocker()).eq(contracts.cvxLocker.address);

            await increaseTime(60 * 60 * 24 * 6);

            let tx = await booster.earmarkRewards(0);
            await tx.wait();

            tx = await booster.connect(daoSigner).setMintRatio(0);
            await tx.wait();

            const penaltyShare = 100;
            await expect(booster.setRewardClaimedPenalty(penaltyShare)).to.be.revertedWith("!auth");
            await expect(booster.connect(daoSigner).setRewardClaimedPenalty(3001)).to.be.revertedWith(">max");
            tx = await booster.connect(daoSigner).setRewardClaimedPenalty(penaltyShare);
            await tx.wait();

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            const extraDistrBalanceBefore = await cvx.balanceOf(contracts.extraRewardsDistributor.address);
            const lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            tx = await crvRewards["getReward(address,bool)"](bobAddress, false);
            const boosterReward = await getBoosterReward(tx);

            expect(boosterReward.amount).gt(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);
            expect(boosterReward.mintAmount).eq(boosterReward.amount.mul(10000 - penaltyShare).div(10000));
            expect(boosterReward.penalty).eq(boosterReward.amount.mul(penaltyShare).div(10000));

            expect(await contracts.cvxLocker.balances(bobAddress).then(b => b.locked)).eq(lockerBalanceBefore);
            expect(await cvx.balanceOf(bobAddress)).gt(cvxBalanceBefore);
            expect(await cvx.balanceOf(contracts.extraRewardsDistributor.address)).gt(extraDistrBalanceBefore);

            const crvBalance = await mocks.crv.balanceOf(bobAddress);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = await crvRewards.rewardPerToken(mocks.crv.address);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });
    });

    describe("managing system revenue fees", async () => {
        before(async () => {
            const amount = ethers.utils.parseEther("10");
            let tx = await mocks.lptoken.connect(alice).approve(booster.address, amount);
            await tx.wait();

            tx = await booster.connect(alice).deposit(0, amount, true);
            await tx.wait();

            await increaseTime(60 * 60 * 24 * 6);
        });
        it("has the correct initial config", async () => {
            const callerFee = await booster.earmarkIncentive();
            expect(callerFee).eq(50);

            const feeManager = await booster.feeManager();
            expect(feeManager).eq(await daoSigner.getAddress());
        });
        it("doesn't allow just anyone to change fees", async () => {
            await expect(booster.connect(accounts[5]).setEarmarkIncentive(1)).to.be.revertedWith("!auth");
            await expect(booster.connect(accounts[5]).updateDistributionByTokens(pool.lptoken, [], [], [])).to.be.revertedWith("!auth");
        });
        it("allows feeManager to set the fees", async () => {
            let tx = await booster.connect(daoSigner).setEarmarkIncentive(25);
            await expect(tx).to.emit(booster, "SetEarmarkIncentive").withArgs(25);

            tx = await booster.connect(daoSigner).updateDistributionByTokens(pool.lptoken, [], [], []);
            await expect(tx).to.emit(booster, "DistributionUpdate").withArgs(pool.lptoken, 0, 0, 0, 0);
        });
        it("enforces 1% upper bound", async () => {
            console.log('setEarmarkIncentive');
            await expect(booster.connect(daoSigner).setEarmarkIncentive(101)).to.be.revertedWith(">max");
            console.log('updateDistributionByTokens');
            await expect(booster.connect(daoSigner).updateDistributionByTokens(
                pool.lptoken,
                [cvxCrvRewards.address, cvxLocker.address],
                [2000, 525],
                [true, true]
            )).to.be.revertedWith(">max");

            let tx = await booster.connect(daoSigner).updateDistributionByTokens(
                pool.lptoken,
                [cvxCrvRewards.address, cvxLocker.address],
                [2000, 500],
                [true, true]
            );
            await expect(tx).to.emit(booster, "DistributionUpdate").withArgs(pool.lptoken, 2, 2, 2, 2500);

            tx = await booster.connect(daoSigner).setEarmarkIncentive(100);
            await expect(tx).to.emit(booster, "SetEarmarkIncentive").withArgs(100);
        });
        it("distributes the fees to the correct places", async () => {
            await increaseTime(60 * 60 * 24);

            await booster.connect(daoSigner).updateDistributionByTokens(
                mocks.crv.address,
                [cvxCrvRewards.address, cvxStakingProxy.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );
            await booster.connect(daoSigner).updateDistributionByTokens(
                mocks.weth.address,
                [cvxCrvRewards.address, cvxLocker.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );
            await booster.connect(daoSigner).setEarmarkIncentive(50);

            const tokens = [mocks.crv, mocks.weth];
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const lockerAddress = token.address === mocks.weth.address ? cvxLocker.address : veWom.address
                // bals before
                const balsBefore = await Promise.all([
                    await token.balanceOf((await booster.poolInfo(0)).crvRewards), // reward pool
                    await token.balanceOf(cvxCrvRewards.address), // cvxCrv
                    await token.balanceOf(lockerAddress), // veWom
                    await token.balanceOf(aliceAddress), // alice
                    await token.balanceOf(treasuryAddress), // platform
                ]);

                // collect the rewards
                const tx = await (await booster.connect(alice).earmarkRewards(0)).wait(1);

                const {amount} = tx.events.filter(e => e.event === 'EarmarkRewards' && e.args.token.toLowerCase() === token.address.toLowerCase())[0].args;

                // bals after
                const balsAfter = await Promise.all([
                    await token.balanceOf((await booster.poolInfo(0)).crvRewards), // reward pool
                    await token.balanceOf(cvxCrvRewards.address), // cvxCrv
                    await token.balanceOf(lockerAddress), // veWom
                    await token.balanceOf(aliceAddress), // alice
                    await token.balanceOf(treasuryAddress), // platform
                ]);
                let amountChecked = '0';
                [100, 50, 400, 2000].forEach((share, index) => {
                    let shareAmount = amount.mul(share).div(10000);
                    amountChecked = shareAmount.add(amountChecked);
                    expect(balsAfter[4 - index].sub(balsBefore[4 - index])).eq(shareAmount);
                })
                expect(balsAfter[0]).eq(balsBefore[0].add(amount.sub(amountChecked)));
            }
        });
    });

    describe("performing voting functions", async () => {
        it("vote by voteDelegate", async () => {
            const mockVoting = await deployContract<MockVoting>(
                hre,
                new MockVoting__factory(deployer),
                "mockVoting",
                [],
                {},
                false,
            );

            expect(await mockVoting.votesFor('1'), 'votesFor zero').eq(0);

            const voteData = mockVoting.interface.encodeFunctionData("vote",  ['1', true, true]);

            await expect(booster.voteExecute(mockVoting.address, 0, voteData)).to.be.revertedWith("!auth");
            await expect(booster.connect(voteDelegate).voteExecute(mockVoting.address, 0, voteData)).to.be.revertedWith("!auth");

            await expect(booster.setVoteDelegate(voteDelegateAddress)).to.be.revertedWith("!auth");
            await expect(booster.connect(voteDelegate).setVoteDelegate(voteDelegateAddress)).to.be.revertedWith("!auth");

            await booster.connect(daoSigner).setVoteDelegate(voteDelegateAddress).then(tx => tx.wait(1));
            expect(await booster.voteDelegate(), 'voting delegate').eq(voteDelegateAddress);

            await expect(booster.connect(voteDelegate).voteExecute(mockVoting.address, 0, voteData)).to.be.revertedWith("!voting");
            await expect(booster.setVotingValid(mockVoting.address, true)).to.be.revertedWith("!auth");
            await expect(booster.connect(voteDelegate).setVotingValid(mockVoting.address, true)).to.be.revertedWith("!auth");

            expect(await booster.votingMap(mockVoting.address), 'voting not set').eq(false);
            await booster.connect(daoSigner).setVotingValid(mockVoting.address, true).then(tx => tx.wait(1));
            expect(await booster.votingMap(mockVoting.address), 'voting set').eq(true);

            await booster.connect(voteDelegate).voteExecute(mockVoting.address, 0, voteData);

            expect(await mockVoting.votesFor('1'), 'votesFor zero').eq(1);

            expect(await contracts.voterProxy.protectedTokens(mocks.masterWombat.address), 'masterWombat protected').eq(true);
            expect(await contracts.voterProxy.protectedTokens(veWom.address), 'veWom protected').eq(true);

            await booster.connect(daoSigner).setVotingValid(veWom.address, true).then(tx => tx.wait(1));
            await booster.connect(daoSigner).setVotingValid(mocks.masterWombat.address, true).then(tx => tx.wait(1));
            await expect(booster.connect(voteDelegate).voteExecute(veWom.address, 0, voteData)).to.be.revertedWith("protected");
            await expect(booster.connect(voteDelegate).voteExecute(mocks.masterWombat.address, 0, voteData)).to.be.revertedWith("protected");

            await expect(contracts.voterProxy.connect(voteDelegate).execute(mockVoting.address, 0, voteData)).to.be.revertedWith("!auth");
        });
    });
});
