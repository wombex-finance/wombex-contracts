import {task} from "hardhat/config";
import {TaskArguments} from "hardhat/types";
import {getSigner} from "../utils";
import {
    BribesRewardPool__factory,
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
    //https://dune.com/queries/2505458?category=canonical&chai_t6c1ea=arbitrum&addres_t6c1ea=0xC27625c523fF0403b7c43394E473A1D41729Aa05&blocknumbe_t6c1ea=0
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
    const network = process.env.NETWORK ;; hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    const deployer = await getSigner(hre);

    deployer.getFeeData = () => new Promise((resolve) => resolve({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: ethers.BigNumber.from(network === 'bnb' ? 3000000000 : 100000000),
    })) as any;

    const gaugeVoting = GaugeVoting__factory.connect(networkConfig.gaugeVoting, deployer);
    const stakingTokenAddress = await gaugeVoting.stakingToken();
    const ownerAddress = await gaugeVoting.owner();
    console.log('ownerAddress', ownerAddress);
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
    for (let i = 0; i < usersBalanceChanged.length; i++) {
        await gaugeVoting.onVotesChanged(usersBalanceChanged[i], ownerAddress).then(tx => tx.wait()).catch(e => {
            console.error('failed for address', usersBalanceChanged[i], e.message);
        });
    }
});


task("check:gauge-voting-apy").setAction(async function (taskArguments: TaskArguments, hre) {
    const network = process.env.NETWORK || hre.network.name;
    const networkConfig = JSON.parse(fs.readFileSync('./' + network + '.json', {encoding: 'utf8'}));

    const deployer = await getSigner(hre);
    const gaugeVoting = GaugeVoting__factory.connect(networkConfig.gaugeVoting, deployer);

    const fromBlockTag = 113132111; // 0xaec8657c7cca90fce0b248a0e0792ef9fe53042c6b63711092b9742dfbfaf8a3
    const toBlockTag = 113535507; // 0xa7f72c5d30fc8232d99b405fc28f01d967a7c48437ed0ae27f99ce511c22a21f
    let blocksFromStart = 0;
    function callOptions() {
        let blockTag = fromBlockTag + blocksFromStart;
        return {blockTag: blockTag > toBlockTag ? toBlockTag : blockTag}
    }
    const userWallet = '0x79a814508f32b540038f0fd20c4a849952569c8f';
                // bob                                          usdc.e
    const lps = ['0x06228b709ed3c8344ae61e64b48204174d2e48b5', '0x75eaa804518a66196946598317aed57ef86235fe'];
    const symbols = ['BOB', 'USC.e'];
    const rewardToken = '0xB0B195aEFA3650A6908f15CdaC7D92F8a5791B0B';

    let csv = 'token;+blocks;pending;balanceOf;totalSupply;rewardTime;rate;rewardPerToken\n';
    const step = Math.round((toBlockTag - fromBlockTag) / 10);
    while (fromBlockTag + blocksFromStart < toBlockTag) {
        const rewards = {}, rates = {}, balances = {}, supplies = {}, timeDiffs = {}, rewardsPerToken = {};
        for(let j = 0; j < lps.length; j++) {
            const lp = lps[j];
            const rewardsPool = BribesRewardPool__factory.connect(await gaugeVoting.lpTokenRewards(lp), deployer);
            const [pending, {rewardRate, lastUpdateTime}, balanceOf, totalSupply, lastApplicableTime, rewardPerToken] = await Promise.all([
                rewardsPool.earned(rewardToken, userWallet, callOptions()).then(toEther),
                rewardsPool.tokenRewards(rewardToken, callOptions()),
                rewardsPool.balanceOf(userWallet, callOptions()).then(toEther),
                rewardsPool.totalSupply(callOptions()).then(toEther),
                rewardsPool.lastTimeRewardApplicable(rewardToken, callOptions()).then(t => t.toString()),
                rewardsPool.rewardPerToken(rewardToken, callOptions()).then(toEther)
            ])
            rewards[j] = pending.toString();
            rates[j] = rewardRate.toString();
            supplies[j] = Math.round(totalSupply);
            balances[j] = Math.round(balanceOf);
            timeDiffs[j] = parseInt(lastApplicableTime.toString()) - parseInt(lastUpdateTime.toString());
            rewardsPerToken[j] = rewardPerToken.toString();
            csv += `${symbols[j]};${callOptions().blockTag - fromBlockTag};${rewards[j].replace('.', ',')};${balances[j]};${supplies[j]};${timeDiffs[j]};${rates[j]};${rewardsPerToken[j]}\n`;
        }
        console.log('+blocks', step, 'rewards', JSON.stringify(rewards, null, " "), 'rates', JSON.stringify(rates, null, " "), 'supplies', JSON.stringify(supplies, null, " "), 'timeDiffs', JSON.stringify(timeDiffs, null, " "));
        blocksFromStart += step;
    }

    fs.writeFileSync('./rewardsAnalytics.csv', csv, {encoding:'utf8'});

    // console.log('totalVotes', await gaugeVoting.callStatic.totalVotes({blockTag: 110535508}));
});

function toEther(wei) {
    return Math.round(parseFloat(ethers.utils.formatEther(wei)) * 1e4) / 1e4;
}
