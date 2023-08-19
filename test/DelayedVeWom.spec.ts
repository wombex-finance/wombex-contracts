import {Signer} from "ethers";
import {
    BaseRewardPool__factory,
    Booster,
    BoosterEarmark,
    VeWom, VeWom__factory, VoterProxy,
    Wmx,
    WomDepositorV3
} from "../types/generated";
import {deploy, SystemDeployed} from "../scripts/deploySystem";
import {deployTestFirstStage, getMockDistro, getMockMultisigs} from "../scripts/deployMocks";
import hre, {ethers} from "hardhat";
import {expect} from "chai";
import {impersonateAccount, increaseTime, simpleToExactAmount} from "../test-utils";
import {deployContract} from "../tasks/utils";

const MAX_UINT = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

describe("Delayed VeWom", () => {
    let accounts: Signer[];
    let booster: Booster, boosterEarmark: BoosterEarmark, crvDepositor: WomDepositorV3;
    let crv, voterProxy: VoterProxy, cvx: Wmx, cvxLocker, cvxCrvRewards, veWom, cvxStakingProxy;
    let mocks: any;
    let pool: Pool;
    let contracts: SystemDeployed;
    let daoSigner: Signer;

    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;
    let dan: Signer;
    let danAddress: string;
    let voteDelegate: Signer;
    let voteDelegateAddress: string;
    let treasuryAddress: string;

    const setup = async () => {
        mocks = await deployTestFirstStage(hre, deployer, true, false);
        ({crv, voterProxy} = mocks);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        ({treasuryMultisig: treasuryAddress} = multisigs);
        const distro = getMockDistro();

        contracts = await deploy(hre, deployer, daoSigner, mocks, distro, multisigs, mocks.namingConfig, mocks);

        ({cvx, booster, boosterEarmark, cvxLocker, cvxStakingProxy, cvxCrvRewards, veWom, crvDepositor} = contracts);

        pool = await booster.poolInfo(0);

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
        dan = accounts[4];
        danAddress = await dan.getAddress();
    };
    async function getBoosterReward(tx, _booster, logsLength) {
        tx = await tx.wait(1);
        const logs = tx.events.filter(e => e.address.toLowerCase() === _booster.address.toLowerCase());
        expect(logs.length).eq(logsLength);
        return booster.interface.decodeEventLog('RewardClaimed', logs[0].data, logs[0].topics);
    }
    async function getTxTimestamp(tx) {
        const lockBlock = await ethers.provider.getBlock(tx.blockNumber);
        return ethers.BigNumber.from(lockBlock.timestamp);
    }

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
        await setup();

        const operatorAccount = await impersonateAccount(booster.address);
        await cvx
            .connect(operatorAccount.signer)
            .mint(aliceAddress, simpleToExactAmount(100, 18)).then(tx => tx.wait());

        const cvxAmount = simpleToExactAmount(100);
        await cvx.connect(alice).approve(cvxLocker.address, cvxAmount).then(tx => tx.wait());
        await cvxLocker.connect(alice).lock(aliceAddress, cvxAmount).then(tx => tx.wait());

        await crvDepositor.connect(daoSigner).setLockConfig(1461, MAX_UINT).then(tx => tx.wait());
    });

    describe("performing core functions", async () => {
        it("Booster and WomDepositor deposit without VeWom, then add it and use", async () => {
            expect(veWom).eq(undefined);
            const stake = true;
            const amount = ethers.utils.parseEther("1000");
            await mocks.lptoken.connect(bob).approve(booster.address, amount).then(tx => tx.wait());
            await booster.connect(bob).deposit(0, amount, stake).then(tx => tx.wait());

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, bob);
            expect(await crvRewards.balanceOf(bobAddress)).to.equal(amount);

            await increaseTime(60 * 60 * 24 * 6);
            let res = await boosterEarmark['earmarkRewards(uint256)'](0).then(tx => tx.wait());
            const earmarkAmount1 = res.events.filter(e => e.event === 'EarmarkRewardsTransfer' && e.args.distro.toLowerCase() === cvxStakingProxy.address.toLowerCase())[0].args.amount;
            await increaseTime(60 * 60 * 24 * 6);
            res = await boosterEarmark['earmarkRewards(uint256)'](0).then(tx => tx.wait());
            const earmarkAmount2 = res.events.filter(e => e.event === 'EarmarkRewardsTransfer' && e.args.distro.toLowerCase() === cvxStakingProxy.address.toLowerCase())[0].args.amount;
            await increaseTime(60 * 60 * 24 * 6);

            const cvxBalanceBefore = await cvx.balanceOf(bobAddress);
            let tx = await crvRewards["getReward(address,bool)"](bobAddress, false);
            const boosterReward = await getBoosterReward(tx, booster, 1);

            expect(await crv.balanceOf(crvDepositor.address)).eq(earmarkAmount1.add(earmarkAmount2));
            expect(boosterReward.amount).eq(boosterReward.mintAmount);
            expect(boosterReward.lock).eq(false);
            expect(await cvx.balanceOf(bobAddress)).gt(cvxBalanceBefore);

            await mocks.crv.transfer(aliceAddress, simpleToExactAmount(2000));
            const stakeAddress = contracts.cvxCrvRewards.address;
            await mocks.crv.connect(alice).approve(crvDepositor.address, await mocks.crv.balanceOf(aliceAddress));

            const amountToDeposit = simpleToExactAmount(10);
            await crvDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress).then(r => r.wait(1));

            expect(await crvDepositor.lastLockAt()).eq('0');
            expect(await crvDepositor.currentSlot()).eq('0');
            expect(await cvxCrvRewards.balanceOf(aliceAddress)).to.equal(amountToDeposit);

            expect(await crv.balanceOf(crvDepositor.address)).eq(earmarkAmount1.add(earmarkAmount2).add(amountToDeposit));

            veWom = await deployContract<VeWom>(
                hre,
                new VeWom__factory(deployer),
                "VeWom",
                [crv.address, mocks.masterWombat.address],
                {},
            );
            await mocks.masterWombat.setVeWom(veWom.address).then(tx => tx.wait());
            await voterProxy.connect(daoSigner).setVeWom(veWom.address).then(tx => tx.wait());
            await crvDepositor.connect(daoSigner).setLockConfig(1461, 2 * 60 * 60).then(tx => tx.wait());

            const depositTx = await crvDepositor.connect(alice)["deposit(uint256,address)"](amountToDeposit, stakeAddress);
            await depositTx.wait();

            expect(await crvDepositor.lastLockAt()).eq(await getTxTimestamp(depositTx));
            expect(await crvDepositor.currentSlot()).eq('1');
            expect(await cvxCrvRewards.balanceOf(aliceAddress)).to.equal(amountToDeposit.add(amountToDeposit));

            expect(await veWom.balanceOf(voterProxy.address).then(getRoundEther)).to.equal(getRoundEther(earmarkAmount1.add(earmarkAmount2).add(amountToDeposit.mul('2'))));
            expect(await crv.balanceOf(crvDepositor.address)).eq('0');
        });
    })
});

function getRoundEther(wei) {
    return Math.round(parseFloat(ethers.utils.formatEther(wei)) * 1e6) / 1e6;
}
