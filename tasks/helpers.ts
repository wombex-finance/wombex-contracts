import {Asset__factory, Booster, IERC20__factory} from "../types/generated";
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
        tokensByPool[pool] =  tokensByPool[pool].concat([underlying, lpToken]);
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
        await new Promise((resolve) => setTimeout(resolve, 30e3))
        await poolDepositor.approveSpendingByPool(pools[i].tokens, pools[i].address);
        await new Promise((resolve) => setTimeout(resolve, 30e3))
        await poolDepositor.approveSpendingByPool(pools[i].tokens, booster);
    }
}

async function getBoosterValues(booster: Booster) {
    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    for (let i = 0; i < poolLength; i++) {
        await booster.earmarkRewards(i).then(tx => tx.wait(1));
        const pool = await booster.poolInfo(i);
        const lp = IERC20__factory.connect(pool.lptoken, booster.provider);
        await lp.balanceOf(booster.address);
    }
    await booster.voterProxy();
    await booster.crvLockRewards();
    const distroTokens = await booster.distributionTokenList();
    for (let i = 0; i < distroTokens.length; i++) {
        const len = await booster.distributionByTokenLength(distroTokens[i]).then(l => parseInt(l.toString()));
        for(let j = 0; j < len; j++) {
            await booster.distributionByTokens(distroTokens[i], j);
        }
    }
}


module.exports = {
    approvePoolDepositor,
    getBoosterValues
};
