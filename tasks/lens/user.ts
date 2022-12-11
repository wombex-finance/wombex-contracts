const { task } = require('hardhat/config');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

const LENS_ADDRESS = '0xf5c285c77ac0d4668cf8749309aa3db99a138d85';
// const METHOD_NAME = 'getUserBalances';
const METHOD_NAME = 'getUserBalancesDefault';
// const METHOD_NAME = 'check';

task("lens:user")
    .addParam("user", "user address")
    .setAction(async function (taskArgs, hre, runSuper) {
        const { user } = taskArgs;
        const LensUser = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../out/LensUser.sol/LensUser.json`)).toString());
        const lens = new ethers.Contract(LENS_ADDRESS, LensUser.abi, hre.ethers.provider);
        let data = lens.interface.encodeFunctionData(METHOD_NAME, [
            '0x9Ac0a3E8864Ea370Bf1A661444f6610dd041Ba1c',
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
              code: LensUser.deployedBytecode.object,
            },
          },
        ];

        const result = await hre.ethers.provider.send("eth_call", params);
        console.log('result', result);

        console.log(lens.interface.decodeFunctionResult(METHOD_NAME, result));

    });
