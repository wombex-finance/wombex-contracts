import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    Asset, Asset__factory,
    BaseRewardPool4626__factory,
    BaseRewardPool__factory,
    Booster, MockERC20, MockERC20__factory, Pool, Pool__factory,
    PoolDepositor,
} from "../types/generated";
import { Signer, BigNumber} from "ethers";
import {deployContract, waitForTx} from "../tasks/utils";
import {ZERO_ADDRESS} from "../test-utils";

type PoolInfo = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe("PoolDepositor", () => {
    let accounts: Signer[];
    let booster: Booster, poolDepositor: PoolDepositor;
    let cvx, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy;
    let mocks: any;
    let poolInfo: PoolInfo;
    let contracts: SystemDeployed;
    let daoSigner: Signer;

    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer;
    let aliceAddress: string;
    let underlying: MockERC20;
    let treasuryAddress: string;

    const setup = async () => {
        mocks = await deployTestFirstStage(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        ({treasuryMultisig: treasuryAddress} = multisigs);
        const distro = getMockDistro();

        contracts = await deploy(hre, deployer, daoSigner, mocks, distro, multisigs, mocks.namingConfig, mocks);

        ({ cvx, booster, booster, cvxLocker, cvxStakingProxy, cvxCrvRewards, veWom, poolDepositor } = contracts);

        poolInfo = await booster.poolInfo(0);

        underlying = MockERC20__factory.connect(await mocks.lptoken.underlyingToken(), deployer);

        // transfer LP tokens to accounts
        const balance = await underlying.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await underlying.transfer(accountAddress, share);
            await tx.wait();
        }

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
    };

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
        await setup();

        await poolDepositor.approveSpendingByPool([underlying.address, mocks.weth.address, mocks.lptoken.address], mocks.pool.address);
        await poolDepositor.approveSpendingByPool([mocks.lptoken.address], booster.address);
    });

    describe("deposit", async () => {
        it("@method PoolDepositor.deposit with stake", async () => {
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, alice);
            const stakedBalanceBefore = await crvRewards.balanceOf(aliceAddress);

            const stake = true;
            const amount = ethers.utils.parseEther("1000");
            let tx = await underlying.connect(alice).approve(poolDepositor.address, amount);
            await tx.wait();

            tx = await poolDepositor.connect(alice).deposit(mocks.lptoken.address, amount, 0, stake);
            await tx.wait();

            expect(await crvRewards.balanceOf(aliceAddress)).to.equal(stakedBalanceBefore.add(amount));
        });

        it("@method PoolDepositor.deposit without stake", async () => {
            const depositToken = MockERC20__factory.connect(poolInfo.token, alice);
            const depositedBalanceBefore = await depositToken.balanceOf(aliceAddress);

            const stake = false;
            const amount = ethers.utils.parseEther("1000");
            let tx = await underlying.connect(alice).approve(poolDepositor.address, amount);
            await tx.wait();

            tx = await poolDepositor.connect(alice).deposit(mocks.lptoken.address, amount, 0, stake);
            await tx.wait();

            expect(await depositToken.balanceOf(aliceAddress)).to.equal(depositedBalanceBefore.add(amount));
        });
    });

    describe("withdraw", async () => {
        it("@method PoolDepositor.withdraw", async () => {
            const crvRewards = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, alice);
            const stakedBalanceBefore = await crvRewards.balanceOf(aliceAddress);
            const underlyingBalanceBefore = await underlying.balanceOf(aliceAddress);

            const amount = ethers.utils.parseEther("1000");
            let tx = await crvRewards.connect(alice).approve(poolDepositor.address, amount);
            await tx.wait();

            tx = await poolDepositor.connect(alice).withdraw(mocks.lptoken.address, amount, 0, aliceAddress);
            await tx.wait();

            expect(await crvRewards.balanceOf(aliceAddress)).to.equal(stakedBalanceBefore.sub(amount));
            expect(await underlying.balanceOf(aliceAddress)).to.equal(underlyingBalanceBefore.add(amount));
        });
    });

    describe("asset with native tokens", async () => {
        let nativeLptoken, nativeCrvRewards;
        before(async () => {
            const pool = await deployContract<Pool>(
                hre,
                new Pool__factory(deployer),
                "Pool",
                ['2000000000000000', '400000000000000'],
                {},
                true,
                1,
            );

            nativeLptoken = await deployContract<Asset>(
                hre,
                new Asset__factory(deployer),
                "Asset",
                [mocks.weth.address, 'MockLP', 'MockLP', pool.address],
                {},
                true,
                1,
            );
            await pool.addAsset(mocks.weth.address, nativeLptoken.address);

            let tx = await mocks.masterWombat.add('1', nativeLptoken.address, ZERO_ADDRESS);
            await waitForTx(tx, true, 1);

            const poolLen = await booster.poolLength();
            tx = await booster.connect(daoSigner).addPool(nativeLptoken.address, mocks.masterWombat.address);
            await waitForTx(tx, true, 1);
            const nativePoolInfo = await booster.poolInfo(poolLen);
            nativeCrvRewards = BaseRewardPool4626__factory.connect(nativePoolInfo.crvRewards, alice);

            await contracts.voterProxy.connect(daoSigner).setLpTokensPid(mocks.masterWombat.address);

            await poolDepositor.approveSpendingByPool([mocks.weth.address, nativeLptoken.address], pool.address);
            await poolDepositor.approveSpendingByPool([nativeLptoken.address], booster.address);
            await poolDepositor.setBoosterLpTokensPid();
        });

        it("@method PoolDepositor.depositNative with stake", async () => {
            let stakedBalanceBefore = await nativeCrvRewards.balanceOf(aliceAddress);

            const stake = true;
            const amount = ethers.utils.parseEther("1000");
            let tx = await mocks.weth.connect(alice).approve(poolDepositor.address, amount);
            await tx.wait();

            tx = await poolDepositor.connect(alice).depositNative(nativeLptoken.address, 0, stake, {
                value: amount
            });
            await tx.wait();

            expect(await nativeCrvRewards.balanceOf(aliceAddress)).to.equal(stakedBalanceBefore.add(amount));

            stakedBalanceBefore = await nativeCrvRewards.balanceOf(aliceAddress);

            tx = await nativeCrvRewards.connect(alice).approve(poolDepositor.address, amount);
            await tx.wait();

            const underlyingBalanceBefore = await alice.getBalance();
            tx = await poolDepositor.connect(alice).withdrawNative(nativeLptoken.address, amount, 0, aliceAddress);
            tx = await tx.wait();

            expect(await nativeCrvRewards.balanceOf(aliceAddress)).to.equal(stakedBalanceBefore.sub(amount));
            expect(await alice.getBalance()).to.equal(underlyingBalanceBefore.add(amount).sub(tx.cumulativeGasUsed.mul(tx.effectiveGasPrice)));
        });
    });
});
