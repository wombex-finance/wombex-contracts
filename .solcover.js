const testMnemonic = "spoon modify person desk media screen recycle large robot battle drill actual various hire smile quiz undo island zoo dwarf choice across junior act";
module.exports = {
    istanbulReporter: ["html", "lcov"],
    providerOptions: {
        mnemonic: process.env.MNEMONIC || testMnemonic,
    },
    skipFiles: ["mocks", "test", "contracts/vendor/interfaces"],
    configureYulOptimizer: true,
};
