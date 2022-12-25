import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import {
    deploy,
    MultisigConfig,
    SystemDeployed,
} from "../scripts/deploySystem";
import {deployTestFirstStage, getMockDistro, getMockMultisigs} from "../scripts/deployMocks";
import {
    WmxRewardPool,
    WmxRewardPool__factory,
    ERC20,
    WomDepositor,
    WmxRewardPoolFactory, WmxRewardPoolFactory__factory, WmxRewardPoolV2__factory
} from "../types/generated";
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "../test-utils/constants";
import { increaseTime, getTimestamp } from "../test-utils/time";
import { BN, simpleToExactAmount } from "../test-utils/math";
import { assertBNClose, assertBNClosePercent } from "../test-utils/assertions";
import {deployContract} from "../tasks/utils";

describe("WmxRewardPool", () => {
    let accounts: Signer[];

    let contracts: SystemDeployed;
    let rewards: WmxRewardPool;
    let cvxCrv: ERC20;
    let multisigs: MultisigConfig;
    let womDepositor: WomDepositor;
    let mocks: any;

    let deployer: Signer, daoSigner: Signer, treasurySigner: Signer;

    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;
    let rob: Signer;
    let robAddress: string;
    let initialBal: BN;
    let rewardAmount: BN;
    let stakeAmount: BN;

    const setup = async () => {
        mocks = await deployTestFirstStage(hre, deployer);
        daoSigner = accounts[0];
        treasurySigner = accounts[7];
        multisigs = await getMockMultisigs(daoSigner, treasurySigner, daoSigner);
        const distro = getMockDistro();

        contracts = await deploy(hre, deployer, daoSigner, mocks, distro, multisigs, mocks.namingConfig, mocks);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        bob = accounts[2];
        bobAddress = await bob.getAddress();

        rob = accounts[3];
        robAddress = await rob.getAddress();

        rewards = contracts.initialCvxCrvStaking.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice) as ERC20;

        ({ crvDepositor: womDepositor } = contracts);

        await womDepositor.connect(daoSigner).setLockConfig(14, 60 * 60);

        initialBal = simpleToExactAmount(1000);
        await mocks.crv.transfer(aliceAddress, initialBal);
        await mocks.crv.connect(alice).approve(womDepositor.address, initialBal);
        await womDepositor.connect(alice)["deposit(uint256,address)"](initialBal, ZERO_ADDRESS).then(r => r.wait(1));

        await mocks.crv.approve(womDepositor.address, initialBal.div(2));
        await womDepositor["deposit(uint256,address)"](initialBal.div(2), ZERO_ADDRESS).then(r => r.wait(1));
        await contracts.cvxCrv.transfer(bobAddress, initialBal.div(2));

        stakeAmount = initialBal.div(10);
    };
    async function verifyWithdraw(signer: Signer, accountAddress: string, amount: BN, claim = false, lock = false) {
        const totalSupplyBefore = await rewards.totalSupply();
        const stakedBalanceBefore = await rewards.balanceOf(accountAddress);
        const lockedBalanceBefore = await contracts.cvxLocker.balances(accountAddress);
        const stakedTknBalanceBefore = await cvxCrv.balanceOf(accountAddress);
        const cvxBalanceBefore = await contracts.cvx.balanceOf(accountAddress);
        const pendingPenaltyBefore = await rewards.pendingPenalty();

        // Test withdraw(amount,claim, lock)
        const tx = await rewards.connect(signer).withdraw(amount, claim, lock);
        await expect(tx).to.emit(rewards, "Withdrawn").withArgs(accountAddress, amount);
        const pendingPenaltyAfter = await rewards.pendingPenalty();
        const lockedBalanceAfter = await contracts.cvxLocker.balances(accountAddress);

        // expect to update reward
        expect(await rewards.balanceOf(accountAddress)).eq(stakedBalanceBefore.sub(amount));
        expect(await rewards.totalSupply()).eq(totalSupplyBefore.sub(amount));
        expect(await cvxCrv.balanceOf(accountAddress)).eq(stakedTknBalanceBefore.add(amount));
        if (claim) {
            expect(await rewards.rewards(accountAddress)).eq(0);
            //  rewards[account] is updated twice, at withdraw and at getReward so we can't check it directly.
            if (lock) {
                expect(lockedBalanceAfter.locked.gt(lockedBalanceBefore.locked), "locked balance should increase");
                expect(pendingPenaltyAfter, "no penalty").eq(pendingPenaltyBefore);
            } else {
                const cvxBalanceAfter = await contracts.cvx.balanceOf(accountAddress);
                const pendingPenalty = pendingPenaltyAfter.sub(pendingPenaltyBefore);
                // The amount CVX send to the user is 4 times the penalty, ie: rewards to user = earned 80%, penalty = earned 20%
                assertBNClosePercent(cvxBalanceAfter.sub(cvxBalanceBefore), pendingPenalty.mul(7).div(3), "0.001");
                assertBNClosePercent(await rewards.pendingPenalty(), pendingPenalty, "0.001");
            }
        }
    }
    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        await hre.network.provider.send("hardhat_reset");
        await setup();
    });

    it("initial configuration is correct", async () => {
        expect(await rewards.stakingToken()).eq(cvxCrv.address);
        expect(await rewards.rewardToken()).eq(contracts.cvx.address);
        expect(await rewards.rewardManager()).eq(multisigs.treasuryMultisig);
        expect(await rewards.wmxLocker()).eq(contracts.cvxLocker.address);
        expect(await rewards.penaltyForwarder()).eq(contracts.penaltyForwarder.address);
        const currentTime = await getTimestamp();
        expect(await rewards.startTime()).gt(currentTime.add(ONE_DAY.mul(6)));
        expect(await rewards.startTime()).lt(currentTime.add(ONE_DAY.mul(8)));
        rewardAmount = await contracts.cvx.balanceOf(rewards.address);
        expect(rewardAmount).gt(simpleToExactAmount(1000));
    });
    describe("basic flow", () => {
        it("allows users to deposit before rewards are added (no rewards accrued)", async () => {
            await cvxCrv.approve(rewards.address, stakeAmount);
            await rewards.stake(stakeAmount);
            expect(await rewards.rewardPerTokenStored()).eq(0);
        });
        it("allows anyone to trigger rewards distribution after startTime", async () => {
            await expect(rewards.initialiseRewards()).to.be.revertedWith("!authorized");
            await increaseTime(ONE_WEEK.mul(2));
            const timeBefore = await getTimestamp();
            const balBefore = await contracts.cvx.balanceOf(rewards.address);
            await rewards.initialiseRewards();
            const rewardRate = await rewards.rewardRate();
            const periodFinish = await rewards.periodFinish();

            assertBNClosePercent(rewardRate, balBefore.div(ONE_WEEK.mul(2)), "0.01");
            assertBNClose(periodFinish, timeBefore.add(ONE_WEEK.mul(2)), 4);
        });
        it("accrues rewards to existing depositors following startTime", async () => {
            await increaseTime(ONE_WEEK.div(5));
            const balBefore = await contracts.cvxLocker.balances(aliceAddress);
            await rewards.getReward(true); // no penalty
            const balAfter = await contracts.cvxLocker.balances(aliceAddress);
            assertBNClosePercent(balAfter.locked.sub(balBefore.locked), rewardAmount.div(10), "0.01");
        });
        it("allows subsequent deposits", async () => {
            await cvxCrv.connect(bob).approve(rewards.address, stakeAmount);
            await rewards.connect(bob).stake(stakeAmount);
        });
        it("allows users to stake For someone else", async () => {
            await cvxCrv.connect(bob).approve(rewards.address, stakeAmount);
            const stakedBalanceBefore = await rewards.balanceOf(robAddress);
            const totalSupplyBefore = await rewards.totalSupply();
            await expect(rewards.connect(bob).stakeFor(robAddress, stakeAmount))
                .to.emit(rewards, "Staked")
                .withArgs(robAddress, stakeAmount);
            expect(await rewards.balanceOf(robAddress)).eq(stakedBalanceBefore.add(stakeAmount));
            expect(await rewards.totalSupply()).eq(totalSupplyBefore.add(stakeAmount));
        });
        it("penalises claimers who do not lock", async () => {
            await increaseTime(ONE_WEEK.div(5));
            const earned = await rewards.earned(bobAddress);
            assertBNClosePercent(earned, rewardAmount.div(30), "0.01");

            const balBefore = await contracts.cvx.balanceOf(bobAddress);
            await rewards.connect(bob).getReward(false);
            const balAfter = await contracts.cvx.balanceOf(bobAddress);

            assertBNClosePercent(balAfter.sub(balBefore), earned.mul(7).div(10), "0.001");
            assertBNClosePercent(await rewards.pendingPenalty(), earned.mul(3).div(10), "0.001");
        });
        it("gives all rewards to claimers who lock", async () => {
            const balBefore = await contracts.cvxLocker.balances(aliceAddress);
            await rewards.getReward(true);
            const balAfter = await contracts.cvxLocker.balances(aliceAddress);
            assertBNClosePercent(balAfter.locked.sub(balBefore.locked), rewardAmount.div(30), "0.01");
        });
        it("allows anyone to forward penalty on to the PenaltyForwarder", async () => {
            const penalty = await rewards.pendingPenalty();
            expect(penalty).gt(0);

            await rewards.forwardPenalty();
            expect(await contracts.cvx.balanceOf(contracts.penaltyForwarder.address)).eq(penalty);
            expect(await rewards.pendingPenalty()).eq(0);
        });
        it("only forwards penalties once", async () => {
            const balBefore = await contracts.cvx.balanceOf(rewards.address);
            await rewards.forwardPenalty();
            const balAfter = await contracts.cvx.balanceOf(rewards.address);
            expect(balAfter).eq(balBefore);
        });
        it("allows users to stakeAll", async () => {
            const bobCvxCrvBalance = await cvxCrv.balanceOf(bobAddress);

            await cvxCrv.connect(bob).approve(rewards.address, bobCvxCrvBalance);
            const stakedBalanceBefore = await rewards.balanceOf(bobAddress);
            const totalSupplyBefore = await rewards.totalSupply();
            await expect(rewards.connect(bob).stakeAll())
                .to.emit(rewards, "Staked")
                .withArgs(bobAddress, bobCvxCrvBalance);
            expect(await rewards.balanceOf(bobAddress)).eq(stakedBalanceBefore.add(bobCvxCrvBalance));
            expect(await rewards.totalSupply()).eq(totalSupplyBefore.add(bobCvxCrvBalance));
        });
        it("allows users to withdraw", async () => {
            // no reward claim , no stake
            await verifyWithdraw(bob, bobAddress, stakeAmount, false, false);
        });
        it("allows users to withdraw and claim rewards", async () => {
            // Withdraw and claim rewards with penalty
            await verifyWithdraw(bob, bobAddress, stakeAmount, true, false);
        });
        it("allows users to withdraw and stake rewards", async () => {
            // Withdraw, claim rewards and stake them to avoid penalty
            await verifyWithdraw(bob, bobAddress, stakeAmount, true, true);
        });
    });
    describe("funding rewards", () => {
        before(async () => {
            await setup();
        });
        it("blocks funding before startTime", async () => {
            await expect(rewards.connect(bob).initialiseRewards()).to.be.revertedWith("!authorized");
        });
        it("allows rewardManager to start process early", async () => {
            const tx = await rewards.connect(accounts[7]).initialiseRewards();
            await expect(tx).to.emit(rewards, "RewardAdded").withArgs(rewardAmount);
        });
        it("only allows funding to be called once, ever", async () => {
            await increaseTime(ONE_WEEK);
            await expect(rewards.initialiseRewards()).to.be.revertedWith("!one time");
        });
        it("blocks funding if the pool has no balance", async () => {
            const rewardPool = await new WmxRewardPool__factory(deployer).deploy(
                cvxCrv.address,
                contracts.cvx.address,
                await deployer.getAddress(),
                contracts.cvxLocker.address,
                contracts.penaltyForwarder.address,
                ONE_WEEK,
            );
            await expect(rewardPool.connect(deployer).initialiseRewards()).to.be.revertedWith("!balance");
        });
        it("fails to rescue after rewards start", async () => {
            await expect(rewards.connect(bob).rescueReward()).to.be.revertedWith("!rescuer");
            await expect(rewards.connect(accounts[7]).rescueReward()).to.be.revertedWith("Already started");
        });
    });

    describe("wmxRewardPoolV2", () => {
        let wmxRewardPoolFactory, wmxRewardPoolV2;
        before(async () => {
            await setup();
            wmxRewardPoolFactory = await deployContract<WmxRewardPoolFactory>(
                hre,
                new WmxRewardPoolFactory__factory(deployer),
                "WmxRewardPoolFactory",
                [cvxCrv.address, contracts.cvx.address, multisigs.treasuryMultisig, contracts.cvxLocker.address, contracts.penaltyForwarder.address, [contracts.crvDepositor.address]],
                {},
                true,
                1,
            );
        });
        it("wrong creation by wmxRewardPoolFactory", async () => {
            await expect(wmxRewardPoolFactory.connect(bob).CreateWmxRewardPoolV2(0, ONE_WEEK, simpleToExactAmount(100))).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(wmxRewardPoolFactory.connect(daoSigner).CreateWmxRewardPoolV2(ONE_WEEK.mul(2), ONE_WEEK, simpleToExactAmount(100))).to.be.revertedWith("!delay");
        });
        it("allows admin to update wmxLocker address", async () => {
            expect(await wmxRewardPoolFactory.depositors(0)).eq(contracts.crvDepositor.address);

            const tx = await wmxRewardPoolFactory.connect(daoSigner).CreateWmxRewardPoolV2(ONE_WEEK.div(2), ONE_WEEK, simpleToExactAmount(100)).then(tx => tx.wait(1));
            const [RewardPoolCreated] = tx.events.filter(e => e.event === 'RewardPoolCreated');
            wmxRewardPoolV2 = WmxRewardPoolV2__factory.connect(RewardPoolCreated.args.rewardPool, deployer);

            expect(await wmxRewardPoolV2.duration()).eq(ONE_WEEK);
            expect(await wmxRewardPoolV2.maxCap()).eq(simpleToExactAmount(100));
            expect(await wmxRewardPoolV2.canStake(contracts.crvDepositor.address)).eq(true);
            expect(await wmxRewardPoolV2.canStake(bobAddress)).eq(false);
        });
        it("allows manager to initialiseRewards", async () => {
            await expect(wmxRewardPoolV2.connect(bob).initialiseRewards()).to.be.revertedWith("!authorized");
            await expect(wmxRewardPoolV2.connect(treasurySigner).initialiseRewards()).to.be.revertedWith("!balance");

            await contracts.cvx.transfer(wmxRewardPoolV2.address, simpleToExactAmount(2000));

            await wmxRewardPoolV2.connect(treasurySigner).initialiseRewards().then(tx => tx.wait(1));

            await expect(wmxRewardPoolV2.connect(treasurySigner).initialiseRewards()).to.be.revertedWith("!one time");
        });
        it("allows to stake only from womDepositor", async () => {
            await mocks.crv.transfer(aliceAddress, stakeAmount.mul(2));
            await mocks.crv.connect(alice).approve(womDepositor.address, stakeAmount.mul(2));

            await womDepositor.connect(alice)["deposit(uint256,address)"](stakeAmount.div(2), wmxRewardPoolV2.address).then(r => r.wait(1));
            await expect(await wmxRewardPoolV2.balanceOf(aliceAddress)).to.eq(stakeAmount.div(2));

            await womDepositor.connect(alice)["deposit(uint256,address)"](stakeAmount.div(2), ZERO_ADDRESS).then(r => r.wait(1));
            await cvxCrv.connect(alice).approve(wmxRewardPoolV2.address, stakeAmount.div(2));

            await expect(wmxRewardPoolV2.connect(alice)["stake(uint256)"](stakeAmount.div(2))).to.be.revertedWith("!authorized");
            await expect(wmxRewardPoolV2.connect(alice)["stakeFor(address,uint256)"](aliceAddress, stakeAmount.div(2))).to.be.revertedWith("!authorized");

            console.log('maxCap')
            await expect(await wmxRewardPoolV2.totalSupply()).to.eq(stakeAmount.div(2));
            await expect(womDepositor.connect(alice)["deposit(uint256,address)"](stakeAmount, wmxRewardPoolV2.address)).to.be.revertedWith("maxCap");

            await womDepositor.connect(alice)["deposit(uint256,address)"](stakeAmount.div(2), wmxRewardPoolV2.address).then(r => r.wait(1));
            await expect(await wmxRewardPoolV2.balanceOf(aliceAddress)).to.eq(stakeAmount);
        });
    });

    describe("fails", () => {
        it("if stake amount is zero", async () => {
            await expect(rewards.connect(bob).stake(0)).to.revertedWith("RewardPool : Cannot stake 0");
        });
        it("if stake for amount is zero", async () => {
            await expect(rewards.connect(bob).stakeFor(robAddress, 0)).to.revertedWith("RewardPool : Cannot stake 0");
        });
        it("if users to stake for does not exist", async () => {
            await expect(rewards.connect(bob).withdraw(0, true, true)).to.revertedWith(
                "RewardPool : Cannot withdraw 0",
            );
        });
        it("constructor pass wrong arguments", async () => {
            await expect(
                new WmxRewardPool__factory(deployer).deploy(
                    cvxCrv.address,
                    contracts.cvx.address,
                    await deployer.getAddress(),
                    contracts.cvxLocker.address,
                    contracts.penaltyForwarder.address,
                    ONE_WEEK.mul(2),
                ),
                "Wrong startDelay >= 2 weeks",
            ).revertedWith("!delay");
            await expect(
                new WmxRewardPool__factory(deployer).deploy(
                    ZERO_ADDRESS,
                    contracts.cvx.address,
                    await deployer.getAddress(),
                    contracts.cvxLocker.address,
                    contracts.penaltyForwarder.address,
                    ONE_WEEK,
                ),
                "Wrong _stakingToken",
            ).revertedWith("!tokens");
            await expect(
                new WmxRewardPool__factory(deployer).deploy(
                    contracts.cvx.address,
                    contracts.cvx.address,
                    await deployer.getAddress(),
                    contracts.cvxLocker.address,
                    contracts.penaltyForwarder.address,
                    ONE_WEEK,
                ),
                "Wrong _stakingToken",
            ).revertedWith("!tokens");
            await expect(
                new WmxRewardPool__factory(deployer).deploy(
                    cvxCrv.address,
                    contracts.cvx.address,
                    ZERO_ADDRESS,
                    contracts.cvxLocker.address,
                    contracts.penaltyForwarder.address,
                    ONE_WEEK,
                ),
                "Wrong _rewardManager",
            ).revertedWith("!manager");
            await expect(
                new WmxRewardPool__factory(deployer).deploy(
                    cvxCrv.address,
                    contracts.cvx.address,
                    await deployer.getAddress(),
                    ZERO_ADDRESS,
                    contracts.penaltyForwarder.address,
                    ONE_WEEK,
                ),
                "Wrong _wmxLocker",
            ).revertedWith("!locker");
            await expect(
                new WmxRewardPool__factory(deployer).deploy(
                    cvxCrv.address,
                    contracts.cvx.address,
                    await deployer.getAddress(),
                    contracts.cvxLocker.address,
                    ZERO_ADDRESS,
                    ONE_WEEK,
                ),
                "Wrong _penaltyForwarder",
            ).revertedWith("!forwarder");
        });
    });
});
