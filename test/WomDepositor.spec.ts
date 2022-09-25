import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import {
    deployTestFirstStage,
    getMockDistro,
    getMockMultisigs
} from "../scripts/deployMocks";
import {SystemDeployed, deploy, updateDistributionByTokens} from "../scripts/deploySystem";
import { increaseTime } from "../test-utils/time";
import { ONE_HOUR, ONE_WEEK, ZERO_ADDRESS, DEAD_ADDRESS, MAX_UINT256 } from "../test-utils/constants";
import { simpleToExactAmount } from "../test-utils/math";
import {
    BaseRewardPool,
    VeWom, VoterProxy,
    WomDepositor
} from "../types/generated";

describe("WomDepositor", () => {
    let accounts: Signer[];
    let mocks, veWom: VeWom;
    let deployer: Signer;
    let contracts: SystemDeployed;
    let womDepositor: WomDepositor, cvxCrvRewards: BaseRewardPool, voterProxy: VoterProxy;
    let daoSigner: Signer, alice: Signer, bob: Signer;
    let daoAddress: string, aliceAddress: string, bobAddress: string;

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();

        deployer = accounts[0];

        daoSigner = accounts[1];
        daoAddress = await daoSigner.getAddress();

        alice = accounts[2];
        aliceAddress = await alice.getAddress();

        bob = accounts[3];
        bobAddress = await bob.getAddress();

        mocks = await deployTestFirstStage(hre, deployer);
        veWom = mocks.veWom;
        const multisigs = await getMockMultisigs(deployer, deployer, daoSigner);
        const distro = getMockDistro();
        contracts = await deploy(hre, deployer, mocks, distro, multisigs, mocks.namingConfig, mocks);
        ({ crvDepositor: womDepositor, cvxCrvRewards, voterProxy } = contracts);

        await mocks.crv.transfer(aliceAddress, simpleToExactAmount(1000));
        await mocks.crv.transfer(bobAddress, simpleToExactAmount(1000));
    });

    it("setLockConfig can be configured", async () => {
        await expect(womDepositor.setLockConfig(14, 60 * 60)).to.be.revertedWith("Ownable: caller is not the owner");
        await womDepositor.connect(daoSigner).setLockConfig(14, 60 * 60);

        expect(await womDepositor.lockDays()).to.be.eq(14);
        expect(await womDepositor.smartLockPeriod()).to.be.eq(60 * 60);
    });

    it("deposit do not trigger lock, until smart lock period reached", async () => {
        const stakeAddress = contracts.cvxCrvRewards.address;
        await mocks.crv.connect(alice).approve(womDepositor.address, await mocks.crv.balanceOf(aliceAddress));

        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        let cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(aliceAddress);
        const amountToDeposit = simpleToExactAmount(10);
        let tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));

        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(1);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(1);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);
        expect(await cvxCrvRewards.balanceOf(aliceAddress)).eq(cvxCrvBalanceBefore.add(amountToDeposit));

        await increaseTime(ONE_HOUR.div(4));

        cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(aliceAddress);
        await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(1);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(1);
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await cvxCrvRewards.balanceOf(aliceAddress)).eq(cvxCrvBalanceBefore.add(amountToDeposit));
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(amountToDeposit);

        await increaseTime(ONE_HOUR.div(4));

        cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(aliceAddress);
        await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(1);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(1);
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await cvxCrvRewards.balanceOf(aliceAddress)).eq(cvxCrvBalanceBefore.add(amountToDeposit));
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(amountToDeposit.mul(2));

        await increaseTime(ONE_HOUR.div(2));

        cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(aliceAddress);
        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(2);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(2);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.mul(3));
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await cvxCrvRewards.balanceOf(aliceAddress)).eq(cvxCrvBalanceBefore.add(amountToDeposit));
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_HOUR);

        cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(aliceAddress);
        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit.mul(2), stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(3);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(3);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.mul(3));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit.mul(2));
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await cvxCrvRewards.balanceOf(aliceAddress)).eq(cvxCrvBalanceBefore.add(amountToDeposit.mul(2)));
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);
    });

    it("should release old slots when they ends", async () => {
        const stakeAddress = contracts.cvxCrvRewards.address;

        await increaseTime(ONE_WEEK.mul(2).sub(ONE_HOUR.mul(2)));

        let cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(aliceAddress);
        const prevAmountToDeposit = simpleToExactAmount(10);
        const amountToDeposit = simpleToExactAmount(11);
        let tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(3);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(3);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(3));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit));
        expect(await womDepositor.checkOldSlot()).eq(1);
        expect(await cvxCrvRewards.balanceOf(aliceAddress)).eq(cvxCrvBalanceBefore.add(amountToDeposit));
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_HOUR.div(2));

        await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(3);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(3);
        expect(await womDepositor.checkOldSlot()).eq(1);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(amountToDeposit);

        await increaseTime(ONE_HOUR.div(2));

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(3);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(3);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit.mul(2).add(prevAmountToDeposit.mul(3)));
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_HOUR.div(2));

        await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(3);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(3);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit.mul(2).add(prevAmountToDeposit.mul(3)));
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(amountToDeposit);
    });

    it("should lock by custom lock days", async () => {
        await increaseTime(ONE_HOUR);

        await mocks.crv.connect(bob).approve(womDepositor.address, await mocks.crv.balanceOf(bobAddress));

        expect(await womDepositor.customLockDays(bobAddress)).eq(0);
        await expect(womDepositor.setCustomLock(bobAddress, 7, simpleToExactAmount(100))).to.be.revertedWith("Ownable: caller is not the owner");
        await womDepositor.connect(daoSigner).setCustomLock(bobAddress, 7, simpleToExactAmount(100));
        expect(await womDepositor.customLockDays(bobAddress)).eq(7);

        await expect(womDepositor.connect(bob)["depositCustomLock(uint256)"](simpleToExactAmount(10)), "<customLockMinAmount").to.be.revertedWith("<customLockMinAmount");
        await expect(womDepositor.connect(alice)["depositCustomLock(uint256)"](simpleToExactAmount(100)), "!custom").to.be.revertedWith("!custom");

        let womBalanceBefore = await mocks.crv.balanceOf(bobAddress);
        let cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(bobAddress);
        const prev2xAmountToDeposit = simpleToExactAmount(10);
        const prevAmountToDeposit = simpleToExactAmount(11);
        const amountToDeposit = simpleToExactAmount(100);
        let tx = await womDepositor.connect(bob)["depositCustomLock(uint256)"](amountToDeposit).then(r => r.wait(1));
        expect(await mocks.crv.balanceOf(bobAddress)).eq(womBalanceBefore.sub(amountToDeposit));
        expect(await cvxCrvRewards.balanceOf(bobAddress)).eq(cvxCrvBalanceBefore);
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(3);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(3);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await womDepositor.checkOldSlot()).eq(1);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2)));

        expect(await womDepositor.customLockSlots(bobAddress, 0).then(s => s.number)).eq(2);
        expect(await womDepositor.customLockSlots(bobAddress, 0).then(s => s.amount)).eq(amountToDeposit);

        expect(await womDepositor.lockedCustomSlots(2)).eq(true);

        await increaseTime(ONE_HOUR);

        await expect(womDepositor.connect(bob)["releaseCustomLock(uint256)"](0), "!ends").to.be.revertedWith("!ends");

        await increaseTime(ONE_WEEK);

        await expect(womDepositor.connect(alice)["releaseCustomLock(uint256)"](0), "not existing custom lock").to.be.revertedWith("reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)");

        womBalanceBefore = await mocks.crv.balanceOf(bobAddress);
        await womDepositor.connect(bob)["releaseCustomLock(uint256)"](0).then(r => r.wait(1));
        expect(await mocks.crv.balanceOf(bobAddress)).eq(womBalanceBefore.add(amountToDeposit));
        expect(await womDepositor.currentSlot()).eq(2);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(2);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit));

        expect(await womDepositor.lockedCustomSlots(2)).eq(false);
    });

    it("should skip slots locked by custom", async () => {
        const stakeAddress = contracts.cvxCrvRewards.address;

        await increaseTime(ONE_HOUR);

        let womBalanceBefore = await mocks.crv.balanceOf(bobAddress);
        let cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(bobAddress);
        const prev2xAmountToDeposit = simpleToExactAmount(10);
        const prevAmountToDeposit = simpleToExactAmount(11);
        const amountToDeposit = simpleToExactAmount(100);
        let tx = await womDepositor.connect(bob)["depositCustomLock(uint256)"](amountToDeposit).then(r => r.wait(1));
        expect(await mocks.crv.balanceOf(bobAddress)).eq(womBalanceBefore.sub(amountToDeposit));
        expect(await cvxCrvRewards.balanceOf(bobAddress)).eq(cvxCrvBalanceBefore);
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(3);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(3);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await womDepositor.checkOldSlot()).eq(1);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2)));

        expect(await womDepositor.customLockSlots(bobAddress, 0).then(s => s.number)).eq(2);
        expect(await womDepositor.customLockSlots(bobAddress, 0).then(s => s.amount)).eq(amountToDeposit);

        expect(await womDepositor.lockedCustomSlots(2)).eq(true);

        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(0));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(1));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(2));

        await increaseTime(ONE_HOUR);

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(4);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(4);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await womDepositor.checkOldSlot()).eq(1);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_HOUR);

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(5);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await womDepositor.checkOldSlot()).eq(1);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_WEEK);

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(5);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(5);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));
        expect(await womDepositor.checkOldSlot()).eq(2);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(0));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(1));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(2));
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(3));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(4));

        await increaseTime(ONE_WEEK.mul(2));

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(6);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(6);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));
        expect(await veWom.getBreeding(voterProxy.address, 5).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await womDepositor.checkOldSlot()).eq(3);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_HOUR);

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(6);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(6);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));
        expect(await veWom.getBreeding(voterProxy.address, 5).then(b => b.womAmount)).eq(amountToDeposit.mul(2).add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await womDepositor.checkOldSlot()).eq(4);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        womBalanceBefore = await mocks.crv.balanceOf(bobAddress);
        await womDepositor.connect(bob)["releaseCustomLock(uint256)"](0).then(r => r.wait(1));
        expect(await mocks.crv.balanceOf(bobAddress)).eq(womBalanceBefore.add(amountToDeposit));
        expect(await womDepositor.currentSlot()).eq(5);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(5);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3)));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit.mul(2).add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));
    });

    async function getTxTimestamp(tx) {
        const lockBlock = await ethers.provider.getBlock(tx.blockNumber);
        return ethers.BigNumber.from(lockBlock.timestamp);
    }
});
