import fs from 'fs';
import path from 'path';
import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

task('flat-addresses', `Prints list of active addresses to console`).setAction(
  async (args: { verbose?: boolean }, hre: HardhatRuntimeEnvironment) => {
    console.log(hre.network.name);
    const deploymentsPath = path.join(__dirname, `../../addresses/${hre.network.name}.json`);
    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
    const addresses = {};

    for (const key in deployments) {
      const deployment = deployments[key];
      const { contracts, status } = deployment;
      if (status !== 'ACTIVE') continue;
      for (let i = 0; i < contracts.length; i++) {
        const contractDeployment = contracts[i];
        const camelCasedName = contractDeployment.name.charAt(0).toLowerCase() + contractDeployment.name.slice(1);
        const { address: contractAddress } = contractDeployment;
        addresses[camelCasedName] = contractAddress;
      }
    }
    console.log(addresses);
  }
);
