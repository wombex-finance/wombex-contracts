import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { ONE_WEEK } from "../test-utils/constants";
import { getTimestamp, increaseTime } from "../test-utils/time";
import { BN, simpleToExactAmount } from "../test-utils/math";
import {deploy, Phase2Deployed} from "../scripts/deploySystem";
import {ERC20, LpVestedEscrow, LpVestedEscrow__factory} from "../types/generated";
import {deployTestFirstStage, getMockDistro, getMockMultisigs} from "../scripts/deployMocks";

describe("LpVestedEscrow", () => {
    let accounts: Signer[];

    let contracts: Phase2Deployed, mocks;
    let wmx: ERC20;
    let lpVestedEscrow: LpVestedEscrow;

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

    let eve: Signer;
    let eveAddress: string;

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
        eve = accounts[5];
        eveAddress = await eve.getAddress();

        deployer = accounts[0];
        mocks = await deployTestFirstStage(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        contracts = await deploy(hre, deployer, deployer, mocks, distro, multisigs, mocks.namingConfig, mocks);

        await mocks.crv.transfer(aliceAddress, simpleToExactAmount(1));

        const amount = ethers.utils.parseEther("1000");
        let tx = await mocks.lptoken.transfer(aliceAddress, amount);
        await tx.wait();

        wmx = contracts.cvx.connect(deployer) as ERC20;

        deployTime = await getTimestamp();
        lpVestedEscrow = await new LpVestedEscrow__factory(deployer).deploy(
            wmx.address,
            fundAdminAddress,
            deployTime.add(ONE_WEEK),
            deployTime.add(ONE_WEEK.mul(53)),
        );
    });

    it("initial configuration is correct", async () => {
        expect(await lpVestedEscrow.rewardToken()).eq(wmx.address);
        expect(await lpVestedEscrow.admin()).eq(fundAdminAddress);
        expect(await lpVestedEscrow.funder()).eq(fundAdminAddress);
        expect(await lpVestedEscrow.startTime()).eq(deployTime.add(ONE_WEEK));
        expect(await lpVestedEscrow.endTime()).eq(deployTime.add(ONE_WEEK.mul(53)));
        expect(await lpVestedEscrow.totalTime()).eq(ONE_WEEK.mul(52));
        expect(await lpVestedEscrow.initialised()).eq(false);
    });
    it("fails to fund due to wrong array of recipients", async () => {
        await expect(lpVestedEscrow.fund([aliceAddress, bobAddress], [])).to.be.revertedWith("!arr");
    });
    it("fails to fund if it is not the funder", async () => {
        await expect(lpVestedEscrow.connect(alice).fund([], [])).to.be.revertedWith("!funder");
    });
    // Funds Alice = 200 and Bob = 100
    it("funds an array of recipients", async () => {
        const balBefore = await wmx.balanceOf(lpVestedEscrow.address);
        await wmx.transfer(fundAdminAddress, simpleToExactAmount(300));
        await wmx.connect(fundAdmin).approve(lpVestedEscrow.address, simpleToExactAmount(300));
        await lpVestedEscrow.connect(fundAdmin).fund([aliceAddress, bobAddress], [simpleToExactAmount(200), simpleToExactAmount(100)]);

        const balAfter = await wmx.balanceOf(lpVestedEscrow.address);
        expect(balAfter).eq(balBefore.add(simpleToExactAmount(300)));

        expect(await lpVestedEscrow.totalLocked(aliceAddress)).eq(simpleToExactAmount(200));
        expect(await lpVestedEscrow.available(aliceAddress)).lt(simpleToExactAmount(0.01));
        expect(await lpVestedEscrow.remaining(aliceAddress)).gt(simpleToExactAmount(199.99));
        expect(await lpVestedEscrow.totalLocked(bobAddress)).eq(simpleToExactAmount(100));
        expect(await lpVestedEscrow.available(bobAddress)).lt(simpleToExactAmount(0.01));
        expect(await lpVestedEscrow.remaining(bobAddress)).gt(simpleToExactAmount(99.99));
    });
    it("fails to fund again", async () => {
        expect(await lpVestedEscrow.initialised()).eq(true);
        await expect(lpVestedEscrow.connect(fundAdmin).fund([], [])).to.be.revertedWith("initialised already");
    });

    // fast forward 6 months, available balances should be visible
    it("vests over time", async () => {
        await increaseTime(ONE_WEEK.mul(27));

        let aliceAvailable = await lpVestedEscrow.available(aliceAddress);
        expect(aliceAvailable).gt(simpleToExactAmount(99));
        expect(aliceAvailable).lt(simpleToExactAmount(101));

        const balBefore = await wmx.balanceOf(aliceAddress);
        const tx = await lpVestedEscrow.connect(alice).claim(aliceAddress);
        const balAfter = await wmx.balanceOf(aliceAddress);

        await expect(tx).to.emit(lpVestedEscrow, "Claim").withArgs(aliceAddress, balAfter.sub(balBefore));

        expect(await lpVestedEscrow.totalClaimed(aliceAddress)).eq(balAfter.sub(balBefore));

        aliceAvailable = await lpVestedEscrow.available(aliceAddress);
        expect(aliceAvailable).lt(simpleToExactAmount(0.01));

        await lpVestedEscrow.connect(alice).claim(aliceAddress);
        const balEnd = await wmx.balanceOf(aliceAddress);
        expect(balEnd.sub(balAfter)).lt(simpleToExactAmount(0.01));
    });
    it("fails to cancel if not admin", async () => {
        await expect(lpVestedEscrow.connect(alice).cancel(bobAddress)).to.be.revertedWith("!auth");
    });
    it("allows admin to cancel stream", async () => {
        await increaseTime(ONE_WEEK.mul(4));
        const fundAdminBefore = await wmx.balanceOf(fundAdminAddress);
        const bobBefore = await wmx.balanceOf(bobAddress);

        // Bob has ~57 tokens available at this stage as 30 weeks have elapsed

        const tx = await lpVestedEscrow.connect(fundAdmin).cancel(bobAddress);
        await expect(tx).to.emit(lpVestedEscrow, "Cancelled").withArgs(bobAddress);

        const bobAfter = await wmx.balanceOf(bobAddress);
        expect(bobAfter.sub(bobBefore)).gt(simpleToExactAmount(57));
        expect(bobAfter.sub(bobBefore)).lt(simpleToExactAmount(58));
        const fundAdminAfter = await wmx.balanceOf(fundAdminAddress);
        expect(fundAdminAfter.sub(fundAdminBefore)).gt(simpleToExactAmount(42));
        expect(fundAdminAfter.sub(fundAdminBefore)).lt(simpleToExactAmount(43));

        await expect(lpVestedEscrow.connect(bob).claim(bobAddress)).to.be.revertedWith("Arithmetic operation underflowed");
        await expect(lpVestedEscrow.connect(bob).available(bobAddress)).to.be.revertedWith(
            "Arithmetic operation underflowed",
        );
        expect(await lpVestedEscrow.connect(bob).remaining(bobAddress)).eq(0);
    });
    it("fails to cancel stream if recipient has no lock", async () => {
        await expect(lpVestedEscrow.connect(fundAdmin).cancel(bobAddress)).to.be.revertedWith("!funding");
    });

    it("fails to set admin if not admin", async () => {
        await expect(lpVestedEscrow.connect(bob).setAdmin(bobAddress)).to.be.revertedWith("!auth");
    });
    it("allows admin to change admin", async () => {
        await lpVestedEscrow.connect(fundAdmin).setAdmin(bobAddress);
        expect(await lpVestedEscrow.admin()).eq(bobAddress);
    });
});
