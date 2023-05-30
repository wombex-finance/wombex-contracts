import {task} from "hardhat/config";
import {TaskArguments} from "hardhat/types";
import {getSigner} from "../utils";
import {
    GaugeVoting__factory,
} from "../../types/generated";
const fs = require('fs');
const ethers = require('ethers');
const _ = require('lodash');
const pIteration = require('p-iteration');
import { QueryParameter, DuneClient } from "@cowprotocol/ts-dune-client";
const { DUNE_API_KEY } = process.env;

function getHolders(network, token, blocknumber = 0) {
    const client = new DuneClient(DUNE_API_KEY);
    const queryID = 2505458;
    const parameters = [
        QueryParameter.text("chai", network),
        QueryParameter.text("addres", token),
        QueryParameter.number("blocknumbe", blocknumber),
    ];
    return client
        .refresh(queryID, parameters)
        .then((executionResult) => executionResult.result?.rows)
        .then(list => list.map(h => '0x' + h.topic1.slice(-40)));
}

task("check:gauge-voting-balances").setAction(async function (taskArguments: TaskArguments, hre) {
    const network = process.env.NETWORK || hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(network === 'bnb' ? 3000000000 : 100000000),
    })) as any;

    const gaugeVoting = GaugeVoting__factory.connect(networkConfig.gaugeVoting, deployer);
    const stakingTokenAddress = await gaugeVoting.stakingToken();
    const holders = await getHolders(network, stakingTokenAddress);
    console.log('stakingTokenAddress', stakingTokenAddress, 'holders', holders);

    const usersBalanceChanged = [];
    let usersBalanceChangedSum = 0;
    const usersLockChanged = [];
    let usersLockChangedSum = 0;
    await pIteration.forEachSeries(_.chunk(holders, 5), async chunk => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await pIteration.forEach(chunk, async holder => {
            const [boostedUserVotes, boostedLockedVotes, userVoted] = await Promise.all([
                gaugeVoting.boostedUserVotes(holder, false).then(r => parseFloat(ethers.utils.formatEther(r))),
                gaugeVoting.boostedUserVotes(holder, true).then(r => parseFloat(ethers.utils.formatEther(r))),
                gaugeVoting.getUserVoted(holder).then(r => parseFloat(ethers.utils.formatEther(r))),
            ]);
            console.log(boostedUserVotes < userVoted, 'boostedUserVotes', Math.round(boostedUserVotes), 'userVoted', Math.round(userVoted));
            if (boostedUserVotes < userVoted) {
                usersBalanceChanged.push(holder);
                usersBalanceChangedSum += userVoted;
            }
            if (boostedLockedVotes < userVoted) {
                usersLockChanged.push(holder);
                usersLockChangedSum += userVoted;
            }
        })
    });

    console.log('usersBalanceChangedSum', usersBalanceChangedSum, 'usersBalanceChanged', usersBalanceChanged.length, usersBalanceChanged);
    // for (let i = 0; i < usersBalanceChanged.length; i++) {
    //     await gaugeVoting.onVotesChanged(usersBalanceChanged[i], deployerAddress).then(tx => tx.wait());
    // }
});
