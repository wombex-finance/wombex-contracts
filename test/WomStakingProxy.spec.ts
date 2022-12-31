import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deploy, SystemDeployed } from "../scripts/deploySystem";
import { getMockDistro, getMockMultisigs, deployTestFirstStage } from "../scripts/deployMocks";
import {
    Asset,
    Asset__factory,
    Booster,
    VoterProxy,
    VoterProxy__factory,
    WombatRouter,
    WombatRouter__factory,
    WomSwapDepositor,
    WomSwapDepositor__factory,
} from "../types/generated";
import { Signer} from "ethers";
import {increaseTime} from "../test-utils/time";
import {simpleToExactAmount} from "../test-utils/math";
import {DEAD_ADDRESS, impersonateAccount} from "../test-utils";
import {deployContract} from "../tasks/utils";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    shutdown: boolean;
};

describe.only("WomStakingProxy", () => {
    let accounts: Signer[];
    let booster: Booster;
    let crv, cvx, cvxCrv, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy, underlying;
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

        await crv.approve(crvDepositor.address, simpleToExactAmount(90000));
        await crvDepositor.deposit(simpleToExactAmount(90000), ZERO_ADDRESS);

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

        womSwapDepositor = await deployContract<WomSwapDepositor>(
            hre,
            new WomSwapDepositor__factory(deployer),
            "WomSwapDepositor",
            [crv.address, cvxCrv.address, mocks.pool.address, wombatRouter.address],
            {},
            true,
            1,
        );

        await cvxStakingProxy.connect(daoSigner).setConfig(crvDepositor.address, womSwapDepositor.address, cvxLocker.address);

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

    function getMasterWombatReward(tx, toAddress, token = null) {
        if (!token) {
            token = crv;
        }
        const logs = tx.events.filter(e => e.address.toLowerCase() === token.address.toLowerCase());
        return logs
            .map(l => {
                try { return crv.interface.decodeEventLog('Transfer', l.data, l.topics); } catch (e) {}
            })
            .filter(e => e && e.to.toLowerCase() === toAddress.toLowerCase())[0];
    }

    function getCrvEarmarkReward(tx, booster) {
        const logs = tx.events.filter(e => e.address.toLowerCase() === booster.address.toLowerCase());
        return logs
            .map(l => {
                try { return booster.interface.decodeEventLog('EarmarkRewards', l.data, l.topics); } catch (e) {}
            })
            .filter(e => e && e.rewardToken.toLowerCase() === crv.address.toLowerCase())[0];
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
                [DEAD_ADDRESS],
                [0],
                [false]
            );
            const p = await booster.poolInfo(0);
            let tx = await (await booster.connect(alice).earmarkRewards(0)).wait(1);

            const {amount} = tx.events.filter(e => e.event === 'EarmarkRewards' && e.args.rewardToken.toLowerCase() === crv.address.toLowerCase())[0].args;
            const {value} = getMasterWombatReward(tx, p.crvRewards);
            expect(amount.sub(amount.mul(await booster.earmarkIncentive()).div(10000))).eq(value);

            await increaseTime(60 * 60 * 24);

            await booster.connect(daoSigner).updateDistributionByTokens(
                crv.address,
                [cvxCrvRewards.address, cvxStakingProxy.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );
            await booster.connect(daoSigner).updateDistributionByTokens(
                mocks.weth.address,
                [cvxCrvRewards.address, cvxLocker.address, treasuryAddress],
                [2000, 400, 100],
                [true, true, false]
            );
            await booster.connect(daoSigner).setEarmarkIncentive(50);

            const tokens = [crv, mocks.weth];
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const lockerAddress = token.address === mocks.weth.address ? cvxLocker.address : veWom.address
                // bals before
                const balsBefore = await Promise.all([
                    await token.balanceOf((await booster.poolInfo(0)).crvRewards), // reward pool
                    await token.balanceOf(cvxCrvRewards.address), // cvxCrv
                    await token.balanceOf(lockerAddress), // veWom
                    await token.balanceOf(aliceAddress), // alice
                    await token.balanceOf(treasuryAddress), // platform
                ]);

                // collect the rewards
                tx = await (await booster.connect(alice).earmarkRewards(0)).wait(1);

                const {amount} = tx.events.filter(e => e.event === 'EarmarkRewards' && e.args.rewardToken.toLowerCase() === token.address.toLowerCase())[0].args;

                // bals after
                const balsAfter = await Promise.all([
                    await token.balanceOf((await booster.poolInfo(0)).crvRewards), // reward pool
                    await token.balanceOf(cvxCrvRewards.address), // cvxCrv
                    await token.balanceOf(lockerAddress), // veWom
                    await token.balanceOf(aliceAddress), // alice
                    await token.balanceOf(treasuryAddress), // platform
                ]);
                let amountChecked = '0';
                [100, 50, 400, 2000].forEach((share, index) => {
                    let shareAmount = amount.mul(share).div(10000);
                    amountChecked = shareAmount.add(amountChecked);
                    expect(balsAfter[4 - index].sub(balsBefore[4 - index])).eq(shareAmount);
                })
                expect(balsAfter[0]).eq(balsBefore[0].add(amount.sub(amountChecked)));
            }
        });
    });
});
