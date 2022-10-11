import { task, subtask } from "hardhat/config";
import { TaskArguments, RunSuperFunction, HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs-extra";
import path from "path";

const updatePathOnReport = async () => {
    const reportPath = path.resolve(__dirname, "../../coverage/lcov.info");
    const data = fs.readFileSync(reportPath, "utf8");
    fs.writeFileSync(reportPath, data, "utf8");
}

task("coverage:externalSrc")
    .addOptionalParam("testfiles", "test/**/*.ts")
    .addOptionalParam("solcoverjs", "./.solcover.js")
    .addOptionalParam('temp', "artifacts")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment, runSuper: RunSuperFunction<any>) {
        const { testfiles, solcoverjs, temp } = taskArgs;
        await hre.run("coverage", { testfiles, solcoverjs, temp });
        await updatePathOnReport();
    });
