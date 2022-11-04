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
import { ONE_HOUR, ONE_WEEK } from "../test-utils/constants";
import { simpleToExactAmount } from "../test-utils/math";
import {
    BaseRewardPool, DepositorMigrator, DepositorMigrator__factory,
    VeWom, VoterProxy,
    WomDepositor, WomDepositor__factory, WomDepositorV2__factory
} from "../types/generated";
import {deployContract} from "../tasks/utils";

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
        contracts = await deploy(hre, deployer, daoSigner, mocks, distro, multisigs, mocks.namingConfig, mocks);
        ({ crvDepositor: womDepositor, cvxCrvRewards, voterProxy } = contracts);

        await mocks.crv.transfer(aliceAddress, simpleToExactAmount(2000));
        await mocks.crv.transfer(bobAddress, simpleToExactAmount(2000));
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
        expect(await womDepositor.checkOldSlot()).eq(2);
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
        await womDepositor.connect(daoSigner).setCustomLock(bobAddress, 5, simpleToExactAmount(100));
        expect(await womDepositor.customLockDays(bobAddress)).eq(5);
        expect(await womDepositor.getCustomLockAccounts().then(arr => arr.length)).eq(1);
        expect(await womDepositor.getCustomLockAccounts().then(arr => arr[0])).eq(bobAddress);

        await womDepositor.connect(daoSigner).setCustomLock(bobAddress, 7, simpleToExactAmount(100));
        expect(await womDepositor.customLockDays(bobAddress)).eq(7);
        expect(await womDepositor.getCustomLockAccounts().then(arr => arr.length)).eq(1);
        expect(await womDepositor.getCustomLockAccounts().then(arr => arr[0])).eq(bobAddress);

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
        expect(await womDepositor.checkOldSlot()).eq(3);
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
        expect(await womDepositor.checkOldSlot()).eq(0);
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
        expect(await womDepositor.checkOldSlot()).eq(0);
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
        expect(await womDepositor.checkOldSlot()).eq(0);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_WEEK);

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(5);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(5);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(prevAmountToDeposit.add(prev2xAmountToDeposit));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3))));
        expect(await womDepositor.checkOldSlot()).eq(1);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(0));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(1));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(2));
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(3));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(4));

        await increaseTime(ONE_WEEK.mul(2));

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(5);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(5);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3))));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));
        expect(await womDepositor.checkOldSlot()).eq(2);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_HOUR);

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit.mul(2), stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(6);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(6);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3))));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));
        expect(await veWom.getBreeding(voterProxy.address, 5).then(b => b.womAmount)).eq(amountToDeposit.mul(2));
        expect(await womDepositor.checkOldSlot()).eq(3);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        await increaseTime(ONE_WEEK.mul(2));

        tx = await womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit.mul(3), stakeAddress).then(r => r.wait(1));
        expect(await womDepositor.lastLockAt()).eq(await getTxTimestamp(tx));
        expect(await womDepositor.currentSlot()).eq(6);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(6);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3))));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.mul(2));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));
        expect(await veWom.getBreeding(voterProxy.address, 5).then(b => b.womAmount)).eq(amountToDeposit.mul(4).add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await womDepositor.checkOldSlot()).eq(4);
        expect(await mocks.crv.balanceOf(womDepositor.address)).eq(0);

        womBalanceBefore = await mocks.crv.balanceOf(bobAddress);
        const res = await womDepositor.connect(bob)["releaseCustomLock(uint256)"](0).then(r => r.wait(1));
        const {slot} = res.events.filter(e => e.event === 'ReleaseCustomLock')[0].args;
        expect(slot).eq(2);

        expect(await mocks.crv.balanceOf(bobAddress)).eq(womBalanceBefore.add(amountToDeposit));
        expect(await womDepositor.currentSlot()).eq(5);
        expect(await veWom.getBreedingLen(voterProxy.address)).eq(5);
        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.womAmount)).eq(amountToDeposit);
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.mul(2).add(prev2xAmountToDeposit.mul(3))));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.womAmount)).eq(amountToDeposit.mul(4).add(prevAmountToDeposit.add(prev2xAmountToDeposit.mul(2))));
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.womAmount)).eq(amountToDeposit.mul(2));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.womAmount)).eq(amountToDeposit.add(prevAmountToDeposit.add(prev2xAmountToDeposit)));

        expect(await veWom.getBreeding(voterProxy.address, 0).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(0));
        expect(await veWom.getBreeding(voterProxy.address, 1).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(1));
        expect(await veWom.getBreeding(voterProxy.address, 2).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(2));
        expect(await veWom.getBreeding(voterProxy.address, 3).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(3));
        expect(await veWom.getBreeding(voterProxy.address, 4).then(b => b.unlockTime)).eq(await womDepositor.slotEnds(4));

        expect(await womDepositor.checkOldSlot()).eq(3);
        expect(await womDepositor.slotEnds(2)).gt(await womDepositor.slotEnds(3));
    });

    it("migrate womDepositor", async () => {
        const stakeAddress = contracts.cvxCrvRewards.address;
        await womDepositor.connect(daoSigner).setLockConfig(14, 60);

        for(let i = 0; i < 13; i++) {
            await increaseTime(60);
            await womDepositor.connect(alice)["deposit(uint256,address)"](simpleToExactAmount(1), stakeAddress).then(r => r.wait(1));
        }

        expect(await voterProxy.depositor()).to.be.eq(womDepositor.address);
        expect(await contracts.cvxCrv.operator()).to.be.eq(womDepositor.address);

        const depositorMigrator = await deployContract<DepositorMigrator>(
            hre,
            new DepositorMigrator__factory(deployer),
            "DepositorMigrator",
            [womDepositor.address, [bobAddress]],
            {},
            true,
            1,
        );

        await womDepositor.connect(daoSigner).transferOwnership(depositorMigrator.address).then(tx => tx.wait(1));
        await voterProxy.connect(daoSigner).setOwner(depositorMigrator.address).then(tx => tx.wait(1));

        let tx = await depositorMigrator.migrate().then(tx => tx.wait(1));
        const migrated = tx.events.filter(e => e.event === 'Migrated')[0];
        const newWomDepositor = WomDepositorV2__factory.connect(migrated.args.newDepositor, deployer);

        expect(await newWomDepositor.getOldCustomLockAccounts().then(arr => arr.length)).to.be.eq(1);
        expect(await newWomDepositor.getOldCustomLockAccounts().then(arr => arr[0])).to.be.eq(bobAddress);
        expect(await newWomDepositor.lockDays()).to.be.eq(await womDepositor.lockDays());
        expect(await newWomDepositor.smartLockPeriod()).to.be.eq(await womDepositor.smartLockPeriod());

        expect(await voterProxy.owner()).to.be.eq(await daoSigner.getAddress());
        expect(await womDepositor.owner()).to.be.eq(await daoSigner.getAddress());
        expect(await newWomDepositor.owner()).to.be.eq(await daoSigner.getAddress());

        expect(await voterProxy.depositor()).to.be.eq(newWomDepositor.address);
        expect(await womDepositor.minter()).to.be.eq(contracts.cvxCrv.address);
        expect(await contracts.cvxCrv.operator()).to.be.eq(newWomDepositor.address);

        const amountToDeposit = simpleToExactAmount(10);
        let cvxCrvBalanceBefore = await cvxCrvRewards.balanceOf(aliceAddress);

        expect(await womDepositor.currentSlot()).eq(15);
        expect(await newWomDepositor.currentSlot()).eq(0);

        await newWomDepositor.migrate().then(tx => tx.wait(1));

        expect(await newWomDepositor.currentSlot()).eq(15);
        expect(await newWomDepositor.checkOldSlot()).eq(await womDepositor.checkOldSlot());
        expect(await newWomDepositor.lastLockAt()).eq(await womDepositor.lastLockAt());
        for(let i = 0; i < 15; i++) {
            expect(await newWomDepositor.slotEnds(i)).eq(await womDepositor.slotEnds(i));
            expect(await newWomDepositor.lockedCustomSlots(i)).eq(await womDepositor.lockedCustomSlots(i));
            expect(await newWomDepositor.releasedCustomSlots(i)).eq(await womDepositor.releasedCustomSlots(i));
        }
        expect(await newWomDepositor.customLockDays(bobAddress)).eq(await womDepositor.customLockDays(bobAddress));
        expect(await newWomDepositor.customLockMinAmount(bobAddress)).eq(await womDepositor.customLockMinAmount(bobAddress));
        let customLockLength = await newWomDepositor.getCustomLockSlotsLength(bobAddress);
        expect(customLockLength).eq(await womDepositor.getCustomLockSlotsLength(bobAddress));
        for (let i = 0; i < parseInt(customLockLength.toString()); i++) {
            const oldCustomLock = await womDepositor.customLockSlots(bobAddress, i);
            const newCustomLock = await newWomDepositor.customLockSlots(bobAddress, i);
            expect(oldCustomLock.amount).eq(newCustomLock.amount);
            expect(oldCustomLock.number).eq(newCustomLock.number);
        }

        await mocks.crv.connect(alice).approve(womDepositor.address, await mocks.crv.balanceOf(aliceAddress));
        await expect(womDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress)).to.be.revertedWith("!auth");

        await increaseTime(60);

        await mocks.crv.connect(alice).approve(newWomDepositor.address, await mocks.crv.balanceOf(aliceAddress));
        await newWomDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));

        expect(await newWomDepositor.currentSlot()).eq(16);

        expect(await cvxCrvRewards.balanceOf(aliceAddress)).eq(cvxCrvBalanceBefore.add(amountToDeposit));

        await increaseTime(ONE_WEEK.mul(2));

        await newWomDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));

        expect(await newWomDepositor.currentSlot()).eq(16);
    });

    async function getTxTimestamp(tx) {
        const lockBlock = await ethers.provider.getBlock(tx.blockNumber);
        return ethers.BigNumber.from(lockBlock.timestamp);
    }
});
