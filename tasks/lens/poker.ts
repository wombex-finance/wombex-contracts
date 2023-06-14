import { task } from "hardhat/config";
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

const LENS_ADDRESS = '0xf5c285c77ac0d4668cf8749309aa3db99a138d85';
const METHOD_NAME = 'getPoolsToPoke2';

// example: hardhat lens:poker --network bsc
task("lens:poker")
    .setAction(async function (taskArgs, hre, runSuper) {
        const { user } = taskArgs;
        const LensPoker = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../out/LensPoker.sol/LensPoker.json`)).toString());
        const lens = new ethers.Contract(LENS_ADDRESS, LensPoker.abi, hre.ethers.provider);
        let data = lens.interface.encodeFunctionData(METHOD_NAME, []);

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
              code: LensPoker.deployedBytecode.object,
            },
          },
        ];

        const result = await hre.ethers.provider.send("eth_call", params);
        console.log('result', result);

        console.log(lens.interface.decodeFunctionResult(METHOD_NAME, result));
    });
