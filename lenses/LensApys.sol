// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IERC20 {
    function balanceOf(address _who) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IUniswapV2Router01 {
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

interface IBooster {
    struct PoolInfo {
        address lptoken;
        address token;
        address gauge;
        address crvRewards;
        bool shutdown;
    }
    function poolInfo(uint256 _index) external view returns (PoolInfo memory);
    function poolLength() external view returns (uint256);
    function crvLockRewards() external view returns (address);
    function mintRatio() external view returns (uint256);
}

interface IWmx {
    function getFactAmounMint(uint256) external view returns (uint256);
}

interface IWomAsset {
    function pool() external view returns (address);
    function underlyingToken() external view returns (address);
}

interface IWomPool {
    function quotePotentialWithdraw(address _token, uint256 _liquidity) external view returns (uint256);
    function quotePotentialSwap(
        address fromToken,
        address toToken,
        int256 fromAmount
    ) external view returns (uint256 potentialOutcome, uint256 haircut);
}

interface IBaseRewardPool4626 {
    struct RewardState {
        address token;
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        uint256 queuedRewards;
        uint256 currentRewards;
        uint256 historicalRewards;
        bool paused;
    }
    function rewardTokensList() external view returns (address[] memory);
    function tokenRewards(address _token) external view returns (RewardState memory);
    function claimableRewards(address _account)
        external view returns (address[] memory tokens, uint256[] memory amounts);
}

contract LensApys {
    address internal constant WOM_STABLE_MAIN_POOL = 0x312Bc7eAAF93f1C60Dc5AfC115FcCDE161055fb0;
    address internal constant WOM_STABLE_SIDE_POOL = 0x0520451B19AD0bb00eD35ef391086A692CFC74B2;
    address internal constant WOM_BNB_POOL = 0x0029b7e8e9eD8001c868AA09c74A1ac6269D4183;
    address internal constant WOM_WMX_POOL = 0xeEB5a751E0F5231Fc21c7415c4A4c6764f67ce2e;
    address internal constant WOM_BNBx_POOL = 0x8df1126de13bcfef999556899F469d64021adBae;
    address internal constant WOM_INNOVATION_POOL = 0x48f6A8a0158031BaF8ce3e45344518f1e69f2A14;

    address internal constant BUSD_TOKEN = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56;
    address internal constant USDT_TOKEN = 0x55d398326f99059fF775485246999027B3197955;
    address internal constant USDC_TOKEN = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    address internal constant DAI_TOKEN = 0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3;
    address internal constant HAY_TOKEN = 0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5;
    address internal constant FRAX_TOKEN = 0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40;
    address internal constant TUSD_TOKEN = 0x14016E85a25aeb13065688cAFB43044C2ef86784;

    address internal constant WOM_TOKEN = 0xAD6742A35fB341A9Cc6ad674738Dd8da98b94Fb1;
    address internal constant WMX_TOKEN = 0xa75d9ca2a0a1D547409D82e1B06618EC284A2CeD;
    address internal constant WBNB_TOKEN = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address internal constant SD_TOKEN = 0x3BC5AC0dFdC871B365d159f728dd1B9A0B5481E8;
    address internal constant WMX_WOM_TOKEN = 0x0415023846Ff1C6016c4d9621de12b24B2402979;

    address internal constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address internal constant APE_ROUTER = 0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7;

    struct PoolValues {
        string symbol;
        uint256 pid;
        uint256 lpTokenPrice;
        uint256 lpTokenBalance;
        uint256 tvl;
        uint256 wmxApr;
        uint256 totalApr;
        address rewardPool;
        PoolValuesTokenApr[] tokenAprs;
    }

    struct PoolValuesTokenApr {
        address token;
        uint256 apr;
    }

    struct PoolRewardRate {
        address[] rewardTokens;
        uint256[] rewardRates;
    }

    function getRewardRates(
        IBooster _booster
    ) public view returns(PoolRewardRate[] memory result, uint256 mintRatio) {
        uint256 len = _booster.poolLength();

        result = new PoolRewardRate[](len);
        mintRatio = _booster.mintRatio();

        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = _booster.poolInfo(i);
            IBaseRewardPool4626 crvRewards = IBaseRewardPool4626(poolInfo.crvRewards);
            address[] memory rewardTokens = crvRewards.rewardTokensList();
            uint256[] memory rewardRates = new uint256[](rewardTokens.length);
            for (uint256 j = 0; j < rewardTokens.length; j++) {
                address token = rewardTokens[j];
                rewardRates[j] = crvRewards.tokenRewards(token).rewardRate;
            }
            result[i].rewardTokens = rewardTokens;
            result[i].rewardRates = rewardRates;
        }
    }

    function getApys1(
        IBooster _booster
    ) public view returns(PoolValues[] memory) {
        uint256 mintRatio = _booster.mintRatio();
        uint256 len = _booster.poolLength();
        PoolValues[] memory result = new PoolValues[](len);
        uint256 wmxUsdPrice = estimateInUSD(WMX_TOKEN, 1 ether);

        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = _booster.poolInfo(i);
            IBaseRewardPool4626 crvRewards = IBaseRewardPool4626(poolInfo.crvRewards);
            address pool = IWomAsset(poolInfo.lptoken).pool();

            PoolValues memory pValues;

            pValues.pid = i;
            pValues.symbol = IERC20(poolInfo.lptoken).symbol();
            pValues.rewardPool = poolInfo.crvRewards;

            // 1. Calculate Tvl
            pValues.lpTokenPrice = getLpUsdOut(pool, 1 ether);
            pValues.lpTokenBalance = IERC20(poolInfo.crvRewards).totalSupply();
            pValues.tvl = pValues.lpTokenBalance * pValues.lpTokenPrice / 1 ether;

            // 2. Calculate APYs
            if (pValues.tvl > 10) {
                _setApys(crvRewards, wmxUsdPrice, mintRatio, pValues.tvl, pValues);
            }

            result[i] = pValues;
        }

        return result;
    }

    function _setApys(IBaseRewardPool4626 crvRewards, uint256 wmxUsdPrice, uint256 mintRatio, uint256 poolTvl, PoolValues memory pValues) internal view {
        address[] memory rewardTokens = crvRewards.rewardTokensList();
        uint256 len = rewardTokens.length;
        PoolValuesTokenApr[] memory aprs = new PoolValuesTokenApr[](len);
        uint256 aprTotal;
        uint256 wmxApr;

        for (uint256 i = 0; i < len; i++) {
            address token = rewardTokens[i];
            IBaseRewardPool4626.RewardState memory rewardState = crvRewards.tokenRewards(token);

            if (token == WOM_TOKEN) {
                uint256 factAmountMint = IWmx(WMX_TOKEN).getFactAmounMint(rewardState.rewardRate * 365 days);
                uint256 wmxRate = factAmountMint;
                if (mintRatio > 0) {
                    wmxRate = factAmountMint * mintRatio / 10_000;
                }

                wmxApr = wmxRate * wmxUsdPrice * 100 / poolTvl / 1e16;
            }

            uint256 usdPrice = estimateInUSD(token, 1 ether);
            uint256 apr = rewardState.rewardRate * 365 days * usdPrice * 100 / poolTvl / 1e16;
            aprTotal += apr;

            aprs[i].token = token;
            aprs[i].apr = apr;
        }

        aprTotal += wmxApr;

        pValues.tokenAprs = aprs;
        pValues.totalApr = aprTotal;
        pValues.wmxApr = wmxApr;
    }

    function getLpUsdOut(
        address _womPool,
        uint256 _lpTokenAmountIn
    ) public view returns (uint256) {
        // 1. Assume all the tokens in (BUSD-USDC-USDT-DAI) and (BUSD-HAY) and (BUSD-FRAX-TUSD) are equal to $1.
        if (_womPool == WOM_STABLE_MAIN_POOL || _womPool == WOM_STABLE_SIDE_POOL || _womPool == WOM_INNOVATION_POOL) {
            // 2.0. Estimate amount out in USD.
            try IWomPool(_womPool).quotePotentialWithdraw(BUSD_TOKEN, _lpTokenAmountIn) returns (uint256 womOut) {
                return womOut;
            } catch {}
            return 0;
        } else if (_womPool == WOM_WMX_POOL) {
            // 2.1. Estimate amount out in WOM.
            try IWomPool(_womPool).quotePotentialWithdraw(WOM_TOKEN, _lpTokenAmountIn) returns (uint256 womOut) {
                // get WOM in BUSD out at pancake.
                address[] memory path = new address[](2);
                path[0] = WOM_TOKEN;
                path[1] = BUSD_TOKEN;
                uint256[] memory amountsOut = IUniswapV2Router01(PANCAKE_ROUTER).getAmountsOut(womOut, path);
                return amountsOut[1];
            } catch {}
            return 0;
        } else if (_womPool == WOM_BNBx_POOL) {
            // 2.1. Estimate amount out in BNB.
            try IWomPool(_womPool).quotePotentialWithdraw(WBNB_TOKEN, _lpTokenAmountIn) returns (uint256 bnbOut) {
                // get WOM in BUSD out at pancake.
                address[] memory path = new address[](2);
                path[0] = WBNB_TOKEN;
                path[1] = BUSD_TOKEN;
                uint256[] memory amountsOut = IUniswapV2Router01(PANCAKE_ROUTER).getAmountsOut(bnbOut, path);
                return amountsOut[1];
            } catch {
            }
            return 0;
        } else {
            revert("unsupported pool");
        }
    }

    function estimateInUSD(address _token, uint256 _amountIn) public view returns (uint256) {
        if (_token == BUSD_TOKEN || _token == USDT_TOKEN || _token == USDC_TOKEN || _token == DAI_TOKEN ||
            _token == HAY_TOKEN || _token == FRAX_TOKEN || _token == TUSD_TOKEN) {
            return _amountIn;
        }
        address router = PANCAKE_ROUTER;
        bool throughBnb = true;

        if (_token == SD_TOKEN) {
            router = APE_ROUTER;
            throughBnb = false;
        }
        if (_token == WOM_TOKEN) {
            throughBnb = false;
        }
        if (_token == WMX_TOKEN) {
            throughBnb = false;
        }
        if (_token == WBNB_TOKEN) {
            throughBnb = false;
        }

        address[] memory path;
        if (throughBnb) {
            path = new address[](3);
            path[0] = _token;
            path[1] = WBNB_TOKEN;
            path[2] = BUSD_TOKEN;
        } else {
            path = new address[](2);
            path[0] = _token;
            path[1] = BUSD_TOKEN;
        }
        uint256[] memory amountsOut = IUniswapV2Router01(router).getAmountsOut(_amountIn, path);
        return amountsOut[amountsOut.length - 1];
    }
}
