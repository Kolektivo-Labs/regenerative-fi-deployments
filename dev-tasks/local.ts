import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { getSigner } from '../src/signers';
import fs from 'fs';
import path from 'path';

task('setup-local', 'Sets up a minimal dev environment').setAction(async (_, hre: HardhatRuntimeEnvironment) => {
  const { run } = hre;

  const signer = await getSigner();
  const deployer = signer.address;

  await run('deploy-tokens', { amount: '2' });
  await run('deploy-amm');
});
