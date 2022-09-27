import hre, { ethers } from "hardhat";
import { expect } from "chai";
import {
    deploy,
    updateDistributionByTokens
} from "../scripts/deploySystem";
import {
    deployTestFirstStage,
    getMockDistro,
    getMockMultisigs
} from "../scripts/deployMocks";
import {
    Booster,
    VoterProxy,
    MockVoteStorage,
    MockVoteStorage__factory,
    MockERC20,
    MockERC20__factory,
    ExtraRewardsDistributor,
    WmxLocker,
    Wmx,
} from "../types/generated";
import { Signer } from "ethers";
import { hashMessage } from "@ethersproject/hash";
import { version } from "@snapshot-labs/snapshot.js/src/constants.json";
import { deployContract } from "../tasks/utils";
import { increaseTime, increaseTimeTo } from "../test-utils/time";
import { simpleToExactAmount } from "../test-utils/math";
import { ZERO_ADDRESS, ZERO } from "../test-utils/constants";
import { impersonateAccount } from "../test-utils/fork";

const eip1271MagicValue = "0x1626ba7e";

const data = {
    version,
    timestamp: (Date.now() / 1e3).toFixed(),
    space: "balancer.eth",
    type: "single-choice",
    payload: {
        proposal: "0x21ea31e896ec5b5a49a3653e51e787ee834aaf953263144ab936ed756f36609f",
        choice: 1,
        metadata: JSON.stringify({}),
    },
};

const msg = JSON.stringify(data);
const hash = hashMessage(msg);
const invalidHash = hashMessage(JSON.stringify({ ...data, version: "faux" }));

describe("VoterProxy", () => {
    let accounts: Signer[];
    let voterProxy: VoterProxy;
    let booster: Booster;
    let extraRewardsDistributor: ExtraRewardsDistributor;
    let mocks;
    let auraLocker: WmxLocker;
    let cvx: Wmx;

    let deployer: Signer;
    let deployerAddress: string;
    let daoMultisig: Signer;

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        mocks = await deployTestFirstStage(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
        daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
        const distro = getMockDistro();
        const contracts = await deploy(hre, deployer, mocks, distro, multisigs, mocks.namingConfig, mocks);

        voterProxy = contracts.voterProxy;
        booster = contracts.booster;
        extraRewardsDistributor = contracts.extraRewardsDistributor;
        auraLocker = contracts.cvxLocker;
        cvx = contracts.cvx;

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx
            .connect(operatorAccount.signer)
            .transfer(await deployer.getAddress(), simpleToExactAmount(1000));
    });

    describe("validates vote hash from Snapshot Hub", async () => {
        it("with a valid hash", async () => {
            const sig = await deployer.signMessage(msg);
            let tx = await booster.connect(daoMultisig).setVote(hash, true);
            await expect(tx).to.emit(voterProxy, "VoteSet").withArgs(hash, true);

            let isValid = await voterProxy.isValidSignature(hash, sig);
            expect(isValid).to.equal(eip1271MagicValue);

            tx = await booster.connect(daoMultisig).setVote(hash, false);
            await expect(tx).to.emit(voterProxy, "VoteSet").withArgs(hash, false);
            isValid = await voterProxy.isValidSignature(invalidHash, sig);
            expect(isValid).to.equal("0xffffffff");
        });

        it("with an invalid hash", async () => {
            const sig = await deployer.signMessage(msg);
            const tx = await booster.connect(daoMultisig).setVote(hash, true);
            await expect(tx).to.emit(voterProxy, "VoteSet").withArgs(hash, true);
            const isValid = await voterProxy.isValidSignature(invalidHash, sig);
            expect(isValid).to.equal("0xffffffff");
        });
    });

    describe("generate message hash from vote", () => {
        let mockVoteStorage: MockVoteStorage;

        before(async () => {
            mockVoteStorage = await deployContract<MockVoteStorage>(
                hre,
                new MockVoteStorage__factory(deployer),
                "MockVoteStorage",
                [],
                {},
                false,
            );
        });

        it("generates a valid hash", async () => {
            const tx = await mockVoteStorage.setProposal(
                data.payload.choice,
                data.timestamp,
                data.version,
                data.payload.proposal,
                data.space,
                data.type,
            );

            await tx.wait();
            const hashResult = await mockVoteStorage.hash(data.payload.proposal);

            expect(hash).to.equal(hashResult);
        });
    });

    describe("when not authorised", () => {
        // it("can not call release", async () => {
        //     const eoa = accounts[5];
        //     const tx = voterProxy.connect(eoa).release();
        //     await expect(tx).to.revertedWith("!auth");
        // });
        it("can not call setRewardDeposit", async () => {
            const eoa = accounts[5];
            const eoaAddress = await eoa.getAddress();
            const tx = voterProxy.connect(eoa).setRewardDeposit(await deployer.getAddress(), eoaAddress);
            await expect(tx).to.revertedWith("!auth");
        });
        it("can not call withdraw", async () => {
            const eoa = accounts[5];
            const tx = voterProxy.connect(eoa)["withdraw(address)"](ZERO_ADDRESS);
            await expect(tx).to.revertedWith("!auth");
        });
    });

    describe("setting rewardDeposit", () => {
        it("allows owner to set reward deposit and withdrawer", async () => {
            expect(await voterProxy.withdrawer()).eq(ZERO_ADDRESS);
            expect(await voterProxy.rewardDeposit()).eq(ZERO_ADDRESS);
            await voterProxy
                .connect(daoMultisig)
                .setRewardDeposit(await daoMultisig.getAddress(), extraRewardsDistributor.address);
            expect(await voterProxy.withdrawer()).eq(await daoMultisig.getAddress());
            expect(await voterProxy.rewardDeposit()).eq(extraRewardsDistributor.address);
        });
    });

    describe("when withdrawing tokens", () => {
        it("can not withdraw protected tokens", async () => {
            let tx = voterProxy.connect(daoMultisig)["withdraw(address)"](mocks.crv.address);
            await expect(tx).to.revertedWith("protected");
        });

        it("can withdraw unprotected tokens", async () => {
            const deployerAddress = await deployer.getAddress();
            const randomToken = await deployContract<MockERC20>(
                hre,
                new MockERC20__factory(deployer),
                "RandomToken",
                ["randomToken", "randomToken", 18, deployerAddress, 10000000],
                {},
                false,
            );

            const balance = await randomToken.balanceOf(deployerAddress);
            await randomToken.transfer(voterProxy.address, balance);

            const cvxAmount = simpleToExactAmount(10);

            await cvx.approve(auraLocker.address, cvxAmount);
            await auraLocker.lock(deployerAddress, cvxAmount);
            await increaseTime(86400 * 7);

            await extraRewardsDistributor.connect(daoMultisig).modifyWhitelist(voterProxy.address, true);
            await voterProxy.connect(daoMultisig)["withdraw(address)"](randomToken.address);
            const rewardDepositBalance = await randomToken.balanceOf(extraRewardsDistributor.address);
            expect(balance).eq(rewardDepositBalance);
        });
    });

    describe("when shutting down", async () => {
        it("call shutdown on the booster", async () => {
            // shutdown system on booster
            await booster.connect(daoMultisig).shutdownSystem();
            const isShutdown = await booster.isShutdown();
            expect(isShutdown).eq(true);
        });

        it("update operator and depositor to EOA", async () => {
            await voterProxy.connect(daoMultisig).setDepositor(deployerAddress);
            const depositor = await voterProxy.depositor();
            expect(depositor).eq(deployerAddress);

            await voterProxy.connect(daoMultisig).setOperator(deployerAddress);
            const operator = await voterProxy.operator();
            expect(operator).eq(deployerAddress);
        });
    });
});
