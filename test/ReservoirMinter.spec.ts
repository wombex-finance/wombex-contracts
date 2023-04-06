import hre, { ethers } from "hardhat";
import { BigNumberish, Signer, BigNumber } from "ethers";
import { expect } from "chai";
import {deploySideChain, Phase1Deployed} from "../scripts/deploySystem";
import { deployTestFirstStage, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import {
    Booster,
    VoterProxy,
    MockERC20,
    MockERC20__factory,
    IERC20, ReservoirMinter
} from "../types/generated";
import { simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";
import { impersonateAccount } from "../test-utils/fork";
import { Account } from "types";
import {deployContract} from "../tasks/utils";

const EMISSIONS_MAX_SUPPLY = 50000000;
const INIT_MINT_AMOUNT = 50000000;
const EMISSIONS_INIT_SUPPLY = '58752703517148923654981765';

describe("ReservoirMinter", () => {
    let accounts: Signer[];
    let distro, multisigs;
    let booster: Booster;
    let cvx: IERC20;
    let reservoirMinter: ReservoirMinter;
    let mocks: Phase1Deployed;
    let voterProxy: VoterProxy;
    let deployer: Signer;
    let alice: Signer;
    let aliceAddress: string;
    let daoMultisig: Signer;
    let daoMultisigAddress: string;
    let aliceInitialCvxBalance: BigNumberish;
    let operatorAccount: Account;

    before(async () => {
        await hre.network.provider.send("hardhat_reset");
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        mocks = await deployTestFirstStage(hre, deployer);
        multisigs = await getMockMultisigs(accounts[2], accounts[3], accounts[4]);
        distro = getMockDistro();

        cvx = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            "MockWOM",
            ["mockWOM", "mockBAL", 18, await deployer.getAddress(), simpleToExactAmount(INIT_MINT_AMOUNT)],
            {},
            true,
        );

        const deployment = await deploySideChain(hre, deployer, mocks, cvx, mocks.proxyFactory, multisigs, mocks['namingConfig'], mocks['addresses']);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        daoMultisig = accounts[4];
        daoMultisigAddress = await daoMultisig.getAddress();

        booster = deployment.booster;
        cvx = deployment.cvx;
        voterProxy = deployment.voterProxy;
        reservoirMinter = deployment.reservoirMinter;

        aliceInitialCvxBalance = await cvx.balanceOf(aliceAddress);
        operatorAccount = await impersonateAccount(booster.address);
    });

    it("initial configuration is correct", async () => {
        expect(await reservoirMinter.owner()).to.equal(daoMultisigAddress);
        // Expects to be pre-mined with 50 m tokens. (as per deployment script)
        expect(await reservoirMinter.totalSupply()).to.eq(EMISSIONS_INIT_SUPPLY);
        expect(await reservoirMinter.EMISSIONS_MAX_SUPPLY()).to.equal(simpleToExactAmount(EMISSIONS_MAX_SUPPLY));
        expect(await reservoirMinter.INIT_MINT_AMOUNT()).to.equal(simpleToExactAmount(INIT_MINT_AMOUNT));
        expect(await reservoirMinter.reductionPerCliff()).to.equal(simpleToExactAmount(EMISSIONS_MAX_SUPPLY).div(500));
    });

    it("@method ReservoirMinter.setMinter", async () => {
        expect(await reservoirMinter.minters(aliceAddress)).to.eq(false);
        await expect(reservoirMinter.connect(alice).setMinter(aliceAddress, true)).to.be.revertedWith("Ownable: caller is not the owner");
        expect(await reservoirMinter.minters(daoMultisigAddress)).to.eq(false);
        await reservoirMinter.connect(daoMultisig).setMinter(daoMultisigAddress, true).then(tx => tx.wait());
        expect(await reservoirMinter.minters(daoMultisigAddress)).to.eq(true);
        expect(await reservoirMinter.minters(aliceAddress)).to.eq(false);
    });
    it("@method ReservoirMinter.mint does not mint if sender is not the minter", async () => {
        await cvx.transfer(reservoirMinter.address, simpleToExactAmount(INIT_MINT_AMOUNT));

        const beforeBalance = await cvx.balanceOf(aliceAddress);
        const beforeTotalSupply = await cvx.totalSupply();
        await reservoirMinter.mint(aliceAddress, 1000);
        const afterBalance = await cvx.balanceOf(aliceAddress);
        const afterTotalSupply = await cvx.totalSupply();
        expect(beforeBalance, "balance does not change").to.eq(afterBalance);
        expect(beforeTotalSupply, "total supply does not change").to.eq(afterTotalSupply);

        expect(await cvx.balanceOf(reservoirMinter.address)).to.eq(simpleToExactAmount(INIT_MINT_AMOUNT));
    });
    it("@method ReservoirMinter.rescueTokens should allow owner to rescueTokens", async () => {
        await expect(reservoirMinter.connect(alice).rescueTokens(cvx.address, aliceAddress, simpleToExactAmount(10))).to.be.revertedWith("Ownable: caller is not the owner");
        await reservoirMinter.connect(daoMultisig).rescueTokens(cvx.address, daoMultisigAddress, simpleToExactAmount(10));

        expect(await cvx.balanceOf(daoMultisigAddress)).to.eq(simpleToExactAmount(10));
        expect(await cvx.balanceOf(reservoirMinter.address)).to.eq(simpleToExactAmount(INIT_MINT_AMOUNT - 10));
    });
    it("@method ReservoirMinter.mint mints per WOM schedule", async () => {
        let curSupply = BigNumber.from(EMISSIONS_INIT_SUPPLY);
        expect(await reservoirMinter.totalSupply()).to.eq(curSupply.toString());

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(1))).to.eq(simpleToExactAmount(2.068));
        await mintAndCheckTransfer(1, 2.068);

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(0.6138e6))).to.eq(simpleToExactAmount(1.2693384e6));
        await mintAndCheckTransfer(0.6138e6, 1.2693384e6);

        curSupply = curSupply.add(BigNumber.from(simpleToExactAmount(1269340.468).toString())); // 60mln
        console.log('1 curSupply', curSupply.toString());
        expect(await reservoirMinter.totalSupply()).to.eq(curSupply.toString());

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(1))).to.eq(simpleToExactAmount(2.004));
        await mintAndCheckTransfer(1, 2.004);

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(5e6))).to.eq(simpleToExactAmount(10.02e6));
        await mintAndCheckTransfer(5e6, 10.02e6);

        curSupply = curSupply.add(BigNumber.from(simpleToExactAmount(2.004 + 10.02e6).toString())); // 70mln
        console.log('2 curSupply', curSupply.toString());
        expect(await reservoirMinter.totalSupply()).to.eq(curSupply.toString());

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(1))).to.eq(simpleToExactAmount(1.504));
        await mintAndCheckTransfer(1, 1.504);

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(6.66e6))).to.eq(simpleToExactAmount(10.01664e6));
        await mintAndCheckTransfer(6.66e6, 10.01664e6);

        curSupply = curSupply.add(BigNumber.from(simpleToExactAmount(1.504 + 10.01664e6).toString())); // 80mln
        console.log('3 curSupply', curSupply.toString());
        expect(await reservoirMinter.totalSupply()).to.eq(curSupply.toString());

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(1))).to.eq(simpleToExactAmount(1.004));
        await mintAndCheckTransfer(1, 1.004);

        expect(await reservoirMinter.getFactAmounMint(simpleToExactAmount(10e6))).to.eq(simpleToExactAmount(10.04e6));
        await mintAndCheckTransfer(10e6, 10.04e6);

        curSupply = curSupply.add(BigNumber.from(simpleToExactAmount(1.004 + 10.04e6).toString())); // 90mln
        console.log('4 curSupply', curSupply.toString());
        expect(await reservoirMinter.totalSupply()).to.eq(curSupply.toString());

        async function mintAndCheckTransfer(mintAmount, outAmount) {
            let tx = await reservoirMinter.connect(operatorAccount.signer).mint(aliceAddress, simpleToExactAmount(mintAmount, 18)).then(tx => tx.wait());
            const mint = tx.events.filter(e => e.event === 'Mint')[0];
            const logs = tx.events.filter(e => e.address.toLowerCase() === cvx.address.toLowerCase());
            const transfer = logs
                .map(l => { try { return cvx.interface.decodeEventLog('Transfer', l.data, l.topics); } catch (e) {} })
                .filter(e => e)[0];

            expect(transfer.from).to.eq(reservoirMinter.address);
            expect(transfer.to).to.eq(aliceAddress);
            expect(transfer.value).to.eq(simpleToExactAmount(outAmount, 18));
            expect(mint.args.to).to.eq(aliceAddress);
            expect(mint.args.amount).to.eq(simpleToExactAmount(outAmount, 18));
        }
    });
    it("@method ReservoirMinter.mint does not mint additional WMX", async () => {
        // it should does not to mint more tokens via scheduled mints as the max amount has been reached previously,
        const totalSupply = await cvx.totalSupply();
        await reservoirMinter.connect(operatorAccount.signer).mint(aliceAddress, simpleToExactAmount(1, 18));
        await expect(await cvx.totalSupply()).to.eq(totalSupply);
    });
});
