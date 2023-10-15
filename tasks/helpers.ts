import {Booster, Booster__factory, BoosterEarmark, IERC20__factory} from "../types/generated";

async function approvePoolDepositor(poolDepositor, signer) {
    const booster = Booster__factory.connect(await poolDepositor.booster(), signer);
    const poolLength = await booster.poolLength().then(l => parseInt(l.toString()));
    await poolDepositor.approveSpendingMultiplePools(Array.from(Array(poolLength).keys())).then(tx => tx.wait());
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
