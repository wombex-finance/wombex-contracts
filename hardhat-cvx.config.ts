import hardhatConfig from "./hardhat.config";

export default {
    ...hardhatConfig,
    defaultNetwork: "hardhat",
    gasReporter: {
        ...hardhatConfig.gasReporter,
        src: "./contracts",
    },
    paths: {
        ...hardhatConfig.paths,
        sources: "./contracts/vendor",
    },
    solidity: {
        version: "0.6.12",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
};
