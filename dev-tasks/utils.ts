import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import fs from 'fs';
import path from 'path';
import { TOKEN_DIR } from './constants';

task('deploy-tokens', 'deploys specified amount of test tokens')
  .addParam('amount', 'amount of token contracts to be deplyoed')
  .setAction(async (args: { amount: number }, hre: HardhatRuntimeEnvironment) => {
    const { amount } = args;
    // await run('compile');
    const testTokenFactory = await hre.ethers.getContractFactory('TestToken');
    const addresses = [];
    for (let i = 0; i < amount; i++) {
      const testTokenInstance = await testTokenFactory.deploy(`Test Token ${i}`, `TT${i}`, 18);
      addresses.push(testTokenInstance.address);
      console.log(`Deployed TestToken${i} to: ${testTokenInstance.address}`);
    }
    const mainTokens = {
      BAL: addresses[0],
      WETH: addresses[1],
    };
    const filePath = path.join(TOKEN_DIR, 'localhost.json');
    fs.writeFileSync(filePath, JSON.stringify(mainTokens, null, 2));
  });

task('deploy-amm', 'deploys components of AMM core contracts').setAction(
  async (args: { amount: number }, hre: HardhatRuntimeEnvironment) => {
    const { run } = hre;
    await run('deploy', { id: '20210418-authorizer', force: true });
    await run('deploy', { id: '20210418-vault', force: true });
    await run('deploy', { id: '20220725-protocol-fee-percentages-provider', force: true });
    await run('deploy', { id: '20230320-weighted-pool-v4', force: true });
  }
);
