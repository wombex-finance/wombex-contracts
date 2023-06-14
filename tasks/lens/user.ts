import { task } from "hardhat/config";
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

const LENS_ADDRESS = '0xf5c285c77ac0d4668cf8749309aa3db99a138d85';
// const METHOD_NAME = 'getUserBalances';
const METHOD_NAME = 'getUserBalancesDefault';
// const METHOD_NAME = 'allBoosterPoolIds';
// const METHOD_NAME = 'getUserWmxWom';
// const METHOD_NAME = 'check';

// example: hardhat lens:user --network bsc --user 0xCA31D21901CFEDEf50c5dc8C3F4efe461FF9C96C
task("lens:user")
    .addParam("user", "user address")
    .setAction(async function (taskArgs, hre, runSuper) {
        const { user } = taskArgs;
        const Lens = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../out/WombexLensUI.sol/WombexLensUI.json`)).toString());
        const lens = new ethers.Contract(LENS_ADDRESS, Lens.abi, hre.ethers.provider);
        let data = lens.interface.encodeFunctionData(METHOD_NAME, [
            '0x561050FFB188420D2605714F84EdA714DA58da69',
            ethers.utils.getIcapAddress(user)
        ]);
        // data = lens.interface.encodeFunctionData(METHOD_NAME, []);

        const params = [
          {
            from: "0x0000000000000000000000000000000000000001",
            to: LENS_ADDRESS,
            value: '0x0',
            data,
          },
          "latest",
          {
            [LENS_ADDRESS]: {
              balance: '0x0',
              code: Lens.deployedBytecode.object,
            },
          },
        ];

        console.time('request');
        const result = await hre.ethers.provider.send("eth_call", params);
        console.timeEnd('request');
        // console.log('result', result);

        console.log(lens.interface.decodeFunctionResult(METHOD_NAME, result));

    });
