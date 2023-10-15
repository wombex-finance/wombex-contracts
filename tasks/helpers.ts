import {Asset__factory, Booster, BoosterEarmark, IERC20__factory} from "../types/generated";
const _ = require('lodash');

async function approvePoolDepositor(masterWombat, poolDepositor, signer) {
    const tokensByPool = {};
    const poolLength = await masterWombat.poolLength().then(l => parseInt(l.toString()));
    for (let i = 0; i < poolLength; i++) {
        const {lpToken} = await masterWombat.poolInfo(i);
        const asset = Asset__factory.connect(lpToken, signer);
        const [pool, underlying] = await Promise.all([
            asset.pool(),
            asset.underlyingToken(),
        ]);
        if (!tokensByPool[pool]) {
            tokensByPool[pool] = [];
        }
        const lpContract = IERC20__factory.connect(lpToken, masterWombat.provider);
        const allowance = await lpContract.allowance(poolDepositor.address, pool).then(r => r.toString());

        if (allowance === '0') {
            tokensByPool[pool] = tokensByPool[pool].concat([underlying, lpToken]);
        }
    }

    const pools = []
    _.forEach(tokensByPool, (tokens, pool) => {
        pools.push({
            address: pool,
            tokens: _.uniq(tokens)
        })
    })

    const booster = await poolDepositor.booster();

    for (let i = 0; i < pools.length; i++) {
        if (!pools[i].tokens.length) {
            continue;
        }
        await poolDepositor.approveSpendingByPoolAndBooster(pools[i].tokens, pools[i].address, booster).then(tx => tx.wait());
    }
}

async function getBoosterValues(booster: Booster, boosterEarmark: BoosterEarmark) {
    console.log('booster.poolLength()');
    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    for (let i = 0; i < poolLength; i++) {
        const pool = await booster.poolInfo(i);
        if (pool.shutdown) {
            continue;
        }
        console.log('boosterEarmark.earmarkRewards(i)', boosterEarmark.address);
        await boosterEarmark['earmarkRewards(uint256)'](i).then(tx => tx.wait(1)).catch(() => null);
        const lp = IERC20__factory.connect(pool.lptoken, booster.provider);
        console.log('lp.balanceOf');
        await lp.balanceOf(booster.address);
    }
    console.log('booster.voterProxy()');
    await booster.voterProxy();
    console.log('booster.crvLockRewards()');
    await booster.crvLockRewards();
    console.log('boosterEarmark.distributionTokenList()');
    const distroTokens = await boosterEarmark.distributionTokenList();
    for (let i = 0; i < distroTokens.length; i++) {
        console.log('boosterEarmark.distributionByTokenLength(');
        const len = await boosterEarmark.distributionByTokenLength(distroTokens[i]).then(l => parseInt(l.toString()));
        for(let j = 0; j < len; j++) {
            console.log('boosterEarmark.distributionByTokens');
            await boosterEarmark.distributionByTokens(distroTokens[i], j);
        }
    }
}


module.exports = {
    approvePoolDepositor,
    getBoosterValues
};
