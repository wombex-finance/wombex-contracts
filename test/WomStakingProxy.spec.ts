import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    Asset,
    Asset__factory,
    Booster,
    WombatRouter,
    WombatRouter__factory,
    WomSwapDepositor,
    WomSwapDepositor__factory,
} from "../types/generated";
import { Signer} from "ethers";
import {increaseTime} from "../test-utils/time";
import {simpleToExactAmount} from "../test-utils/math";
import {impersonateAccount, ZERO, ZERO_ADDRESS} from "../test-utils";
import {deployContract} from "../tasks/utils";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe("WomStakingProxy", () => {
    let accounts: Signer[];
    let booster: Booster;
    let crv, cvx, cvxCrv, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy, crvDepositor;
    let mocks: any;
    let pool: Pool;
    let contracts: SystemDeployed;
    let daoSigner: Signer;
    let wombatRouter: WombatRouter, womSwapDepositor: WomSwapDepositor;

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

        ({ cvx, cvxCrv, booster, booster, cvxLocker, cvxStakingProxy, cvxCrvRewards, veWom, crvDepositor } = contracts);

        pool = await booster.poolInfo(0);

        await crv.approve(crvDepositor.address, simpleToExactAmount(150000));
        await crvDepositor['deposit(uint256,address)'](simpleToExactAmount(150000), ZERO_ADDRESS);

        const wmxWomTokens = [crv, cvxCrv];
        for (let i = 0; i < wmxWomTokens.length; i++) {
            const lptoken = await deployContract<Asset>(
                hre,
                new Asset__factory(deployer),
                "Asset",
                [wmxWomTokens[i].address, 'MockLP', 'MockLP', mocks.pool.address],
                {},
                true,
                1,
            );
            await mocks.pool.addAsset(wmxWomTokens[i].address, lptoken.address);
            await wmxWomTokens[i].approve(mocks.pool.address, simpleToExactAmount(90000));
            await mocks.pool.deposit(wmxWomTokens[i].address, simpleToExactAmount(90000), '0', deployerAddress, new Date().getTime(), false);
        }

        wombatRouter = await deployContract<WombatRouter>(
            hre,
            new WombatRouter__factory(deployer),
            "WombatRouter",
            [mocks.weth.address],
            {},
            true,
            1,
        );

        await wombatRouter.approveSpendingByPool([cvxCrv.address, crv.address], mocks.pool.address);

        await cvxCrv.approve(wombatRouter.address, simpleToExactAmount(30000));
        await wombatRouter.swapExactTokensForTokens([cvxCrv.address, crv.address], [mocks.pool.address], simpleToExactAmount(30000), '0', deployerAddress, new Date().getTime());

        womSwapDepositor = await deployContract<WomSwapDepositor>(
            hre,
            new WomSwapDepositor__factory(deployer),
            "WomSwapDepositor",
            [crv.address, cvxCrv.address, mocks.pool.address, wombatRouter.address],
            {},
            true,
            1,
        );

        await cvxStakingProxy.connect(daoSigner).setConfig(crvDepositor.address, cvxLocker.address);
        await cvxStakingProxy.connect(daoSigner).setSwapConfig(womSwapDepositor.address, '4000');

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

    function getWomStakingProxyEvents(tx) {
        const logs = tx.events.filter(e => e.address.toLowerCase() === cvxStakingProxy.address.toLowerCase());
        return logs
            .map(l => { try { return cvxStakingProxy.interface.decodeEventLog('RewardsSwapped', l.data, l.topics); } catch (e) {} })
            .filter(e => e);
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

    describe("managing system revenue fees", async () => {
        before(async () => {
            const amount = ethers.utils.parseEther("10");
            let tx = await mocks.lptoken.connect(alice).approve(booster.address, amount);
            await tx.wait();

            tx = await booster.connect(alice).deposit(0, amount, true);
            await tx.wait();

            await increaseTime(60 * 60 * 24 * 6);
        });
        it("distributes the fees to the correct places", async () => {
            await increaseTime(60 * 60 * 24);

            await booster.connect(daoSigner).updateDistributionByTokens(
                crv.address,
                [cvxCrvRewards.address, cvxStakingProxy.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );

            let quotePotentialSwap = await mocks.pool.quotePotentialSwap(crv.address, cvxCrv.address, simpleToExactAmount(100));
            expect(quotePotentialSwap.potentialOutcome).to.gt(simpleToExactAmount(100));

            // bal before
            let balBefore = await crv.balanceOf(veWom.address);
            // collect the rewards
            let tx = await (await booster.connect(alice).earmarkRewards(0)).wait(1);
            let earmarkRewards = tx.events.filter(e => e.event === 'EarmarkRewards' && e.args.rewardToken.toLowerCase() === crv.address.toLowerCase())[0].args;

            expect(await cvxStakingProxy.swapShare()).to.eq('4000');
            // bals after
            let balAfter = await crv.balanceOf(veWom.address);
            let shareAmount = earmarkRewards.amount.mul(400).div(10000);
            equalWithSmallDiff(balAfter.sub(balBefore), shareAmount.mul('6000').div('10000'));

            let rewardsSwapped = getWomStakingProxyEvents(tx);
            expect(rewardsSwapped.length).to.eq(2);
            expect(rewardsSwapped[0].swapContract).to.eq(womSwapDepositor.address);
            expect(rewardsSwapped[0].swapDepositor).to.eq(true);
            equalWithSmallDiff(rewardsSwapped[0].amountIn, shareAmount.mul('4000').div('10000'));
            expect(rewardsSwapped[0].amountOut).to.gt(rewardsSwapped[0].amountIn);
            expect(rewardsSwapped[1].swapContract).to.eq(crvDepositor.address);
            expect(rewardsSwapped[1].swapDepositor).to.eq(false);
            equalWithSmallDiff(rewardsSwapped[1].amountIn, shareAmount.mul('6000').div('10000'));
            expect(rewardsSwapped[1].amountOut).to.eq(rewardsSwapped[1].amountIn);

            await crv.approve(wombatRouter.address, simpleToExactAmount(100000));
            await wombatRouter.swapExactTokensForTokens([crv.address, cvxCrv.address], [mocks.pool.address], simpleToExactAmount(100000), '0', deployerAddress, new Date().getTime());

            quotePotentialSwap = await mocks.pool.quotePotentialSwap(crv.address, cvxCrv.address, simpleToExactAmount(100));
            expect(quotePotentialSwap.potentialOutcome).to.lt(simpleToExactAmount(100));
            await increaseTime(60 * 60 * 24);

            balBefore = await crv.balanceOf(veWom.address);

            tx = await (await booster.connect(alice).earmarkRewards(0)).wait(1);
            earmarkRewards = tx.events.filter(e => e.event === 'EarmarkRewards' && e.args.rewardToken.toLowerCase() === crv.address.toLowerCase())[0].args;

            // bals after
            balAfter = await crv.balanceOf(veWom.address);
            shareAmount = earmarkRewards.amount.mul(400).div(10000);
            equalWithSmallDiff(balAfter.sub(balBefore), shareAmount);

            rewardsSwapped = getWomStakingProxyEvents(tx);
            expect(rewardsSwapped[0].swapContract).to.eq(crvDepositor.address);
            expect(rewardsSwapped[0].swapDepositor).to.eq(false);
            expect(rewardsSwapped[0].amountIn).to.eq(shareAmount);
            expect(rewardsSwapped[0].amountOut).to.eq(rewardsSwapped[0].amountIn);
        });
    });
});
