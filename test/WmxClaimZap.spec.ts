import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import {
    deployTestFirstStage,
    getMockDistro,
    getMockMultisigs
} from "../scripts/deployMocks";
import {SystemDeployed, deploy} from "../scripts/deploySystem";
import { increaseTime } from "../test-utils/time";
import { ONE_WEEK, ZERO_ADDRESS, DEAD_ADDRESS, MAX_UINT256 } from "../test-utils/constants";
import { simpleToExactAmount } from "../test-utils/math";
import { BaseRewardPool__factory } from "../types/generated";
import {impersonateAccount} from "../test-utils";

describe("WmxClaimZap", () => {
    let accounts: Signer[];
    let mocks;
    let deployer: Signer;
    let contracts: SystemDeployed;
    let alice: Signer;
    let aliceAddress: string;

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        deployer = accounts[0];
        mocks = await deployTestFirstStage(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        contracts = await deploy(hre, deployer, deployer, mocks, distro, multisigs, mocks.namingConfig, mocks);

        await mocks.crv.transfer(aliceAddress, simpleToExactAmount(1));
        // await mocks.crv.transfer(mocks.balancerVault.address, simpleToExactAmount(10));
        // await contracts.cvxCrv.transfer(mocks.balancerVault.address, simpleToExactAmount(10));
        //
        // await mocks.balancerVault.setTokens(contracts.cvxCrv.address, mocks.crv.address);

        const amount = ethers.utils.parseEther("1000");
        let tx = await mocks.lptoken.transfer(aliceAddress, amount);
        await tx.wait();
        tx = await mocks.lptoken.connect(alice).approve(contracts.booster.address, amount);
        await tx.wait();
        tx = await contracts.booster.connect(alice).deposit(0, amount, true);
        await tx.wait();
        const operatorAccount = await impersonateAccount(contracts.booster.address);
        tx = await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(aliceAddress, amount);
        await tx.wait();
        tx = await contracts.cvx.connect(alice).approve(contracts.cvxLocker.address, amount);
        await tx.wait();
        tx = await contracts.cvxLocker.connect(alice).lock(aliceAddress, amount);
        await tx.wait();
    });

    it("initial configuration is correct", async () => {
        expect(await contracts.claimZap.getName()).to.be.eq("ClaimZap V3.0");
    });

    it("set approval for deposits", async () => {
        await contracts.claimZap.setApprovals();
        expect(await mocks.crv.allowance(contracts.claimZap.address, contracts.crvDepositor.address)).gte(
            ethers.constants.MaxUint256,
        );
        expect(await contracts.cvxCrv.allowance(contracts.claimZap.address, contracts.cvxCrvRewards.address)).gte(
            ethers.constants.MaxUint256,
        );
        expect(await contracts.cvx.allowance(contracts.claimZap.address, contracts.cvxLocker.address)).gte(
            ethers.constants.MaxUint256,
        );
    });

    it("claim rewards from cvxCrvStaking", async () => {
        const stakeAddress = contracts.cvxCrvRewards.address;
        const balance = await mocks.crv.balanceOf(aliceAddress);
        console.log('balance', balance);

        const balanceBeforeReward = await contracts.cvxCrvRewards.balanceOf(aliceAddress);

        await mocks.crv.connect(alice).approve(contracts.crvDepositor.address, balance);
        await contracts.crvDepositor.connect(alice)["deposit(uint256,bool,address)"](balance, true, stakeAddress);

        const rewardBalance = await contracts.cvxCrvRewards.balanceOf(aliceAddress);
        expect(rewardBalance).gt(balanceBeforeReward);

        const cvxCrvBalance = await contracts.cvxCrv.balanceOf(aliceAddress);
        const cvxBalance = await contracts.cvx.balanceOf(aliceAddress);

        await increaseTime(ONE_WEEK.mul("4"));

        await contracts.booster.earmarkRewards(0);

        await contracts.extraRewardsDistributor.modifyWhitelist(await deployer.getAddress(), true).then(tx => tx.wait(1));
        await contracts.cvx.approve(contracts.extraRewardsDistributor.address, ethers.utils.parseEther("1000"));
        await contracts.extraRewardsDistributor.addReward(contracts.cvx.address, ethers.utils.parseEther("900")).then(tx => tx.wait(1));

        await increaseTime(ONE_WEEK.mul("4"));

        await contracts.extraRewardsDistributor.addReward(contracts.cvx.address, ethers.utils.parseEther("100")).then(tx => tx.wait(1));

        const expectedRewards = await contracts.cvxCrvRewards.earned(mocks.crv.address, aliceAddress);
        console.log('expectedRewards', expectedRewards);

        await mocks.crv.connect(alice).approve(contracts.claimZap.address, ethers.constants.MaxUint256);

        let option = 1 + 16 + 8;
        const tx = await contracts.claimZap
            .connect(alice)
            .claimRewards([], [contracts.cvx.address], [], [], expectedRewards, 0, 0, option).then(tx => tx.wait(1));

        const rewardPaid = tx.events
            .filter(e => e.address.toLowerCase() === contracts.extraRewardsDistributor.address.toLowerCase())
            .map(e => {
                try { return contracts.extraRewardsDistributor.interface.decodeEventLog('RewardPaid', e.data, e.topics); }
                catch (e) { return null; }
            }).filter(e => e)[0];

        expect(rewardPaid.user).eq(aliceAddress);
        expect(rewardPaid.reward).gt('0');
        expect(await contracts.cvx.balanceOf(aliceAddress)).gt(cvxBalance);

        const newCvxCrvBalance = await contracts.cvxCrv.balanceOf(aliceAddress);
        expect(newCvxCrvBalance).gt(cvxCrvBalance);

        expect(rewardBalance).eq(await contracts.cvxCrvRewards.balanceOf(aliceAddress));

        await increaseTime(ONE_WEEK.mul("4"));

        await contracts.booster.earmarkRewards(0);
        option = 1 + 16 + 8 + 128;
        await contracts.claimZap
            .connect(alice)
            .claimRewards([], [], [], [], expectedRewards, 0, 0, option);

        expect(newCvxCrvBalance).eq(await contracts.cvxCrv.balanceOf(aliceAddress));
        expect(await contracts.cvxCrvRewards.balanceOf(aliceAddress)).gt(rewardBalance);
    });

    it("claim from lp staking pool", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("10");
        await mocks.lptoken.transfer(aliceAddress, amount);
        await mocks.lptoken.connect(alice).approve(contracts.booster.address, amount);
        await contracts.booster.connect(alice).deposit(0, amount, stake);

        await contracts.booster.earmarkRewards(0);
        const pool = await contracts.booster.poolInfo(0);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);
        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await mocks.crv.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(mocks.crv.address, aliceAddress);
        const cvxBalanceBefore = await contracts.cvx.balanceOf(aliceAddress);

        const options = 32;
        await contracts.claimZap.connect(alice).claimRewards([pool.crvRewards], [], [], [], 0, 0, 0, options);

        const balanceAfter = await mocks.crv.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);

        expect(await contracts.cvx.balanceOf(aliceAddress)).gt(cvxBalanceBefore);
    });

    it("claim from lp staking pool and cvxCrvStaking, lock wmx", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("10");
        await mocks.lptoken.transfer(aliceAddress, amount);
        await mocks.lptoken.connect(alice).approve(contracts.booster.address, amount);
        await contracts.booster.connect(alice).deposit(0, amount, stake);

        await contracts.booster.earmarkRewards(0);
        const pool = await contracts.booster.poolInfo(0);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);
        await increaseTime(ONE_WEEK.mul("2"));

        await contracts.cvx.connect(alice).transfer(DEAD_ADDRESS, await contracts.cvx.balanceOf(aliceAddress));

        const balanceBefore = await mocks.crv.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(mocks.crv.address, aliceAddress);
        const cvxBalanceBefore = await contracts.cvx.balanceOf(aliceAddress);

        const options = 1 + 16 + 8 + 32 + 64;
        await contracts.cvx.connect(alice).approve(contracts.claimZap.address, MAX_UINT256);
        const tx = await contracts.claimZap.connect(alice).claimRewards([pool.crvRewards], [], [], [], 0, 0, MAX_UINT256, options);
        const {events} = await tx.wait(1);
        const rewardClaimedEvents = events
            .filter(e => e.address.toLowerCase() === contracts.booster.address.toLowerCase())
            .map(e => contracts.booster.interface.decodeEventLog('RewardClaimed', e.data, e.topics));

        expect(rewardClaimedEvents.length).eq(2);
        rewardClaimedEvents.forEach(e => {
            expect(e.lock).eq(true);
        })

        const balanceAfter = await mocks.crv.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).gt(expectedRewards);

        expect(await contracts.cvx.balanceOf(aliceAddress)).eq(cvxBalanceBefore);
    });

    it("verifies only owner can set approvals", async () => {
        expect(await contracts.claimZap.owner()).not.eq(aliceAddress);
        await expect(contracts.claimZap.connect(alice).setApprovals()).to.be.revertedWith("!auth");
    });
    it("fails if claim rewards are incorrect", async () => {
        const options = 0;
        await expect(
            contracts.claimZap.connect(alice).claimRewards([], [], [], [ZERO_ADDRESS], 0, 0, 0, options),
        ).to.be.revertedWith("!parity");
    });
});
