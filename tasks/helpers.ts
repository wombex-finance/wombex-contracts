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
        await new Promise((resolve) => setTimeout(resolve, 30e3))
        await poolDepositor.approveSpendingByPool(pools[i].tokens, pools[i].address);
        await new Promise((resolve) => setTimeout(resolve, 30e3))
        await poolDepositor.approveSpendingByPool(pools[i].tokens, booster);
    }
}

async function getBoosterValues(booster: Booster, boosterEarmark: BoosterEarmark) {
    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    for (let i = 0; i < poolLength; i++) {
        const pool = await booster.poolInfo(i);
        if (pool.shutdown) {
            continue;
        }
        await boosterEarmark.earmarkRewards(i).then(tx => tx.wait(1));
        const lp = IERC20__factory.connect(pool.lptoken, booster.provider);
        await lp.balanceOf(booster.address);
    }
    await booster.voterProxy();
    await booster.crvLockRewards();
    const distroTokens = await boosterEarmark.distributionTokenList();
    for (let i = 0; i < distroTokens.length; i++) {
        const len = await boosterEarmark.distributionByTokenLength(distroTokens[i]).then(l => parseInt(l.toString()));
        for(let j = 0; j < len; j++) {
            await boosterEarmark.distributionByTokens(distroTokens[i], j);
        }
    }
}


module.exports = {
    approvePoolDepositor,
    getBoosterValues
};
