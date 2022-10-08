import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    BaseRewardPool4626__factory,
    BaseRewardPool__factory,
    Booster, MockERC20, MockERC20__factory,
    PoolDepositor,
} from "../types/generated";
import { Signer} from "ethers";

type Pool = {
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
    let poolInfo: Pool;
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

        contracts = await deploy(hre, deployer, mocks, distro, multisigs, mocks.namingConfig, mocks);

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

            tx = await poolDepositor.connect(alice).withdraw(mocks.lptoken.address, amount, 0);
            await tx.wait();

            expect(await crvRewards.balanceOf(aliceAddress)).to.equal(stakedBalanceBefore.sub(amount));
            expect(await underlying.balanceOf(aliceAddress)).to.equal(underlyingBalanceBefore.add(amount));
        });
    });
});
