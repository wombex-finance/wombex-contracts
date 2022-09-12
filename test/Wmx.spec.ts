import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import {deploy, Phase1Deployed} from "../scripts/deploySystem";
import { deployTestFirstStage, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { Booster, VoterProxy, Wmx, WmxMinter, Wmx__factory } from "../types/generated";
import { DEAD_ADDRESS, simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";
import { impersonateAccount } from "../test-utils/fork";
import { Account } from "types";

const EMISSIONS_MAX_SUPPLY = 50000000;
const EMISSIONS_INIT_SUPPLY = 50000000;

describe("Wmx", () => {
    let accounts: Signer[];
    let distro, multisigs;
    let booster: Booster;
    let cvx: Wmx;
    let minter: WmxMinter;
    let mocks: Phase1Deployed;
    let voterProxy: VoterProxy;
    let deployer: Signer;
    let alice: Signer;
    let aliceAddress: string;
    let aliceInitialCvxBalance: BigNumberish;
    let operatorAccount: Account;

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        mocks = await deployTestFirstStage(hre, deployer);
        multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        distro = getMockDistro();

        const deployment = await deploy(hre, deployer, mocks, distro, multisigs, mocks['namingConfig'], mocks['addresses']);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        booster = deployment.booster;
        cvx = deployment.cvx;
        voterProxy = deployment.voterProxy;
        minter = deployment.minter;

        aliceInitialCvxBalance = await cvx.balanceOf(aliceAddress);
        operatorAccount = await impersonateAccount(booster.address);
    });

    it("initial configuration is correct", async () => {
        expect(await cvx.name()).to.equal(mocks['namingConfig'].cvxName);
        expect(await cvx.symbol()).to.equal(mocks['namingConfig'].cvxSymbol);
        expect(await cvx.operator()).to.equal(booster.address);
        expect(await cvx.vProxy()).to.equal(voterProxy.address);
        // Expects to be pre-mined with 50 m tokens. (as per deployment script)
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(EMISSIONS_INIT_SUPPLY));
        expect(await cvx.EMISSIONS_MAX_SUPPLY()).to.equal(simpleToExactAmount(EMISSIONS_MAX_SUPPLY));
        expect(await cvx.INIT_MINT_AMOUNT()).to.equal(simpleToExactAmount(EMISSIONS_INIT_SUPPLY));
        expect(await cvx.reductionPerCliff()).to.equal(simpleToExactAmount(EMISSIONS_MAX_SUPPLY).div(500));
    });
    describe("@method Wmx.init fails if ", async () => {
        it("caller is not the operator", async () => {
            await expect(cvx.connect(deployer).init(DEAD_ADDRESS, DEAD_ADDRESS)).to.revertedWith("Only operator");
        });
        it("called more than once", async () => {
            const operator = await impersonateAccount(await cvx.operator());
            expect(await cvx.totalSupply()).to.not.eq(0);
            await expect(cvx.connect(operator.signer).init(DEAD_ADDRESS, DEAD_ADDRESS)).to.revertedWith("Only once");
        });
        it("wrong minter address", async () => {
            const WMXToken = await new Wmx__factory(deployer).deploy(voterProxy.address, "Wmx", "WMX");
            const operator = await impersonateAccount(await WMXToken.operator());
            await expect(WMXToken.connect(operator.signer).init(DEAD_ADDRESS, ZERO_ADDRESS)).to.revertedWith(
                "Invalid minter",
            );
        });
    });

    it("@method Wmx.updateOperator fails to set new operator", async () => {
        const previousOperator = await cvx.operator();
        expect(previousOperator).eq(booster.address);
        await expect(cvx.connect(deployer).updateOperator()).to.be.revertedWith("!operator");
    });
    it("@method Wmx.updateOperator only if it is initialized", async () => {
        const WMXToken = await new Wmx__factory(deployer).deploy(voterProxy.address, "Wmx", "WMX");
        const operator = await impersonateAccount(await WMXToken.operator());
        expect(await WMXToken.totalSupply()).to.eq(0);
        await expect(WMXToken.connect(operator.signer).updateOperator()).to.be.revertedWith("!init");
    });
    it("@method Wmx.mint does not mint if sender is not the operator", async () => {
        const beforeBalance = await cvx.balanceOf(aliceAddress);
        const beforeTotalSupply = await cvx.totalSupply();
        await cvx.mint(aliceAddress, 1000);
        const afterBalance = await cvx.balanceOf(aliceAddress);
        const afterTotalSupply = await cvx.totalSupply();
        expect(beforeBalance, "balance does not change").to.eq(afterBalance);
        expect(beforeTotalSupply, "total supply does not change").to.eq(afterTotalSupply);
    });
    it("@method Wmx.minterMint fails if minter is not the caller", async () => {
        await expect(cvx.connect(alice).minterMint(aliceAddress, simpleToExactAmount(1))).to.revertedWith(
            "Only minter",
        );
    });
    it("@method Wmx.mint mints per WOM schedule ", async () => {
        let curSupply = 50e6;
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(curSupply));

        await mintAndCheckTransfer(1, 2.504);

        await mintAndCheckTransfer(4e6, 10.016e6);

        curSupply += 10.016e6 + 2.504; // 60mln
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(curSupply));

        await mintAndCheckTransfer(1, 2.004);

        await mintAndCheckTransfer(5e6, 10.02e6);

        curSupply += 2.004 + 10.02e6; // 70mln
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(curSupply));

        await mintAndCheckTransfer(1, 1.504);

        await mintAndCheckTransfer(6.66e6, 10.01664e6);

        curSupply += 1.504 + 10.01664e6; // 80mln
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(curSupply));

        await mintAndCheckTransfer(1, 1.004);

        await mintAndCheckTransfer(10e6, 10.04e6);

        curSupply += 1.004 + 10.04e6; // 90mln
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(curSupply));

        await mintAndCheckTransfer(1, 0.504);

        await mintAndCheckTransfer(20e6, 9.90735248e6);

        curSupply += 0.504 + 9.90735248e6; // 100mln
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(curSupply));

        async function mintAndCheckTransfer(mintAmount, outAmount) {
            let tx = await cvx.connect(operatorAccount.signer).mint(aliceAddress, simpleToExactAmount(mintAmount, 18));
            await expect(tx).to.emit(cvx, "Transfer").withArgs(
                ZERO_ADDRESS,
                aliceAddress,
                simpleToExactAmount(outAmount, 18), // 11.3m
            );
        }
    });
    it("@method Wmx.minterMint mints additional WMX", async () => {
        // It should mint via minter
        const amount = simpleToExactAmount(100);
        const minterAccount = await impersonateAccount(minter.address);
        const tx = await cvx.connect(minterAccount.signer).minterMint(aliceAddress, amount);
        await expect(tx).to.emit(cvx, "Transfer").withArgs(ZERO_ADDRESS, aliceAddress, amount);
    });
    it("@method Wmx.mint does not mint additional WMX", async () => {
        // it should does not to mint more tokens via scheduled mints as the max amount has been reached previously,
        const totalSupply = await cvx.totalSupply();
        await cvx.connect(operatorAccount.signer).mint(aliceAddress, simpleToExactAmount(1, 18));
        await expect(await cvx.totalSupply()).to.eq(totalSupply);
    });
});
