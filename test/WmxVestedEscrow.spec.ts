import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import {deploy, Phase2Deployed, updateDistributionByTokens} from "../scripts/deploySystem";
import {deployTestFirstStage, getMockDistro, getMockMultisigs} from "../scripts/deployMocks";
import {
    ERC20,
    WmxLocker,
    WmxVestedEscrow,
    WmxVestedEscrow__factory, WmxVestedEscrowLockOnly,
    WmxVestedEscrowLockOnly__factory
} from "../types/generated";
import { ONE_HOUR, ONE_WEEK, ZERO_ADDRESS } from "../test-utils/constants";
import { getTimestamp, increaseTime } from "../test-utils/time";
import { BN, simpleToExactAmount } from "../test-utils/math";
import { impersonateAccount } from "../test-utils/fork";

describe("WmxVestedEscrow", () => {
    let accounts: Signer[];

    let contracts: Phase2Deployed, mocks;
    let wmx: ERC20;
    let wmxLocker: WmxLocker;
    let vestedEscrow: WmxVestedEscrow;

    let deployTime: BN;

    let deployer: Signer;
    let deployerAddress: string;

    let fundAdmin: Signer;
    let fundAdminAddress: string;

    let alice: Signer;
    let aliceAddress: string;

    let bob: Signer;
    let bobAddress: string;

    let dan: Signer;
    let danAddress: string;

    before(async () => {
        await hre.network.provider.send("hardhat_reset");

        accounts = await ethers.getSigners();
        deployer = accounts[0];

        deployerAddress = await deployer.getAddress();

        fundAdmin = accounts[1];
        fundAdminAddress = await fundAdmin.getAddress();

        alice = accounts[2];
        aliceAddress = await alice.getAddress();
        bob = accounts[3];
        bobAddress = await bob.getAddress();
        dan = accounts[4];
        danAddress = await dan.getAddress();

        deployer = accounts[0];
        mocks = await deployTestFirstStage(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        contracts = await deploy(hre, deployer, mocks, distro, multisigs, mocks.namingConfig, mocks);
        await updateDistributionByTokens(accounts[0], contracts);

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
            .mint(operatorAccount.address, amount);
        await tx.wait();

        wmx = contracts.cvx.connect(deployer) as ERC20;
        wmxLocker = contracts.cvxLocker.connect(deployer);

        deployTime = await getTimestamp();
        vestedEscrow = await new WmxVestedEscrow__factory(deployer).deploy(
            wmx.address,
            fundAdminAddress,
            wmxLocker.address,
            deployTime.add(ONE_WEEK),
            deployTime.add(ONE_WEEK.mul(53)),
        );
    });

    it("initial configuration is correct", async () => {
        expect(await vestedEscrow.rewardToken()).eq(wmx.address);
        expect(await vestedEscrow.admin()).eq(fundAdminAddress);
        expect(await vestedEscrow.wmxLocker()).eq(wmxLocker.address);
        expect(await vestedEscrow.startTime()).eq(deployTime.add(ONE_WEEK));
        expect(await vestedEscrow.endTime()).eq(deployTime.add(ONE_WEEK.mul(53)));
        expect(await vestedEscrow.totalTime()).eq(ONE_WEEK.mul(52));
        expect(await vestedEscrow.initialised()).eq(false);
    });
    it("fails to fund due to wrong array of recipients", async () => {
        await expect(vestedEscrow.fund([aliceAddress, bobAddress], [])).to.be.revertedWith("!arr");
    });
    it("fails to fund if it is not the funder", async () => {
        await expect(vestedEscrow.connect(alice).fund([], [])).to.be.revertedWith("!funder");
    });
    // Funds Alice = 200 and Bob = 100
    it("funds an array of recipients", async () => {
        const balBefore = await wmx.balanceOf(vestedEscrow.address);
        await wmx.approve(vestedEscrow.address, simpleToExactAmount(300));
        await vestedEscrow.fund([aliceAddress, bobAddress], [simpleToExactAmount(200), simpleToExactAmount(100)]);

        const balAfter = await wmx.balanceOf(vestedEscrow.address);
        expect(balAfter).eq(balBefore.add(simpleToExactAmount(300)));

        expect(await vestedEscrow.totalLocked(aliceAddress)).eq(simpleToExactAmount(200));
        expect(await vestedEscrow.available(aliceAddress)).lt(simpleToExactAmount(0.01));
        expect(await vestedEscrow.remaining(aliceAddress)).gt(simpleToExactAmount(199.99));
        expect(await vestedEscrow.totalLocked(bobAddress)).eq(simpleToExactAmount(100));
        expect(await vestedEscrow.available(bobAddress)).lt(simpleToExactAmount(0.01));
        expect(await vestedEscrow.remaining(bobAddress)).gt(simpleToExactAmount(99.99));
    });
    it("fails to fund again", async () => {
        expect(await vestedEscrow.initialised()).eq(true);
        await expect(vestedEscrow.fund([], [])).to.be.revertedWith("initialised already");
    });

    // fast forward 6 months, available balances should be visible
    it("vests over time", async () => {
        await increaseTime(ONE_WEEK.mul(27));

        let aliceAvailable = await vestedEscrow.available(aliceAddress);
        expect(aliceAvailable).gt(simpleToExactAmount(99));
        expect(aliceAvailable).lt(simpleToExactAmount(101));

        const balBefore = await wmx.balanceOf(aliceAddress);
        const tx = await vestedEscrow.connect(alice).claim(false);
        const balAfter = await wmx.balanceOf(aliceAddress);

        await expect(tx).to.emit(vestedEscrow, "Claim").withArgs(aliceAddress, balAfter.sub(balBefore), false);

        expect(await vestedEscrow.totalClaimed(aliceAddress)).eq(balAfter.sub(balBefore));

        aliceAvailable = await vestedEscrow.available(aliceAddress);
        expect(aliceAvailable).lt(simpleToExactAmount(0.01));

        await vestedEscrow.connect(alice).claim(false);
        const balEnd = await wmx.balanceOf(aliceAddress);
        expect(balEnd.sub(balAfter)).lt(simpleToExactAmount(0.01));
    });
    it("fails to claim if the locker address is zero", async () => {
        await vestedEscrow.connect(fundAdmin).setLocker(ZERO_ADDRESS);
        expect(await vestedEscrow.wmxLocker()).eq(ZERO_ADDRESS);
        await expect(vestedEscrow.connect(alice).claim(true)).to.be.revertedWith("!wmxLocker");
        // return original value
        await vestedEscrow.connect(fundAdmin).setLocker(wmxLocker.address);
    });
    // fast forward 1 month, lock in wmxLocker
    it("allows claimers to lock in WmxLocker", async () => {
        await increaseTime(ONE_WEEK.mul(4));

        const aliceAvailable = await vestedEscrow.available(aliceAddress);
        expect(aliceAvailable).lt(simpleToExactAmount(16));
        expect(aliceAvailable).gt(simpleToExactAmount(15));

        const balBefore = await wmxLocker.balances(aliceAddress);
        expect(balBefore.locked).eq(0);

        const tx = await vestedEscrow.connect(alice).claim(true);
        const balAfter = await wmxLocker.balances(aliceAddress);

        await expect(tx).to.emit(vestedEscrow, "Claim").withArgs(aliceAddress, balAfter.locked, true);

        await increaseTime(ONE_HOUR);
        await vestedEscrow.connect(alice).claim(true);
    });
    it("fails to cancel if not admin", async () => {
        await expect(vestedEscrow.connect(alice).cancel(bobAddress)).to.be.revertedWith("!auth");
    });
    it("allows admin to cancel stream", async () => {
        const fundAdminBefore = await wmx.balanceOf(fundAdminAddress);
        const bobBefore = await wmx.balanceOf(bobAddress);

        // Bob has ~57 tokens available at this stage as 30 weeks have elapsed

        const tx = await vestedEscrow.connect(fundAdmin).cancel(bobAddress);
        await expect(tx).to.emit(vestedEscrow, "Cancelled").withArgs(bobAddress);

        const bobAfter = await wmx.balanceOf(bobAddress);
        expect(bobAfter.sub(bobBefore)).gt(simpleToExactAmount(57));
        expect(bobAfter.sub(bobBefore)).lt(simpleToExactAmount(58));
        const fundAdminAfter = await wmx.balanceOf(fundAdminAddress);
        expect(fundAdminAfter.sub(fundAdminBefore)).gt(simpleToExactAmount(42));
        expect(fundAdminAfter.sub(fundAdminBefore)).lt(simpleToExactAmount(43));

        await expect(vestedEscrow.connect(bob).claim(false)).to.be.revertedWith("Arithmetic operation underflowed");
        await expect(vestedEscrow.connect(bob).available(bobAddress)).to.be.revertedWith(
            "Arithmetic operation underflowed",
        );
        expect(await vestedEscrow.connect(bob).remaining(bobAddress)).eq(0);
    });
    it("fails to cancel stream if recipient has no lock", async () => {
        await expect(vestedEscrow.connect(fundAdmin).cancel(bobAddress)).to.be.revertedWith("!funding");
    });

    it("fails to set admin if not admin", async () => {
        await expect(vestedEscrow.connect(bob).setAdmin(bobAddress)).to.be.revertedWith("!auth");
    });
    it("fails to set locker if not admin", async () => {
        await expect(vestedEscrow.connect(bob).setLocker(bobAddress)).to.be.revertedWith("!auth");
    });
    it("allows admin to change admin", async () => {
        await vestedEscrow.connect(fundAdmin).setAdmin(bobAddress);
        expect(await vestedEscrow.admin()).eq(bobAddress);
    });
    it("allows admin to change locker", async () => {
        await vestedEscrow.connect(bob).setLocker(bobAddress);
        expect(await vestedEscrow.wmxLocker()).eq(bobAddress);
    });

    describe("constructor fails", async () => {
        before(async () => {
            deployTime = await getTimestamp();
        });
        it("if start date is not in the future", async () => {
            await expect(
                new WmxVestedEscrow__factory(deployer).deploy(
                    wmx.address,
                    fundAdminAddress,
                    wmxLocker.address,
                    deployTime.sub(ONE_WEEK),
                    deployTime.add(ONE_WEEK.mul(53)),
                ),
            ).to.be.revertedWith("start must be future");
        });
        it("if end date is before the start date", async () => {
            await expect(
                new WmxVestedEscrow__factory(deployer).deploy(
                    wmx.address,
                    fundAdminAddress,
                    wmxLocker.address,
                    deployTime.add(ONE_WEEK),
                    deployTime.add(ONE_WEEK),
                ),
            ).to.be.revertedWith("end must be greater");
        });
        it("if the vested period is less than 16 weeks", async () => {
            await expect(
                new WmxVestedEscrow__factory(deployer).deploy(
                    wmx.address,
                    fundAdminAddress,
                    wmxLocker.address,
                    deployTime.add(ONE_WEEK),
                    deployTime.add(ONE_WEEK.mul(15)),
                ),
            ).to.be.revertedWith("!short");
        });
    });

    describe("WmxVestedEscrowLockOnly", async () => {
        let vestedEscrowLockOnly: WmxVestedEscrowLockOnly;

        before(async () => {
            deployTime = await getTimestamp();
            vestedEscrowLockOnly = await new WmxVestedEscrowLockOnly__factory(deployer).deploy(
                wmx.address,
                wmxLocker.address,
                deployTime.add(ONE_WEEK),
                deployTime.add(ONE_WEEK.mul(53)),
            );
        });

        // Funds Alice = 200 and Bob = 100
        it("funds an array of recipients", async () => {
            const balBefore = await wmx.balanceOf(vestedEscrowLockOnly.address);
            await wmx.approve(vestedEscrowLockOnly.address, simpleToExactAmount(300));
            await vestedEscrowLockOnly.fund([aliceAddress, bobAddress], [simpleToExactAmount(200), simpleToExactAmount(100)]);

            const balAfter = await wmx.balanceOf(vestedEscrowLockOnly.address);
            expect(balAfter).eq(balBefore.add(simpleToExactAmount(300)));

            expect(await vestedEscrowLockOnly.totalLocked(aliceAddress)).eq(simpleToExactAmount(200));
            expect(await vestedEscrowLockOnly.available(aliceAddress)).lt(simpleToExactAmount(0.01));
            expect(await vestedEscrowLockOnly.remaining(aliceAddress)).gt(simpleToExactAmount(199.99));
            expect(await vestedEscrowLockOnly.totalLocked(bobAddress)).eq(simpleToExactAmount(100));
            expect(await vestedEscrowLockOnly.available(bobAddress)).lt(simpleToExactAmount(0.01));
            expect(await vestedEscrowLockOnly.remaining(bobAddress)).gt(simpleToExactAmount(99.99));
        });
        it("fails to fund again", async () => {
            expect(await vestedEscrowLockOnly.initialised()).eq(true);
            await expect(vestedEscrowLockOnly.fund([], [])).to.be.revertedWith("initialised already");
        });

        // fast forward 6 months, available balances should be visible
        it("vests over time", async () => {
            await increaseTime(ONE_WEEK.mul(27));

            let aliceAvailable = await vestedEscrowLockOnly.available(aliceAddress);
            expect(aliceAvailable).gt(simpleToExactAmount(99));
            expect(aliceAvailable).lt(simpleToExactAmount(101));

            const totalClaimedBefore = await vestedEscrowLockOnly.totalClaimed(aliceAddress);

            const balBefore = await wmx.balanceOf(aliceAddress);
            const tx = await vestedEscrowLockOnly.connect(alice).claim();
            const balAfter = await wmx.balanceOf(aliceAddress);

            expect(balBefore).eq(balAfter);

            let userLocksLen = await wmxLocker.userLocksLen(aliceAddress);
            let lastUserLock = await wmxLocker.userLocks(aliceAddress, userLocksLen.sub(1));

            await expect(tx).to.emit(vestedEscrowLockOnly, "Claim").withArgs(aliceAddress, lastUserLock.amount);

            expect((await vestedEscrowLockOnly.totalClaimed(aliceAddress)).sub(totalClaimedBefore)).eq(lastUserLock.amount);

            aliceAvailable = await vestedEscrowLockOnly.available(aliceAddress);
            expect(aliceAvailable).lt(simpleToExactAmount(0.01));

            await vestedEscrowLockOnly.connect(alice).claim();
            const balEnd = await wmx.balanceOf(aliceAddress);
            expect(balBefore).eq(balEnd);
            userLocksLen = await wmxLocker.userLocksLen(aliceAddress);
            let newUserLock = await wmxLocker.userLocks(aliceAddress, userLocksLen.sub(1));
            expect(lastUserLock.amount.sub(newUserLock.amount)).lt(simpleToExactAmount(0.01));
        });

        // fast forward 6 months, available balances should be visible
        it("transferVestedTokens", async () => {
            let tx = await vestedEscrowLockOnly.connect(bob).claim();
            await tx.wait(1);

            await increaseTime(ONE_WEEK.mul(10));

            const locked = await vestedEscrowLockOnly.totalLocked(bobAddress);
            const claimed = await vestedEscrowLockOnly.totalClaimed(bobAddress);

            const available = await vestedEscrowLockOnly.available(bobAddress);

            tx = await vestedEscrowLockOnly.connect(bob).transferVestedTokens(danAddress);

            await expect(tx).to.emit(vestedEscrowLockOnly, "TransferVestedToken").withArgs(bobAddress, danAddress, locked, claimed);

            expect(await vestedEscrowLockOnly.totalLocked(bobAddress)).eq(0);
            expect(await vestedEscrowLockOnly.totalClaimed(bobAddress)).eq(0);

            expect(await vestedEscrowLockOnly.totalLocked(bobAddress)).not.eq(locked);
            expect(await vestedEscrowLockOnly.totalClaimed(bobAddress)).not.eq(claimed);

            expect(await vestedEscrowLockOnly.totalLocked(danAddress)).eq(locked);
            expect(await vestedEscrowLockOnly.totalClaimed(danAddress)).eq(claimed);

            expect(await vestedEscrowLockOnly.available(bobAddress)).eq(0);

            expect(await vestedEscrowLockOnly.available(danAddress)).gt(available);
            expect(await vestedEscrowLockOnly.available(danAddress)).lt(available.add(simpleToExactAmount(0.01)));

            tx = await vestedEscrowLockOnly.connect(dan).claim();
            await tx.wait(1);

            expect(await vestedEscrowLockOnly.available(danAddress)).eq(0);

            const claimedByDan = await wmxLocker.userLocks(aliceAddress,0).then(r => r.amount);
            expect(claimedByDan).lt(available);

            await increaseTime(ONE_WEEK.mul(20));

            tx = await vestedEscrowLockOnly.connect(dan).claim();
            await tx.wait(1);

            const bobLockedBalance = await wmxLocker.lockedBalances(bobAddress);
            const danLockedBalance = await wmxLocker.lockedBalances(danAddress);
            expect(
                bobLockedBalance.locked.add(bobLockedBalance.unlockable)
                    .add(danLockedBalance.locked.add(danLockedBalance.unlockable))
            ).eq(simpleToExactAmount(100));

            expect(await vestedEscrowLockOnly.available(danAddress)).eq(0);
            expect(await vestedEscrowLockOnly.available(bobAddress)).eq(0);

            await increaseTime(ONE_WEEK.mul(20));

            expect(await vestedEscrowLockOnly.available(danAddress)).eq(0);
            expect(await vestedEscrowLockOnly.available(bobAddress)).eq(0);
        });
    });
});
