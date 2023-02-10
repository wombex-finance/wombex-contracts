import { simpleToExactAmount } from "../test-utils/math";
import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import {
    deployTestFirstStage,
    getMockDistro,
    getMockMultisigs
} from "../scripts/deployMocks";
import {
    Booster,
    ERC20__factory,
    BaseRewardPool4626__factory,
    BaseRewardPool4626,
    WmxRewardPool,
    WmxRewardPool__factory,
    BaseRewardPoolLocked,
    DepositToken__factory,
    DepositToken, MockERC20, MockERC20__factory, BaseRewardPoolLocked__factory, BoosterEarmark, VoterProxy,
} from "../types/generated";
import { Signer } from "ethers";
import { ZERO_ADDRESS } from "../test-utils/constants";
import {deployContract} from "../tasks/utils";
import {getTimestamp, increaseTimeTo} from "../test-utils/time";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe("BaseRewardPoolLocked", () => {
    let accounts: Signer[];
    let voterProxy: VoterProxy, booster: Booster, boosterEarmark: BoosterEarmark;
    let mocks: any;
    let pool: Pool;
    let contracts: SystemDeployed;

    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer, bob: Signer;
    let aliceAddress: string, bobAddress: string;

    let unlockTime: number, newPoolId: string, lockedAmount: string;
    let lptoken: MockERC20, lockedRewards: BaseRewardPoolLocked;

    const setup = async () => {
        mocks = await deployTestFirstStage(hre, deployer);
        const daoSigner = accounts[6];
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        const distro = getMockDistro();

        contracts = await deploy(hre, deployer, daoSigner, mocks, distro, multisigs, mocks.namingConfig, mocks);

        ({ voterProxy, booster, boosterEarmark } = contracts);

        newPoolId = await booster.poolLength().then(t => t.toString());

        lptoken = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            "MockLP",
            ["MockLP", "MockLP", 18, deployerAddress, 10000000],
            {},
            true,
        );

        await mocks.masterWombat.add('1', lptoken.address, ZERO_ADDRESS).then(tx => tx.wait(1));

        const stakingToken = await deployContract<DepositToken>(
            hre,
            new DepositToken__factory(deployer),
            "DepositToken",
            [booster.address, lptoken.address, "", ""],
            {},
            true,
        );

        unlockTime = await getTimestamp().then(t => parseInt(t.toString()) + 60 * 60);
        lockedRewards = await deployContract<BaseRewardPoolLocked>(
            hre,
            new BaseRewardPoolLocked__factory(deployer),
            "BaseRewardPoolLocked",
            [newPoolId, stakingToken.address, mocks.crv.address, booster.address, lptoken.address, deployerAddress, unlockTime],
            {},
            true,
        );

        await boosterEarmark.connect(daoSigner).addCreatedPool(lptoken.address, mocks.masterWombat.address, stakingToken.address, lockedRewards.address).then(tx => tx.wait(1));
        await voterProxy.connect(daoSigner).setLpTokensPid(mocks.masterWombat.address);
        pool = await booster.poolInfo(newPoolId);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        bob = accounts[2];
        bobAddress = await bob.getAddress();
    };

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        await setup();
    });

    describe("lock should works correctly", () => {
        it("setLock and depositFor", async () => {
            lockedAmount = ethers.utils.parseEther("10").toString();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);

            const balanceBefore = await crvRewards.balanceOf(aliceAddress);
            const totalSupplyBefore = await crvRewards.totalSupply();

            await lptoken.approve(booster.address, lockedAmount);

            expect(await lockedRewards.lockManager()).eq(deployerAddress);
            expect(await lockedRewards.lockedBalance(aliceAddress)).eq(0);
            await lockedRewards.setLock([aliceAddress], [lockedAmount], true);
            expect(await lockedRewards.lockManager()).eq(ZERO_ADDRESS);
            expect(await lockedRewards.lockedBalance(aliceAddress)).eq(lockedAmount);

            await booster.depositFor(newPoolId, lockedAmount, true, aliceAddress).then(tx => tx.wait());

            const balanceAfter = await crvRewards.balanceOf(aliceAddress);
            const totalSupplyAfter = await crvRewards.totalSupply();

            expect(balanceAfter.sub(balanceBefore)).eq(lockedAmount);
            expect(totalSupplyAfter.sub(totalSupplyBefore)).eq(lockedAmount);
        });

        it("try to withdraw and deposit", async () => {
            await expect(
                lockedRewards
                    .connect(alice)
                    ["withdraw(uint256,address,address)"](lockedAmount, aliceAddress, aliceAddress),
            ).to.be.revertedWith("locked");
            await expect(lockedRewards.connect(alice)["withdraw(uint256,bool)"](lockedAmount, true)).to.be.revertedWith("locked");
            await expect(lockedRewards.connect(alice).withdrawAndUnwrap(lockedAmount, true)).to.be.revertedWith("locked");

            const additionalAmount = ethers.utils.parseEther("1");
            await lptoken.transfer(aliceAddress, additionalAmount).then(tx => tx.wait());
            await lptoken.connect(alice).approve(booster.address, additionalAmount);

            await booster.connect(alice).deposit(newPoolId, additionalAmount, true).then(tx => tx.wait());

            expect(await lockedRewards.balanceOf(aliceAddress)).eq(additionalAmount.add(lockedAmount));

            await lockedRewards.connect(alice)["withdraw(uint256,bool)"](additionalAmount, true).then(tx => tx.wait());

            expect(await lockedRewards.balanceOf(aliceAddress)).eq(lockedAmount);

            await expect(lockedRewards.connect(alice)["withdraw(uint256,bool)"](additionalAmount, true)).to.be.revertedWith("locked");

            await lptoken.transfer(bobAddress, additionalAmount).then(tx => tx.wait());
            await lptoken.connect(bob).approve(booster.address, additionalAmount);
            await booster.connect(bob).deposit(newPoolId, additionalAmount, true).then(tx => tx.wait());
            expect(await lockedRewards.balanceOf(bobAddress)).eq(additionalAmount);
            await lockedRewards.connect(bob)["withdrawAndUnwrap(uint256,bool)"](additionalAmount, true).then(tx => tx.wait());
            expect(await lockedRewards.balanceOf(bobAddress)).eq(0);
        });

        it("unlock after lock period", async () => {
            await increaseTimeTo(unlockTime + 1);

            await lockedRewards.connect(alice).withdrawAndUnwrap(lockedAmount, true).then(tx => tx.wait());

            expect(await lockedRewards.balanceOf(aliceAddress)).eq(0);

            const additionalAmount = ethers.utils.parseEther("1");

            await lptoken.connect(alice).approve(booster.address, additionalAmount).then(tx => tx.wait());
            await booster.connect(alice).deposit(newPoolId, additionalAmount, true).then(tx => tx.wait());
            expect(await lockedRewards.balanceOf(aliceAddress)).eq(additionalAmount);
            await lockedRewards.connect(alice)["withdraw(uint256,bool)"](additionalAmount, true).then(tx => tx.wait());
            expect(await lockedRewards.balanceOf(aliceAddress)).eq(0);

            await lptoken.connect(bob).approve(booster.address, additionalAmount).then(tx => tx.wait());
            await booster.connect(bob).deposit(newPoolId, additionalAmount, true).then(tx => tx.wait());
            expect(await lockedRewards.balanceOf(bobAddress)).eq(additionalAmount);
            await lockedRewards.connect(bob)["withdraw(uint256,bool)"](additionalAmount, true).then(tx => tx.wait());
            expect(await lockedRewards.balanceOf(bobAddress)).eq(0);
        });
    });
});
