import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    Booster,
    ERC20__factory,
    BaseRewardPool__factory,
    MockVoting,
    MockVoting__factory,
    SafeMoon__factory,
    SafeMoon,
    MultiRewarderPerSec,
    MultiRewarderPerSec__factory,
    MockERC20,
    MockERC20__factory,
    BoosterMigrator,
    BoosterMigrator__factory,
    DepositToken__factory,
    Booster__factory,
    Asset,
    Asset__factory,
    DepositorMigrator,
    DepositorMigrator__factory,
    WomDepositor__factory,
    RewardFactory,
    RewardFactory__factory, TokenFactory, TokenFactory__factory, BoosterEarmark, BoosterEarmark__factory,
} from "../types/generated";
import { Signer, BigNumber} from "ethers";
import {getTimestamp, increaseTime, increaseTimeTo} from "../test-utils/time";
import {simpleToExactAmount} from "../test-utils/math";
import {DEAD_ADDRESS, impersonateAccount, ZERO_ADDRESS} from "../test-utils";
import {deployContract, waitForTx} from "../tasks/utils";
import {BigNumber as BN} from "@ethersproject/bignumber/lib/bignumber";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe("Booster", () => {
    let accounts: Signer[];
    let booster: Booster, boosterEarmark: BoosterEarmark;
    let crv, cvx, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy, underlying;
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
        ({crv} = mocks);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        ({treasuryMultisig: treasuryAddress} = multisigs);
        const distro = getMockDistro();

        contracts = await deploy(hre, deployer, daoSigner, mocks, distro, multisigs, mocks.namingConfig, mocks);

        ({ cvx, booster, booster, boosterEarmark, cvxLocker, cvxStakingProxy, cvxCrvRewards, veWom } = contracts);

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
    };

    async function getBoosterReward(tx, _booster, logsLength) {
        tx = await tx.wait(1);
        const logs = tx.events.filter(e => e.address.toLowerCase() === _booster.address.toLowerCase());
        expect(logs.length).eq(logsLength);
        return booster.interface.decodeEventLog('RewardClaimed', logs[0].data, logs[0].topics);
    }

    function getMasterWombatReward(tx, toAddress, token = null) {
        if (!token) {
            token = crv;
        }
        const logs = tx.events.filter(e => e.address.toLowerCase() === token.address.toLowerCase());
        return logs
            .map(l => {
                try { return crv.interface.decodeEventLog('Transfer', l.data, l.topics); } catch (e) {}
            })
            .filter(e => e && e.to.toLowerCase() === toAddress.toLowerCase())[0];
    }

    function getCrvEarmarkReward(tx, booster) {
        const logs = tx.events.filter(e => e.address.toLowerCase() === booster.address.toLowerCase());
        return logs
            .map(l => {
                try { return booster.interface.decodeEventLog('EarmarkRewards', l.data, l.topics); } catch (e) {}
            })
            .filter(e => e && e.rewardToken.toLowerCase() === crv.address.toLowerCase())[0];
    }

    function equalWithSmallDiff(a, b) {
        a.gt(b) ? expect(a.sub(b)).lte(4) : expect(b.sub(a)).lte(4);
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

            await boosterEarmark.earmarkRewards(0).then(tx => tx.wait());

            await increaseTime(60 * 60 * 24 * 6);

            await boosterEarmark.earmarkRewards(0).then(tx => tx.wait());

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            const queuedRewards = await crvRewards.tokenRewards(crv.address).then(r => r.queuedRewards);
            expect(queuedRewards).gt(0);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            let tx = await crvRewards["getReward(address,bool)"](bobAddress, false);
            const boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);
            expect(await cvx.balanceOf(bobAddress)).gt(cvxBalanceBefore);

            const crvBalance = await crv.balanceOf(bobAddress);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = await crvRewards.rewardPerToken(crv.address);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });

        it("@method BaseRewardPool.processIdleRewards()", async () => {
            await increaseTime(60 * 60 * 24 * 6);
            await boosterEarmark.earmarkRewards(0).then(tx => tx.wait());
            await increaseTime(60 * 60 * 24 * 6);
            await boosterEarmark.earmarkRewards(0).then(tx => tx.wait());
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            const queuedRewards = await crvRewards.tokenRewards(crv.address).then(r => r.queuedRewards);
            expect(queuedRewards).gt(0);

            const periodFinish = await crvRewards.tokenRewards(crv.address).then(r => r.periodFinish);
            await increaseTimeTo(periodFinish);

            await crvRewards.processIdleRewards();
            const queuedRewardsAfter = await crvRewards.tokenRewards(crv.address).then(r => r.queuedRewards);
            expect(queuedRewardsAfter).eq(0);
        });

        it("@method BaseRewardPool.getReward with lock ", async () => {
            expect(await booster.extraRewardsDist()).eq(contracts.extraRewardsDistributor.address);
            expect(await booster.cvxLocker()).eq(contracts.cvxLocker.address);

            await increaseTime(60 * 60 * 24 * 6);

            await boosterEarmark.earmarkRewards(0).then(tx => tx.wait());

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            const extraDistrBalanceBefore = await cvx.balanceOf(contracts.extraRewardsDistributor.address);
            const lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            const crvBalanceBefore = await crv.balanceOf(bobAddress);
            const userRewardPerTokenPaid = await crvRewards.userRewardPerTokenPaid(crv.address, bobAddress);
            let tx = await crvRewards["getReward(address,bool)"](bobAddress, true);
            const boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(true);

            expect(await cvx.balanceOf(bobAddress)).eq(cvxBalanceBefore);
            expect(await cvx.balanceOf(contracts.extraRewardsDistributor.address)).eq(extraDistrBalanceBefore);
            expect(
                await contracts.cvxLocker.balances(bobAddress).then(b => b.locked)
            ).eq(
                lockerBalanceBefore.add(await cvx.getFactAmounMint(boosterReward.amount))
            );

            const receivedCrv = (await crv.balanceOf(bobAddress)).sub(crvBalanceBefore);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = (await crvRewards.rewardPerToken(crv.address)).sub(userRewardPerTokenPaid);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(receivedCrv);
        });

        it("@method BaseRewardPool.getReward with lock and mintRatio", async () => {
            expect(await booster.extraRewardsDist()).eq(contracts.extraRewardsDistributor.address);
            expect(await booster.cvxLocker()).eq(contracts.cvxLocker.address);

            await increaseTime(60 * 60 * 24 * 6);

            await boosterEarmark.earmarkRewards(0).then(tx => tx.wait());

            await expect(booster.setMintRatio(8000)).to.be.revertedWith("!auth");
            await expect(booster.connect(daoSigner).setMintRatio(4999)).to.be.revertedWith("!boundaries");
            await expect(booster.connect(daoSigner).setMintRatio(15001)).to.be.revertedWith("!boundaries");
            const mintRatio = 8000;
            await booster.connect(daoSigner).setMintRatio(mintRatio).then(tx => tx.wait());

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            const extraDistrBalanceBefore = await cvx.balanceOf(contracts.extraRewardsDistributor.address);
            const lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            let tx = await crvRewards["getReward(address,bool)"](bobAddress, true);
            const boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.mintAmount).eq(boosterReward.amount.mul(mintRatio).div(10000));
            expect(boosterReward.lock).eq(true);

            expect(await cvx.balanceOf(bobAddress)).eq(cvxBalanceBefore);
            expect(await cvx.balanceOf(contracts.extraRewardsDistributor.address)).eq(extraDistrBalanceBefore);
            const factMint = await cvx.getFactAmounMint(boosterReward.amount);
            expect(
                await contracts.cvxLocker.balances(bobAddress).then(b => b.locked)
            ).eq(
                lockerBalanceBefore.add(factMint.mul(mintRatio).div(10000))
            );

            const crvBalance = await crv.balanceOf(bobAddress);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = await crvRewards.rewardPerToken(crv.address);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });

        it("@method BaseRewardPool.getReward without lock", async () => {
            expect(await booster.extraRewardsDist()).eq(contracts.extraRewardsDistributor.address);
            expect(await booster.cvxLocker()).eq(contracts.cvxLocker.address);

            await increaseTime(60 * 60 * 24 * 6);

            await boosterEarmark.earmarkRewards(0).then(tx => tx.wait());
            await booster.connect(daoSigner).setMintRatio(0).then(tx => tx.wait());

            const penaltyShare = 100;
            await expect(booster.setRewardClaimedPenalty(penaltyShare)).to.be.revertedWith("!auth");
            await expect(booster.connect(daoSigner).setRewardClaimedPenalty(3001)).to.be.revertedWith(">max");
            await booster.connect(daoSigner).setRewardClaimedPenalty(penaltyShare).then(tx => tx.wait());

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            const extraDistrBalanceBefore = await cvx.balanceOf(contracts.extraRewardsDistributor.address);
            const lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            let tx = await crvRewards["getReward(address,bool)"](bobAddress, false);
            const boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.amount).gt(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);
            expect(boosterReward.mintAmount).eq(boosterReward.amount.mul(10000 - penaltyShare).div(10000));
            expect(boosterReward.penalty).eq(boosterReward.amount.mul(penaltyShare).div(10000));

            expect(await contracts.cvxLocker.balances(bobAddress).then(b => b.locked)).eq(lockerBalanceBefore);

            const factMint = await cvx.getFactAmounMint(boosterReward.amount);
            expect(
                await cvx.balanceOf(bobAddress)
            ).eq(
                cvxBalanceBefore.add(factMint.mul(10000 - penaltyShare).div(10000))
            );
            expect(
                await cvx.balanceOf(contracts.extraRewardsDistributor.address)
            ).eq(
                extraDistrBalanceBefore.add(factMint.mul(penaltyShare).div(10000))
            );

            const crvBalance = await crv.balanceOf(bobAddress);

            const balance = await crvRewards.balanceOf(bobAddress);
            const rewardPerToken = await crvRewards.rewardPerToken(crv.address);
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });
    });

    describe("performing core functions with deflationary token", async () => {
        let lptoken, defPool, multiRewarder, pid;
        before(async () => {
            pid = await booster.poolLength();

            underlying = await deployContract<SafeMoon>(
                hre,
                new SafeMoon__factory(deployer),
                "SafeMoon",
                [],
                {},
                true,
            );

            lptoken = await deployContract<MockERC20>(
                hre,
                new MockERC20__factory(deployer),
                "MockLP",
                ["MockLP", "MockLP", 18, deployerAddress, 10000000],
                {},
                true,
            );

            multiRewarder = await deployContract<MultiRewarderPerSec>(
                hre,
                new MultiRewarderPerSec__factory(deployer),
                "MultiRewarderPerSec",
                [
                    mocks.masterWombat.address,
                    lptoken.address,
                    (await getTimestamp()).add(1),
                    underlying.address,
                    152207
                ],
                {},
                true,
            );
            await underlying.transfer(multiRewarder.address, simpleToExactAmount(10000, 9)).then(tx => tx.wait());
            await mocks.masterWombat.add('1', lptoken.address, multiRewarder.address).then(tx => tx.wait());
            await contracts.voterProxy.connect(daoSigner).setLpTokensPid(mocks.masterWombat.address).then(tx => tx.wait());

            await boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                contracts.crv.address,
                [cvxCrvRewards.address, cvxStakingProxy.address],
                [550, 1100],
                [true, true]
            ).then(tx => tx.wait());

            await boosterEarmark.connect(daoSigner).addPool(lptoken.address, mocks.masterWombat.address).then(tx => tx.wait());
            await boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                underlying.address,
                [cvxCrvRewards.address, cvxLocker.address],
                [550, 1100],
                [true, true]
            ).then(tx => tx.wait());

            await cvxLocker.connect(daoSigner).addReward(underlying.address, booster.address).then(tx => tx.wait());
            await cvxLocker.connect(daoSigner).addReward(crv.address, booster.address).then(tx => tx.wait());

            defPool = await booster.poolInfo(pid);

            const balance = await lptoken.balanceOf(deployerAddress);
            for (const account of [alice, bob]) {
                const accountAddress = await account.getAddress();
                await lptoken.transfer(accountAddress, balance.div(2)).then(tx => tx.wait());
            }
        });

        it("@method Booster.deposit", async () => {
            expect(defPool.lptoken).to.eq(lptoken.address);
            const stake = false;
            const amount = simpleToExactAmount(1000, 9);
            await lptoken.connect(bob).approve(booster.address, amount).then(tx => tx.wait());
            await booster.connect(bob).deposit(pid, amount, stake).then(tx => tx.wait());

            const depositToken = ERC20__factory.connect(defPool.token, deployer);
            const balance = await depositToken.balanceOf(bobAddress);

            expect(balance).to.equal(amount);
        });

        it("@method BaseRewardPool.stake", async () => {
            const depositToken = ERC20__factory.connect(defPool.token, bob);
            const balance = await depositToken.balanceOf(bobAddress);
            const crvRewards = BaseRewardPool__factory.connect(defPool.crvRewards, bob);

            await depositToken.approve(crvRewards.address, balance).then(tx => tx.wait());
            const stakedBalanceBefore = await crvRewards.balanceOf(bobAddress);
            await crvRewards.stake(balance).then(tx => tx.wait());

            const stakedBalanceAfter = await crvRewards.balanceOf(bobAddress);

            expect(stakedBalanceAfter.sub(stakedBalanceBefore)).to.equal(balance);
        });

        it("@method BaseRewardPool.getReward with custom mint ratio", async () => {
            await booster.connect(daoSigner).setCustomMintRatioMultiple([0, 1], [0, 0]).then(tx => tx.wait());

            await booster.connect(daoSigner).setRewardClaimedPenalty(0).then(tx => tx.wait());

            await increaseTime(60 * 60 * 24 * 6);

            await boosterEarmark.earmarkRewards(pid).then(tx => tx.wait());

            await increaseTime(60 * 60 * 24 * 6);

            await boosterEarmark.earmarkRewards(pid).then(tx => tx.wait());

            const crvRewards1 = BaseRewardPool__factory.connect(defPool.crvRewards, bob);
            const queuedRewards = await crvRewards1.tokenRewards(crv.address).then(r => r.queuedRewards);
            expect(queuedRewards).gt(0);

            await increaseTime(60 * 60 * 24 * 6);

            let cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            let crvBalanceBefore = await crv.balanceOf(bobAddress);
            let underlyingBalanceBefore = await underlying.balanceOf(bobAddress);
            const userRewardPerTokenPaid = await crvRewards1.userRewardPerTokenPaid(crv.address, bobAddress);

            let tx = await crvRewards1["getReward(address,bool)"](bobAddress, false);
            let boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);
            expect(await cvx.balanceOf(bobAddress)).gt(cvxBalanceBefore);
            expect(await underlying.balanceOf(bobAddress)).gt(underlyingBalanceBefore);

            const receivedCrv = (await crv.balanceOf(bobAddress)).sub(crvBalanceBefore);

            let balance = await crvRewards1.balanceOf(bobAddress);
            let rewardPerToken = (await crvRewards1.rewardPerToken(crv.address)).sub(userRewardPerTokenPaid);
            let expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(receivedCrv);

            await increaseTime(60 * 60 * 24 * 6);

            await boosterEarmark.earmarkRewards(pid).then(tx => tx.wait());
            await underlying.connect(daoSigner).pause(true).then(tx => tx.wait());

            await expect(crvRewards1["getReward(address,bool)"](bobAddress, false)).to.be.revertedWith("pause");
            await expect(booster.setRewardTokenPausedInPools([crvRewards1.address], underlying.address, true)).to.be.revertedWith("!auth");

            await booster.connect(daoSigner).setRewardTokenPausedInPools([crvRewards1.address], underlying.address, true).then(tx => tx.wait());

            cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            underlyingBalanceBefore = await underlying.balanceOf(bobAddress);

            tx = await crvRewards1["getReward(address,bool)"](bobAddress, false);
            boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);
            expect(await cvx.balanceOf(bobAddress)).gt(cvxBalanceBefore);
            expect(await underlying.balanceOf(bobAddress)).eq(underlyingBalanceBefore);

             await underlying.connect(daoSigner).pause(false).then(tx => tx.wait());
             await booster.connect(daoSigner).setRewardTokenPausedInPools([crvRewards1.address], underlying.address, false).then(tx => tx.wait());
             await crvRewards1["getReward(address,bool)"](bobAddress, false).then(tx => tx.wait());

            expect(await underlying.balanceOf(bobAddress)).gt(underlyingBalanceBefore);

            await increaseTime(60 * 60);

            const mintRatio = 8000;
            const customMintRatio = 9000;
            await booster.connect(daoSigner).setMintRatio(mintRatio).then(tx => tx.wait());
            await booster.connect(daoSigner).setCustomMintRatioMultiple([0], [customMintRatio]).then(tx => tx.wait());

            cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            let lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            tx = await crvRewards1["getReward(address,bool)"](bobAddress, true);
            boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.mintAmount).eq(boosterReward.amount.mul(mintRatio).div(10000));
            expect(boosterReward.lock).eq(true);

            expect(await cvx.balanceOf(bobAddress)).eq(cvxBalanceBefore);
            let factMint = await cvx.getFactAmounMint(boosterReward.amount);
            equalWithSmallDiff(
                await contracts.cvxLocker.balances(bobAddress).then(b => b.locked),
                lockerBalanceBefore.add(factMint.mul(mintRatio).div(10000))
            );

            const pool = await booster.poolInfo(0);
            const crvRewards0 = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            lockerBalanceBefore = await contracts.cvxLocker.balances(bobAddress).then(b => b.locked);
            tx = await crvRewards0["getReward(address,bool)"](bobAddress, true);
            boosterReward = await getBoosterReward(tx, booster, 1);

            expect(boosterReward.mintAmount).eq(boosterReward.amount.mul(customMintRatio).div(10000));
            expect(boosterReward.lock).eq(true);

            expect(await cvx.balanceOf(bobAddress)).eq(cvxBalanceBefore);
            factMint = await cvx.getFactAmounMint(boosterReward.amount);
            expect(
                await contracts.cvxLocker.balances(bobAddress).then(b => b.locked)
            ).eq(
                lockerBalanceBefore.add(factMint.mul(customMintRatio).div(10000))
            );
        });
    });

    describe("managing system revenue fees", async () => {
        before(async () => {
            const amount = ethers.utils.parseEther("10");
            await mocks.lptoken.connect(alice).approve(booster.address, amount).then(tx => tx.wait());
            await booster.connect(alice).deposit(0, amount, true).then(tx => tx.wait());

            await increaseTime(60 * 60 * 24 * 6);
        });
        it("has the correct initial config", async () => {
            expect(await boosterEarmark.earmarkIncentive()).eq(10);

            await boosterEarmark.connect(daoSigner).setEarmarkConfig(50);
            expect(await boosterEarmark.earmarkIncentive()).eq(50);

            const feeManager = await booster.feeManager();
            expect(feeManager).eq(await daoSigner.getAddress());
        });
        it("doesn't allow just anyone to change fees", async () => {
            await expect(boosterEarmark.connect(accounts[5]).setEarmarkConfig(1)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(boosterEarmark.connect(accounts[5]).updateDistributionByTokens(pool.lptoken, [], [], [])).to.be.revertedWith("Ownable: caller is not the owner");
        });
        it("allows feeManager to set the fees", async () => {
            let tx = await boosterEarmark.connect(daoSigner).setEarmarkConfig(25);
            await expect(tx).to.emit(boosterEarmark, "SetEarmarkConfig").withArgs(25);

            await expect(boosterEarmark.connect(daoSigner).updateDistributionByTokens(pool.lptoken, [], [], [])).to.be.revertedWith("zero");
            tx = await boosterEarmark.connect(daoSigner).updateDistributionByTokens(pool.lptoken, [pool.lptoken], [1], [true]);
            await expect(tx).to.emit(boosterEarmark, "DistributionUpdate").withArgs(pool.lptoken, 1, 1, 1, 1);
        });
        it("enforces 1% upper bound", async () => {
            await expect(boosterEarmark.connect(daoSigner).setEarmarkConfig(101)).to.be.revertedWith(">max");
            await expect(boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                pool.lptoken,
                [cvxCrvRewards.address, cvxLocker.address],
                [2000, 525],
                [true, true]
            )).to.be.revertedWith(">max");

            let tx = await boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                pool.lptoken,
                [cvxCrvRewards.address, cvxLocker.address],
                [2000, 500],
                [true, true]
            );
            await expect(tx).to.emit(boosterEarmark, "DistributionUpdate").withArgs(pool.lptoken, 2, 2, 2, 2500);

            tx = await boosterEarmark.connect(daoSigner).setEarmarkConfig(100);
            await expect(tx).to.emit(boosterEarmark, "SetEarmarkConfig").withArgs(100);
        });
        it("distributes the fees to the correct places", async () => {
            const mwPool = await mocks.masterWombat.poolInfo('0');
            await deployer.sendTransaction({ to: mwPool.rewarder, value: BN.from(10).pow(20) });

            await increaseTime(60 * 60 * 24);

            await boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                crv.address,
                [DEAD_ADDRESS],
                [0],
                [false]
            );
            const p = await booster.poolInfo(0);
            let tx = await (await boosterEarmark.connect(alice).earmarkRewards(0)).wait();

            const {amount} = tx.events.filter(e => e.event === 'EarmarkRewards' && e.args.rewardToken.toLowerCase() === crv.address.toLowerCase())[0].args;
            const {value} = getMasterWombatReward(tx, p.crvRewards);
            expect(amount.sub(amount.mul(await boosterEarmark.earmarkIncentive()).div(10000))).eq(value);

            await increaseTime(60 * 60 * 24);

            await boosterEarmark.connect(daoSigner).clearDistroApprovals(cvxCrvRewards.address).then(tx => tx.wait(1));
            await expect(boosterEarmark.connect(alice).earmarkRewards(0)).to.be.revertedWith("SafeERC20: low-level call failed");

            // expect(await booster.customDistributionByTokenLength(1, crv.address)).eq(0);
            // await booster.connect(daoSigner).updateCustomDistributionByTokens(
            //     1,
            //     crv.address,
            //     [cvxCrvRewards.address, cvxStakingProxy.address, treasuryAddress],
            //     [1000, 1400, 100],
            //     [true, true, false]
            // );
            // expect(await booster.customDistributionByTokenLength(1, crv.address)).eq(3);

            await boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                crv.address,
                [cvxCrvRewards.address, cvxStakingProxy.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );
            await boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                mocks.weth.address,
                [cvxCrvRewards.address, cvxLocker.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );
            await boosterEarmark.connect(daoSigner).updateDistributionByTokens(
                underlying.address,
                [cvxCrvRewards.address, cvxLocker.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );
            await boosterEarmark.connect(daoSigner).setEarmarkConfig(50);

            async function distroBalances(pid, token) {
                const lockerAddress = token.address === mocks.crv.address ? veWom.address : cvxLocker.address
                return Promise.all([
                    await token.balanceOf((await booster.poolInfo(pid)).crvRewards), // reward pool
                    await token.balanceOf(cvxCrvRewards.address), // cvxCrv
                    await token.balanceOf(lockerAddress), // veWom
                    await token.balanceOf(aliceAddress), // alice
                    await token.balanceOf(treasuryAddress), // platform
                ]);
            }

            for (let pid = 0; pid < 2; pid++) {
                await increaseTime(60 * 60 * 24);

                const pool = await booster.poolInfo(pid);
                const tokenAddresses = await contracts.voterProxy.getGaugeRewardTokens(pool.lptoken, mocks.masterWombat.address);
                const tokens = [];

                const balsBeforeArr = [];
                for (let i = 0; i < tokenAddresses.length; i++) {
                    const token = await ERC20__factory.connect(tokenAddresses[i], deployer);
                    tokens.push(token);
                    // bals before
                    balsBeforeArr.push(await distroBalances(pid, token));
                }

                // collect the rewards
                tx = await (await boosterEarmark.connect(alice).earmarkRewards(pid)).wait();

                for (let i = 0; i < tokens.length; i++) {
                    const token = tokens[i];
                    const {amount} = tx.events.filter(e => e.event === 'EarmarkRewards' && e.args.rewardToken.toLowerCase() === token.address.toLowerCase())[0].args;

                    const balsBefore = balsBeforeArr[i];
                    // bals after
                    const balsAfter = await distroBalances(pid, token);
                    let amountChecked = '0';
                    // if (pid === 1 && token.address === mocks.crv.address) {
                    //     [100, 50, 1400, 1000].forEach((share, index) => {
                    //         let shareAmount = amount.mul(share).div(10000);
                    //         amountChecked = shareAmount.add(amountChecked);
                    //         expect(balsAfter[4 - index].sub(balsBefore[4 - index])).eq(shareAmount);
                    //     });
                    // } else {
                        [100, 50, 400, 2000].forEach((share, index) => {
                            let shareAmount = amount.mul(share).div(10000);
                            if (token.address === underlying.address) {
                                shareAmount = shareAmount.mul(90).div(100);
                            }
                            amountChecked = shareAmount.add(amountChecked);
                            equalWithSmallDiff(balsAfter[4 - index].sub(balsBefore[4 - index]), shareAmount);
                        });
                    // }
                    if (token.address === underlying.address) {
                        equalWithSmallDiff(balsAfter[0], balsBefore[0].add(amount.mul(90).div(100).sub(amountChecked)));
                    } else {
                        equalWithSmallDiff(balsAfter[0], balsBefore[0].add(amount.sub(amountChecked)));
                    }
                }
            }

            // await booster.connect(daoSigner).updateCustomDistributionByTokens(1, crv.address, [], [], []);
            // expect(await booster.customDistributionByTokenLength(1, crv.address)).eq(0);
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

    describe("withdraw", async () => {
        it("withdraw wrapped and lp tokens", async () => {
            const amount = ethers.utils.parseEther("500");

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            const lpToken = ERC20__factory.connect(pool.lptoken, deployer);
            const depositToken = ERC20__factory.connect(pool.token, deployer);

            let rsBalanceBefore = await crvRewards.balanceOf(bobAddress);
            let lpBalanceBefore = await lpToken.balanceOf(bobAddress);
            let dtRewardsBalanceBefore = await depositToken.balanceOf(crvRewards.address);

            await crvRewards.connect(bob).withdrawAndUnwrap(amount, true).then(tx => tx.wait())

            expect(await depositToken.balanceOf(crvRewards.address)).to.equal(dtRewardsBalanceBefore.sub(amount));
            expect(await crvRewards.balanceOf(bobAddress)).to.equal(rsBalanceBefore.sub(amount));
            expect(await lpToken.balanceOf(bobAddress)).to.equal(lpBalanceBefore.add(amount));

            let dtBalanceBefore = await depositToken.balanceOf(bobAddress);
            lpBalanceBefore = await lpToken.balanceOf(bobAddress);
            rsBalanceBefore = await crvRewards.balanceOf(bobAddress);
            dtRewardsBalanceBefore = await depositToken.balanceOf(crvRewards.address);

            await crvRewards.connect(bob).withdraw(amount, true).then(tx => tx.wait())

            expect(await depositToken.balanceOf(crvRewards.address)).to.equal(dtRewardsBalanceBefore.sub(amount));
            expect(await crvRewards.balanceOf(bobAddress)).to.equal(rsBalanceBefore.sub(amount));
            expect(await depositToken.balanceOf(bobAddress)).to.equal(dtBalanceBefore.add(amount));
            expect(await lpToken.balanceOf(bobAddress)).to.equal(lpBalanceBefore);

            dtBalanceBefore = await depositToken.balanceOf(bobAddress);

            await booster.connect(bob).withdraw(0, amount).then(tx => tx.wait())

            expect(await depositToken.balanceOf(bobAddress)).to.equal(dtBalanceBefore.sub(amount));
            expect(await lpToken.balanceOf(bobAddress)).to.equal(lpBalanceBefore.add(amount));
        });
    });

    describe("@method shutdownPool", () => {
        it("reverts if not called by operator", async () => {
            await expect(boosterEarmark.connect(accounts[2]).shutdownPool(0)).to.revertedWith("Ownable: caller is not the owner");
        });

        it("shutdown and add created pool again", async () => {
            let pool = await booster.poolInfo(0);

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            let balanceBefore = await crvRewards.balanceOf(bobAddress);

            const amount = ethers.utils.parseEther("1000");
            await mocks.lptoken.connect(bob).approve(booster.address, amount.mul(3)).then(tx => tx.wait());
            await booster.connect(bob).deposit(0, amount, true).then(tx => tx.wait());
            expect(await crvRewards.balanceOf(bobAddress)).to.equal(balanceBefore.add(amount));

            await boosterEarmark.connect(daoSigner).shutdownPool(0).then(tx => tx.wait());

            await contracts.crvDepositor.connect(daoSigner).setBooster(booster.address, 1);

            pool = await booster.poolInfo(0);

            expect(pool.shutdown).to.equal(true);

            // const excessAmount = ethers.utils.parseEther("100");

            // let tx = await booster.connect(daoSigner).releaseToken(pool.lptoken, treasuryAddress).then(tx => tx.wait());
            // let ReleaseTokenEvent = tx.events.filter(e => e.event === 'ReleaseToken')[0];
            // expect(ReleaseTokenEvent.args.amount).eq(0);

            const token = ERC20__factory.connect(pool.token, deployer);
            expect(await mocks.lptoken.balanceOf(booster.address)).to.equal(await token.totalSupply());

            // await mocks.lptoken.transfer(booster.address, excessAmount).then(tx => tx.wait());

            expect(await mocks.lptoken.balanceOf(booster.address)).to.equal(await token.totalSupply());

            // tx = await booster.connect(daoSigner).releaseToken(pool.lptoken, treasuryAddress).then(tx => tx.wait());
            // ReleaseTokenEvent = tx.events.filter(e => e.event === 'ReleaseToken')[0];
            // expect(ReleaseTokenEvent.args.amount).eq(excessAmount);

            expect(await mocks.lptoken.balanceOf(booster.address)).to.equal(await token.totalSupply());

            balanceBefore = await crvRewards.balanceOf(bobAddress);
            await crvRewards.connect(bob).withdrawAndUnwrap(amount.div(2), true).then(tx => tx.wait());
            expect(await crvRewards.balanceOf(bobAddress)).to.equal(balanceBefore.sub(amount.div(2)));

            const poolLength = await booster.poolLength();

            await boosterEarmark.connect(daoSigner).addCreatedPool(pool.lptoken, pool.gauge, pool.token, pool.crvRewards).then(tx => tx.wait());

            expect(poolLength.add(1)).to.equal(await booster.poolLength());

            const newPool = await booster.poolInfo(poolLength);
            expect(pool.lptoken).to.equal(newPool.lptoken);
            expect(pool.gauge).to.equal(newPool.gauge);
            expect(pool.token).to.equal(newPool.token);
            expect(pool.crvRewards).to.equal(newPool.crvRewards);
            expect(pool.crvRewards).to.equal(crvRewards.address);

            expect(await crvRewards.pid()).to.equal(poolLength);

            balanceBefore = await crvRewards.balanceOf(bobAddress);

            await expect(booster.connect(bob).deposit(0, amount, true)).to.revertedWith("closed");

            let tx = await booster.connect(bob).deposit(poolLength, amount, true).then(tx => tx.wait());
            let logs = tx.events.filter(e => e.address.toLowerCase() === boosterEarmark.address.toLowerCase());
            expect(logs.length).eq(0);

            await booster.connect(daoSigner).setEarmarkOnDeposit(true).then(tx => tx.wait());

            await increaseTime(60 * 60 * 24);

            tx = await booster.connect(bob).deposit(poolLength, amount, true).then(tx => tx.wait());
            logs = tx.events.filter(e => e.address.toLowerCase() === boosterEarmark.address.toLowerCase());
            let earmarkRewards = boosterEarmark.interface.decodeEventLog('EarmarkRewards', logs[0].data, logs[0].topics);
            expect(earmarkRewards.amount).gt(0);

            await increaseTime(60 * 60 * 24);

            tx = await crvRewards.withdrawAndUnwrap(amount, true).then(tx => tx.wait());
            logs = tx.events.filter(e => e.address.toLowerCase() === boosterEarmark.address.toLowerCase());
            earmarkRewards = boosterEarmark.interface.decodeEventLog('EarmarkRewards', logs[0].data, logs[0].topics);
            expect(earmarkRewards['amount']).gt(0);

            await boosterEarmark.connect(daoSigner).setEarmarkConfig(await boosterEarmark.earmarkIncentive()).then(tx => tx.wait());

            expect(await crvRewards.balanceOf(bobAddress)).to.equal(balanceBefore.add(amount));

            await boosterEarmark.connect(daoSigner).shutdownPool(poolLength).then(tx => tx.wait());
        });

        it("force shutdown", async () => {
            const lptoken = await deployContract<MockERC20>(
                hre,
                new MockERC20__factory(deployer),
                "MockLP",
                ["MockLP", "MockLP", 18, deployerAddress, 10000000],
                {},
                true,
            );
            const balance = await lptoken.balanceOf(deployerAddress);
            for (const account of [alice, bob]) {
                const accountAddress = await account.getAddress();
                await lptoken.transfer(accountAddress, balance.div(2)).then(tx => tx.wait());
            }

            const poolLen = await booster.poolLength();
            await expect(boosterEarmark.addPool(lptoken.address, mocks.masterWombat.address)).to.revertedWith("Ownable: caller is not the owner");
            await expect(boosterEarmark.connect(daoSigner).addPool(lptoken.address, ZERO_ADDRESS)).to.revertedWith("!param");
            await boosterEarmark.connect(daoSigner).addPool(lptoken.address, mocks.masterWombat.address).then(tx => tx.wait());

            await mocks.masterWombat.add('1', lptoken.address, ZERO_ADDRESS).then(tx => tx.wait());
            await contracts.voterProxy.connect(daoSigner).setLpTokensPid(mocks.masterWombat.address).then(tx => tx.wait());

            const resPoolLen = await booster.poolLength();
            expect(resPoolLen).to.eq(poolLen.add(1));

            const amount = ethers.utils.parseEther("1000");

            await booster.connect(daoSigner).updateLpPendingRewardTokensByGauge(poolLen).then(tx => tx.wait(1));
            await lptoken.connect(bob).approve(booster.address, amount).then(tx => tx.wait(1));
            await booster.connect(bob).deposit(poolLen, amount, true).then(tx => tx.wait(1));

            await mocks.masterWombat.setPause(true);

            await expect(boosterEarmark.connect(daoSigner).shutdownPool(resPoolLen.sub(1))).to.revertedWith("paused");

            await boosterEarmark.connect(daoSigner).forceShutdownPool(resPoolLen.sub(1)).then(tx => tx.wait());
            const pool = await booster.poolInfo(resPoolLen.sub(1));
            expect(pool.shutdown).to.equal(true);

            await mocks.masterWombat.setPause(false);

            await boosterEarmark.connect(daoSigner).addCreatedPool(pool.lptoken, pool.gauge, pool.token, pool.crvRewards).then(tx => tx.wait());

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);

            const balanceBefore = await crvRewards.balanceOf(bobAddress);
            await crvRewards.connect(bob).withdrawAndUnwrap(amount.div(2), true).then(tx => tx.wait());
            expect(await crvRewards.balanceOf(bobAddress)).to.equal(balanceBefore.sub(amount.div(2)));
        });
    });

    describe("migration to new booster", () => {
        let newBoosterContract;
        it("should migrate active pools successfully", async () => {
            const lptoken = await deployContract<MockERC20>(
                hre,
                new MockERC20__factory(deployer),
                "MockLP",
                ["MockLP", "MockLP", 18, deployerAddress, 10000000],
                {},
                true,
            );
            const balance = await lptoken.balanceOf(deployerAddress);
            for (const account of [alice, bob]) {
                const accountAddress = await account.getAddress();
                await lptoken.transfer(accountAddress, balance.div(2)).then(tx => tx.wait());
            }

            const poolLen = await booster.poolLength();
            await boosterEarmark.connect(daoSigner).addPool(lptoken.address, mocks.masterWombat.address).then(tx => tx.wait());
            await mocks.masterWombat.add('1', lptoken.address, ZERO_ADDRESS).then(tx => tx.wait());
            await contracts.voterProxy.connect(daoSigner).setLpTokensPid(mocks.masterWombat.address).then(tx => tx.wait());

            const resPoolLen = await booster.poolLength();
            expect(resPoolLen).to.eq(poolLen.add(1));

            const pool = await booster.poolInfo(poolLen);

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            const depositToken = DepositToken__factory.connect(pool.token, bob);

            const amount = ethers.utils.parseEther("1000");

            await lptoken.connect(bob).approve(booster.address, amount).then(tx => tx.wait());
            await booster.connect(bob).deposit(poolLen, amount, true).then(tx => tx.wait());

            newBoosterContract = await deployContract<Booster>(
                hre,
                new Booster__factory(deployer),
                "Booster",
                [contracts.voterProxy.address, contracts.cvx.address, mocks.crv.address, mocks.weth.address, 2000, 15000],
                {},
                true,
            );

            const oldBoosterEarmark = boosterEarmark;

            boosterEarmark = await deployContract<BoosterEarmark>(
                hre,
                new BoosterEarmark__factory(deployer),
                "BoosterEarmark",
                [newBoosterContract.address, mocks.weth.address],
                {},
                true,
            );

            await newBoosterContract.setEarmarkDelegate(boosterEarmark.address);
            await newBoosterContract.setPoolManager(boosterEarmark.address).then(tx => tx.wait());
            await boosterEarmark.transferOwnership(await daoSigner.getAddress());

            const rewardFactory = await deployContract<RewardFactory>(
                hre,
                new RewardFactory__factory(deployer),
                "RewardFactory",
                [newBoosterContract.address, mocks.crv.address],
                {},
                true,
            );

            const tokenFactory = await deployContract<TokenFactory>(
                hre,
                new TokenFactory__factory(deployer),
                "TokenFactory",
                [newBoosterContract.address, mocks.namingConfig.tokenFactoryNamePostfix, mocks.namingConfig.cvxSymbol.toLowerCase()],
                {},
                true,
            );

            const boosterMigrator = await deployContract<BoosterMigrator>(
                hre,
                new BoosterMigrator__factory(deployer),
                "BoosterMigrator",
                [booster.address, oldBoosterEarmark.address, newBoosterContract.address, rewardFactory.address, tokenFactory.address, mocks.weth.address],
                {},
                true,
            );

            await newBoosterContract.setOwner(boosterMigrator.address).then(tx => tx.wait(1));
            await boosterEarmark.connect(daoSigner).transferOwnership(boosterMigrator.address);

            expect(await boosterMigrator.oldBooster()).to.equal(booster.address);
            expect(await boosterMigrator.boosterOwner()).to.equal(await daoSigner.getAddress());

            await booster.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));
            await contracts.voterProxy.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));

            expect(await booster.owner()).to.equal(boosterMigrator.address);
            expect(await contracts.voterProxy.owner()).to.equal(boosterMigrator.address);

            let migrateTx = await boosterMigrator.migrate().then(tx => tx.wait(1));
            console.log('migrateTx.cumulativeGasUsed', migrateTx.cumulativeGasUsed);

            await expect(booster.connect(daoSigner).migrateRewards([pool.crvRewards], [], ZERO_ADDRESS)).to.revertedWith("!length");
            await expect(oldBoosterEarmark.connect(daoSigner).addPool(lptoken.address, mocks.masterWombat.address)).to.revertedWith("!add");

            expect(await booster.isShutdown()).to.equal(true);
            expect(await booster.owner()).to.equal(await daoSigner.getAddress());
            expect(await contracts.voterProxy.owner()).to.equal(await daoSigner.getAddress());

            const {newBooster, poolLength} = migrateTx.events.filter(e => e.event === 'Migrated')[0].args;

            await cvxLocker.connect(daoSigner).approveRewardDistributor(crv.address, newBooster, true);
            await cvxLocker.connect(daoSigner).approveRewardDistributor(underlying.address, newBooster, true);
            await cvxLocker.connect(daoSigner).approveRewardDistributor(mocks.weth.address, newBooster, true);

            expect(await newBoosterContract.owner()).to.equal(await daoSigner.getAddress());
            expect(await newBoosterContract.poolLength()).to.equal(poolLength);
            expect(await newBoosterContract.poolLength()).to.lt(await booster.poolLength());
            expect(await newBoosterContract.minMintRatio()).to.equal(2000);
            expect(await newBoosterContract.maxMintRatio()).to.equal(15000);
            expect(await crvRewards.operator()).eq(newBooster);
            expect(await depositToken.operator()).eq(newBooster);

            await newBoosterContract.connect(daoSigner).setOwner(boosterMigrator.address).then(tx => tx.wait(1));
            expect(await newBoosterContract.owner()).to.equal(boosterMigrator.address);
            await expect(boosterMigrator.callContract(newBoosterContract.address, newBoosterContract.interface.encodeFunctionData('setOwner', [await daoSigner.getAddress()])).then(tx => tx.wait(1))).to.be.revertedWith("!auth");
            await boosterMigrator.connect(daoSigner).callContract(newBoosterContract.address, newBoosterContract.interface.encodeFunctionData('setOwner', [await daoSigner.getAddress()])).then(tx => tx.wait(1));
            expect(await newBoosterContract.owner()).to.equal(await daoSigner.getAddress());

            const lastPid = poolLength.sub(1);

            const migratedPool = await newBoosterContract.poolInfo(lastPid)
            expect(crvRewards.address).eq(migratedPool.crvRewards);
            expect(lptoken.address).eq(migratedPool.lptoken);

            let balanceBefore = await crvRewards.balanceOf(bobAddress);

            // await expect(booster.connect(bob).deposit(0, amount, true)).to.revertedWith("pool is closed");
            await newBoosterContract.connect(daoSigner).updateLpPendingRewardTokensByGauge(lastPid).then(tx => tx.wait(1));

            await lptoken.connect(bob).approve(newBoosterContract.address, amount).then(tx => tx.wait());
            await newBoosterContract.connect(bob).deposit(lastPid, amount, true).then(tx => tx.wait());

            expect(await crvRewards.balanceOf(bobAddress)).to.equal(balanceBefore.add(amount));

            balanceBefore = await crvRewards.balanceOf(bobAddress);
            await crvRewards.connect(bob).withdrawAndUnwrap(amount.div(2), true).then(tx => tx.wait());
            expect(await crvRewards.balanceOf(bobAddress)).to.equal(balanceBefore.sub(amount.div(2)));

            expect(await contracts.cvx.operator()).eq(newBooster);

            await increaseTime(60 * 60 * 24 * 6);

            const oldDistroTokens = await oldBoosterEarmark.distributionTokenList();
            const newDistroTokens = await boosterEarmark.distributionTokenList();

            expect(oldDistroTokens.length).eq(newDistroTokens.length);
            for (let i = 0; i < oldDistroTokens.length; i++) {
                expect(oldDistroTokens[i]).eq(newDistroTokens[i]);
                let tokenDistroLength = await oldBoosterEarmark.distributionByTokenLength(newDistroTokens[i]);

                expect(tokenDistroLength).eq(await boosterEarmark.distributionByTokenLength(newDistroTokens[i]));

                for (let j = 0; j < parseInt(tokenDistroLength.toString()); j++) {
                    const oldD = await oldBoosterEarmark.distributionByTokens(newDistroTokens[i], j);
                    const d = await boosterEarmark.distributionByTokens(newDistroTokens[i], j);
                    expect(oldD.share).gt(0);
                    expect(oldD.distro).eq(d.distro);
                    expect(oldD.share).eq(d.share);
                    expect(oldD.callQueue).eq(d.callQueue);
                }
            }

            const depositorMigrator = await deployContract<DepositorMigrator>(
                hre,
                new DepositorMigrator__factory(deployer),
                "DepositorMigrator",
                [contracts.crvDepositor.address, [], []],
                {},
                true,
                1,
            );

            await contracts.crvDepositor.connect(daoSigner).setBooster(boosterEarmark.address, 1).then(tx => tx.wait(1));
            await contracts.crvDepositor.connect(daoSigner).transferOwnership(depositorMigrator.address).then(tx => tx.wait(1));
            await contracts.voterProxy.connect(daoSigner).setOwner(depositorMigrator.address).then(tx => tx.wait());

            migrateTx = await depositorMigrator.migrate().then(tx => tx.wait(1));
            const migrated = migrateTx.events.filter(e => e.event === 'Migrated')[0];
            contracts.crvDepositor = WomDepositor__factory.connect(migrated.args.newDepositor, deployer);

            await expect(boosterEarmark.earmarkRewards(lastPid)).to.be.revertedWith("!auth");

            await contracts.cvxStakingProxy.connect(daoSigner).setConfig(contracts.crvDepositor.address, contracts.cvxLocker.address).then(tx => tx.wait(1));
            await contracts.cvxStakingProxy.setApprovals().then(tx => tx.wait());

            await boosterEarmark.earmarkRewards(lastPid).then(tx => tx.wait());

            // tx = await booster.connect(daoSigner).setRewardTokenPausedInPools([crvRewards.address], underlying.address, true);
            // await tx.wait();

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            let tx = await crvRewards["getReward(address,bool)"](bobAddress, false);
            const boosterReward = await getBoosterReward(tx, newBoosterContract, 1);
            expect(await cvx.balanceOf(bobAddress)).gt(cvxBalanceBefore);

            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);

            await contracts.crv.transfer(bobAddress, amount).then(tx => tx.wait(1));
            await contracts.crv.connect(bob).approve(contracts.crvDepositor.address, amount).then(tx => tx.wait(1));
            await contracts.crvDepositor.connect(bob)["deposit(uint256,address)"](amount, cvxCrvRewards.address).then(tx => tx.wait(1));
        });

        it("pendingRewards after migration should work properly", async () => {
            const mwPool = await mocks.masterWombat.poolInfo('0');
            await deployer.sendTransaction({ to: mwPool.rewarder, value: BN.from(10).pow(20) });

            await boosterEarmark.connect(daoSigner).addPool(mwPool.lpToken, mocks.masterWombat.address).then(tx => tx.wait(1));

            const lptoken = await deployContract<Asset>(hre, new Asset__factory(deployer), "Asset", [underlying.address, 'MockLP', 'MockLP', mocks.pool.address], {}, true, 1);
            const multiRewarder = await deployContract<MultiRewarderPerSec>(
                hre,
                new MultiRewarderPerSec__factory(deployer),
                "MultiRewarderPerSec",
                [mocks.masterWombat.address, lptoken.address, (await getTimestamp()).add(1), ZERO_ADDRESS, 152207000000000 / 2],
                {},
                true,
            );
            await deployer.sendTransaction({ to: multiRewarder.address, value: BN.from(10).pow(20) });
            await mocks.pool.addAsset(underlying.address, lptoken.address).then(tx => tx.wait(1));
            await mocks.masterWombat.add('1', lptoken.address, multiRewarder.address).then(tx => tx.wait(1));
            await underlying.approve(mocks.pool.address, simpleToExactAmount(10000, 9)).then(tx => tx.wait(1));
            await mocks.pool.deposit(underlying.address, simpleToExactAmount(10000, 9), '0', deployerAddress, new Date().getTime(), false).then(tx => tx.wait(1));
            await lptoken.transfer(bobAddress, simpleToExactAmount(1000, 9)).then(tx => tx.wait(1));
            await boosterEarmark.connect(daoSigner).addPool(lptoken.address, mocks.masterWombat.address).then(tx => tx.wait(1));

            await contracts.voterProxy.connect(daoSigner).setLpTokensPid(mocks.masterWombat.address).then(tx => tx.wait(1));

            const amount = ethers.utils.parseEther("1000");

            let feesSub = BigNumber.from(10000);
            feesSub = feesSub.sub(await boosterEarmark.distributionByTokens(crv.address, 0).then(d => d.share));
            feesSub = feesSub.sub(await boosterEarmark.distributionByTokens(crv.address, 1).then(d => d.share));
            feesSub = feesSub.sub(await boosterEarmark.distributionByTokens(crv.address, 2).then(d => d.share));
            feesSub = feesSub.sub(await boosterEarmark.earmarkIncentive());

            await increaseTime(60 * 60 * 24);

            const lpToken0 = await ERC20__factory.connect(await newBoosterContract.poolInfo(0).then(p => p.lptoken), deployer);
            await lpToken0.connect(bob).approve(newBoosterContract.address, amount.mul(10)).then(tx => tx.wait());
            const crvRewards0 = await BaseRewardPool__factory.connect(await newBoosterContract.poolInfo(0).then(p => p.crvRewards), deployer);

            await newBoosterContract.connect(daoSigner).updateLpPendingRewardTokensByGauge(0).then(tx => tx.wait(1));
            const tokens0 = await newBoosterContract.getPendingRewardTokens(lpToken0.address);
            expect(tokens0.length).eq(2);
            expect(tokens0[0]).eq(crv.address);
            expect(tokens0[1]).eq(underlying.address);

            const lpToken3 = await ERC20__factory.connect(await newBoosterContract.poolInfo(3).then(p => p.lptoken), deployer);
            await lpToken3.connect(bob).approve(newBoosterContract.address, amount.mul(10)).then(tx => tx.wait());
            const crvRewards3 = await BaseRewardPool__factory.connect(await newBoosterContract.poolInfo(3).then(p => p.crvRewards), deployer);

            await newBoosterContract.connect(daoSigner).updateLpPendingRewardTokensByGauge(3).then(tx => tx.wait(1));
            const tokens3 = await newBoosterContract.getPendingRewardTokens(lpToken3.address);
            expect(tokens3.length).eq(2);
            expect(tokens3[0]).eq(crv.address);
            expect(tokens3[1]).eq(mocks.weth.address);

            const amount9 = simpleToExactAmount(100, 9)

            const lpToken4 = await ERC20__factory.connect(await newBoosterContract.poolInfo(4).then(p => p.lptoken), deployer);
            await lpToken4.connect(bob).approve(newBoosterContract.address, amount9.mul(10)).then(tx => tx.wait());

            await newBoosterContract.connect(daoSigner).updateLpPendingRewardTokensByGauge(4).then(tx => tx.wait(1));
            const tokens4 = await newBoosterContract.getPendingRewardTokens(lpToken4.address);
            expect(tokens4.length).eq(2);
            expect(tokens4[0]).eq(crv.address);
            expect(tokens4[1]).eq(mocks.weth.address);

            expect(await newBoosterContract.lpPendingRewards(lpToken4.address, crv.address)).eq(0);

            await newBoosterContract.connect(bob).deposit(3, amount, true).then(tx => tx.wait(1));
            await newBoosterContract.connect(bob).deposit(4, amount9, true).then(tx => tx.wait(1));
            await boosterEarmark.connect(bob).earmarkRewards(3).then(tx => tx.wait());

            await increaseTime(60 * 60 * 24);

            // const excessCrvAmount = simpleToExactAmount(4);

            // await crv.transfer(newBoosterContract.address, excessCrvAmount);

            let ethBalanceBefore = await hre.ethers.provider.getBalance(contracts.voterProxy.address);
            let tx = await newBoosterContract.connect(bob).deposit(3, amount, true).then(tx => tx.wait(1));
            const reward00 = getMasterWombatReward(tx, contracts.voterProxy.address, crv);
            expect(await newBoosterContract.lpPendingRewards(lpToken3.address, crv.address)).eq(reward00.value);
            // expect(await crv.balanceOf(newBoosterContract.address)).eq(excessCrvAmount);
            expect(await crv.balanceOf(newBoosterContract.address)).eq(0);
            expect(await crv.balanceOf(contracts.voterProxy.address)).eq(reward00.value);
            expect(reward00.value).gt(0);
            let ethBalanceAfter = await hre.ethers.provider.getBalance(contracts.voterProxy.address);
            expect(await newBoosterContract.lpPendingRewards(lpToken3.address, mocks.weth.address)).eq(ethBalanceAfter.sub(ethBalanceBefore));
            expect(ethBalanceAfter.sub(ethBalanceBefore)).gt(0);

            // await crv.transfer(contracts.voterProxy.address, excessCrvAmount);

            ethBalanceBefore = await hre.ethers.provider.getBalance(contracts.voterProxy.address);
            tx = await newBoosterContract.connect(bob).deposit(4, amount9, true).then(tx => tx.wait());
            const reward01 = getMasterWombatReward(tx, contracts.voterProxy.address, crv);
            expect(await newBoosterContract.lpPendingRewards(lpToken4.address, crv.address)).eq(reward01.value);
            expect(await crv.balanceOf(newBoosterContract.address)).eq(0);
            // expect(await crv.balanceOf(newBoosterContract.address)).eq(excessCrvAmount);
            // expect(await crv.balanceOf(contracts.voterProxy.address)).eq(reward00.value.add(reward01.value).add(excessCrvAmount));
            expect(await crv.balanceOf(contracts.voterProxy.address)).eq(reward00.value.add(reward01.value));
            expect(reward01.value).gt(0);
            ethBalanceAfter = await hre.ethers.provider.getBalance(contracts.voterProxy.address);
            expect(await newBoosterContract.lpPendingRewards(lpToken4.address, mocks.weth.address)).eq(ethBalanceAfter.sub(ethBalanceBefore));
            expect(ethBalanceAfter.sub(ethBalanceBefore)).gt(0);

            // await expect(newBoosterContract.connect(daoSigner).releaseToken(crv.address, treasuryAddress)).to.revertedWith("SafeMath: subtraction overflow");

            const crvPendingRewards02 = await newBoosterContract.lpPendingRewards(lpToken3.address, crv.address);
            const wethPendingRewards04 = await newBoosterContract.lpPendingRewards(lpToken4.address, mocks.weth.address);
            let {historicalRewards, queuedRewards} = await crvRewards3.tokenRewards(crv.address);
            let crvRewardsBefore = historicalRewards.add(queuedRewards);
            ({historicalRewards, queuedRewards} = await crvRewards3.tokenRewards(mocks.weth.address));
            let wethRewardsBefore = historicalRewards.add(queuedRewards);
            tx = await boosterEarmark.connect(bob).earmarkRewards(3).then(tx => tx.wait());
            const reward02Crv = getMasterWombatReward(tx, contracts.voterProxy.address);
            const reward02CrvDistributed = getMasterWombatReward(tx, crvRewards3.address);
            const reward02Weth = getMasterWombatReward(tx, newBoosterContract.address, mocks.weth);
            const reward02WethDistributed = getMasterWombatReward(tx, crvRewards3.address, mocks.weth);

            // expect(await crv.balanceOf(newBoosterContract.address)).eq(excessCrvAmount.mul(2).add(reward01.value));
            expect(await crv.balanceOf(newBoosterContract.address)).eq(reward01.value);
            expect(await crv.balanceOf(contracts.voterProxy.address)).eq(0);

            let resultRewardsCrv = reward02Crv.value.add(crvPendingRewards02).mul(feesSub).div(10000);
            equalWithSmallDiff(resultRewardsCrv, reward02CrvDistributed.value);
            equalWithSmallDiff(resultRewardsCrv.add(crvRewardsBefore), await crvRewards3.tokenRewards(crv.address).then(r => r.historicalRewards.add(r.queuedRewards)));
            let resultRewardsWeth = reward02Weth.value.sub(wethPendingRewards04).mul(feesSub).div(10000);
            equalWithSmallDiff(resultRewardsWeth, reward02WethDistributed.value);
            equalWithSmallDiff(resultRewardsWeth.add(wethRewardsBefore), await crvRewards3.tokenRewards(mocks.weth.address).then(r => r.historicalRewards.add(r.queuedRewards)));
            expect(await newBoosterContract.lpPendingRewards(lpToken3.address, crv.address)).eq(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken3.address, mocks.weth.address)).eq(0);

            // const treasuryBalanceBefore = await crv.balanceOf(treasuryAddress);
            // await expect(newBoosterContract.releaseToken(crv.address, treasuryAddress)).to.revertedWith("!auth");
            // tx = await newBoosterContract.connect(daoSigner).releaseToken(crv.address, treasuryAddress).then(tx => tx.wait());
            // let ReleaseTokenEvent = tx.events.filter(e => e.event === 'ReleaseToken')[0];
            // expect(ReleaseTokenEvent.args.amount).eq(excessCrvAmount.mul(2));
            // expect(treasuryBalanceBefore.add(excessCrvAmount.mul(2))).eq(await crv.balanceOf(treasuryAddress));
            expect(await crv.balanceOf(newBoosterContract.address)).eq(reward01.value);
            expect(await crv.balanceOf(contracts.voterProxy.address)).eq(0);

            // await crv.transfer(newBoosterContract.address, excessCrvAmount);
            // await crv.transfer(contracts.voterProxy.address, excessCrvAmount);

            await boosterEarmark.connect(bob).earmarkRewards(4).then(tx => tx.wait());
            // await newBoosterContract.connect(daoSigner).releaseToken(mocks.weth.address, treasuryAddress).then(tx => tx.wait());
            // expect(await mocks.weth.balanceOf(newBoosterContract.address)).eq(0);
            // expect(await mocks.crv.balanceOf(newBoosterContract.address)).eq(excessCrvAmount.mul(2));
            expect(await mocks.crv.balanceOf(newBoosterContract.address)).eq(0);
            expect(await mocks.crv.balanceOf(contracts.voterProxy.address)).eq(0);

            // tx = await newBoosterContract.connect(daoSigner).releaseToken(crv.address, treasuryAddress).then(tx => tx.wait());
            // ReleaseTokenEvent = tx.events.filter(e => e.event === 'ReleaseToken')[0];
            // expect(ReleaseTokenEvent.args.amount).eq(excessCrvAmount.mul(2));

            // expect(await crv.balanceOf(newBoosterContract.address)).eq(0);
            // expect(await mocks.crv.balanceOf(contracts.voterProxy.address)).eq(0);

            // tx = await newBoosterContract.connect(daoSigner).releaseToken(crv.address, treasuryAddress).then(tx => tx.wait());
            // ReleaseTokenEvent = tx.events.filter(e => e.event === 'ReleaseToken')[0];
            // expect(ReleaseTokenEvent.args.amount).eq(0);

            // await crv.transfer(newBoosterContract.address, excessCrvAmount);
            // expect(await crv.balanceOf(newBoosterContract.address)).eq(excessCrvAmount);
            // tx = await newBoosterContract.connect(daoSigner).releaseToken(crv.address, treasuryAddress).then(tx => tx.wait());
            // ReleaseTokenEvent = tx.events.filter(e => e.event === 'ReleaseToken')[0];
            // expect(ReleaseTokenEvent.args.amount).eq(excessCrvAmount);
            // expect(await crv.balanceOf(newBoosterContract.address)).eq(0);

            tx = await newBoosterContract.connect(bob).deposit(0, amount, true).then(tx => tx.wait());
            const reward1 = getMasterWombatReward(tx, contracts.voterProxy.address);
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(reward1.value);
            expect(reward1.value).gt(0);

            await increaseTime(60 * 60 * 24);

            tx = await newBoosterContract.connect(bob).deposit(0, amount, true).then(tx => tx.wait());
            const reward2 = getMasterWombatReward(tx, contracts.voterProxy.address);
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(reward1.value.add(reward2.value));
            expect(reward1.value.add(reward2.value)).gt(reward1.value);

            await increaseTime(60 * 60 * 24);

            const lpToken1 = await ERC20__factory.connect(await newBoosterContract.poolInfo(1).then(p => p.lptoken), deployer);
            const crvRewards1 = await BaseRewardPool__factory.connect(await newBoosterContract.poolInfo(1).then(p => p.crvRewards), deployer);
            await lpToken1.connect(bob).approve(newBoosterContract.address, amount.mul(10)).then(tx => tx.wait());

            await newBoosterContract.connect(daoSigner).updateLpPendingRewardTokensByGauge(1).then(tx => tx.wait(1));
            const tokens1 = await newBoosterContract.getPendingRewardTokens(lpToken1.address);
            expect(tokens1.length).eq(1);
            expect(tokens1[0]).eq(crv.address);

            expect(await newBoosterContract.lpPendingRewards(lpToken1.address, crv.address)).eq(0);
            tx = await newBoosterContract.connect(bob).deposit(1, amount, true).then(tx => tx.wait());
            const reward3 = getMasterWombatReward(tx, contracts.voterProxy.address);
            expect(await newBoosterContract.lpPendingRewards(lpToken1.address, crv.address)).eq(reward3.value);
            expect(reward3.value).gt(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(reward1.value.add(reward2.value));

            await increaseTime(60 * 60 * 24);

            const lpToken2 = await ERC20__factory.connect(await newBoosterContract.poolInfo(2).then(p => p.lptoken), deployer);
            const crvRewards2 = await BaseRewardPool__factory.connect(await newBoosterContract.poolInfo(2).then(p => p.crvRewards), deployer);
            await lpToken2.connect(bob).approve(newBoosterContract.address, amount.mul(10)).then(tx => tx.wait());

            await newBoosterContract.connect(daoSigner).updateLpPendingRewardTokensByGauge(2).then(tx => tx.wait(1));
            const tokens2 = await newBoosterContract.getPendingRewardTokens(lpToken2.address);
            expect(tokens2.length).eq(1);
            expect(tokens2[0]).eq(crv.address);

            expect(await newBoosterContract.lpPendingRewards(lpToken2.address, crv.address)).eq(0);
            ({historicalRewards, queuedRewards} = await crvRewards2.tokenRewards(crv.address));
            crvRewardsBefore = historicalRewards.add(queuedRewards);
            tx = await boosterEarmark.connect(bob).earmarkRewards(2).then(tx => tx.wait());
            const reward4 = getMasterWombatReward(tx, contracts.voterProxy.address);
            const reward4Distributed = getMasterWombatReward(tx, crvRewards2.address);

            let resultRewards = reward4.value.mul(feesSub).div(10000);
            equalWithSmallDiff(resultRewards, reward4Distributed.value);
            equalWithSmallDiff(resultRewards.add(crvRewardsBefore), await crvRewards2.tokenRewards(crv.address).then(r => r.historicalRewards.add(r.queuedRewards)));
            expect(await newBoosterContract.lpPendingRewards(lpToken2.address, crv.address)).eq(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken1.address, crv.address)).eq(reward3.value);
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(reward1.value.add(reward2.value));

            tx = await newBoosterContract.connect(bob).deposit(2, amount, true).then(tx => tx.wait());
            const reward5 = getMasterWombatReward(tx, contracts.voterProxy.address);
            expect(await newBoosterContract.lpPendingRewards(lpToken2.address, crv.address)).eq(reward5.value);
            expect(reward5.value).gt(0);

            ({historicalRewards, queuedRewards} = await crvRewards1.tokenRewards(crv.address));
            crvRewardsBefore = historicalRewards.add(queuedRewards);

            const pendingRewards6 = await newBoosterContract.lpPendingRewards(lpToken1.address, crv.address);
            tx = await boosterEarmark.connect(bob).earmarkRewards(1).then(tx => tx.wait());
            const reward6 = getMasterWombatReward(tx, contracts.voterProxy.address);
            const reward6Distributed = getMasterWombatReward(tx, crvRewards1.address);
            resultRewards = reward6.value.add(pendingRewards6).mul(feesSub).div(10000);
            equalWithSmallDiff(resultRewards, reward6Distributed.value);
            equalWithSmallDiff(resultRewards.add(crvRewardsBefore), await crvRewards1.tokenRewards(crv.address).then(r => r.historicalRewards.add(r.queuedRewards)));
            expect(await newBoosterContract.lpPendingRewards(lpToken2.address, crv.address)).eq(reward5.value);
            expect(await newBoosterContract.lpPendingRewards(lpToken1.address, crv.address)).eq(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(reward1.value.add(reward2.value));
            expect(await crv.balanceOf(newBoosterContract.address)).eq(reward1.value.add(reward2.value).add(reward5.value));

            await increaseTime(60 * 60 * 24);

            let crvBalanceBefore = await crv.balanceOf(bobAddress);
            tx = await crvRewards2.connect(bob).withdrawAndUnwrap(2, true).then(tx => tx.wait());
            expect(await crv.balanceOf(bobAddress)).gt(crvBalanceBefore);
            const reward7 = getMasterWombatReward(tx, contracts.voterProxy.address);
            expect(await newBoosterContract.lpPendingRewards(lpToken2.address, crv.address)).eq(reward5.value.add(reward7.value));
            expect(reward5.value.add(reward7.value)).gt(0);

            ({historicalRewards, queuedRewards} = await crvRewards2.tokenRewards(crv.address));
            crvRewardsBefore = historicalRewards.add(queuedRewards);

            const pendingRewards8 = await newBoosterContract.lpPendingRewards(lpToken2.address, crv.address);
            tx = await boosterEarmark.connect(bob).earmarkRewards(2).then(tx => tx.wait());
            const reward8 = getMasterWombatReward(tx, contracts.voterProxy.address);
            const reward8Distributed = getMasterWombatReward(tx, crvRewards2.address);
            resultRewards = reward8.value.add(pendingRewards8).mul(feesSub).div(10000);
            equalWithSmallDiff(resultRewards, reward8Distributed.value);
            equalWithSmallDiff(resultRewards.add(crvRewardsBefore), await crvRewards2.tokenRewards(crv.address).then(r => r.historicalRewards.add(r.queuedRewards)));
            expect(await newBoosterContract.lpPendingRewards(lpToken2.address, crv.address)).eq(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken1.address, crv.address)).eq(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(reward1.value.add(reward2.value));
            expect(await crv.balanceOf(newBoosterContract.address)).eq(reward1.value.add(reward2.value));

            ({historicalRewards, queuedRewards} = await crvRewards0.tokenRewards(crv.address));
            crvRewardsBefore = historicalRewards.add(queuedRewards);

            const pendingRewards9 = await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address);
            expect(await crv.balanceOf(newBoosterContract.address)).eq(pendingRewards9);
            tx = await boosterEarmark.connect(bob).earmarkRewards(0).then(tx => tx.wait());
            const reward9 = getMasterWombatReward(tx, contracts.voterProxy.address);
            const reward9Distributed = getMasterWombatReward(tx, crvRewards0.address);
            resultRewards = reward9.value.add(pendingRewards9).mul(feesSub).div(10000);
            equalWithSmallDiff(resultRewards, reward9Distributed.value);
            equalWithSmallDiff(resultRewards.add(crvRewardsBefore), await crvRewards0.tokenRewards(crv.address).then(r => r.historicalRewards.add(r.queuedRewards)));
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken1.address, crv.address)).eq(0);
            expect(await newBoosterContract.lpPendingRewards(lpToken0.address, crv.address)).eq(0);
            expect(await crv.balanceOf(newBoosterContract.address)).eq(0);

            const womBalanceBefore = await crv.balanceOf(bobAddress);
            const wmxBalanceBefore = await contracts.cvx.balanceOf(bobAddress);
            await cvxCrvRewards["getReward(address,bool)"](bobAddress, false).then(tx => tx.wait(1));
            expect(await crv.balanceOf(bobAddress)).gt(womBalanceBefore);
            expect(await contracts.cvx.balanceOf(bobAddress)).gt(wmxBalanceBefore);
        });
    });
});
