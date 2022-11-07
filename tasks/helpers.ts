import {Asset__factory} from "../types/generated";
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
        await poolDepositor.approveSpendingByPool(pools[i].tokens, pools[i].address);
        await poolDepositor.approveSpendingByPool(pools[i].tokens, booster);
    }
}

module.exports = {
    approvePoolDepositor
};
