import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { getSigner } from '../src/signers';
import { bn, fp } from '@helpers/numbers';
import { ZERO_ADDRESS, ZERO_BYTES32, MAX_UINT256 } from '@helpers/constants';
import * as expectEvent from '@helpers/expectEvent';
import fs from 'fs';
import path from 'path';
import poolFactoryArgs from '../tasks/20230320-weighted-pool-v4/input';
import { WeightedPoolEncoder } from '@helpers/models/pools/weighted/encoder';
import { SwapKind } from '@helpers/models/types/types';

const deploymentsPath = path.join(__dirname, `../addresses/localhost.json`);
const tokensAddressesPath = path.join(__dirname, `../tasks/00000000-tokens/output/localhost.json`);
const tokensArtifactPath = path.join(__dirname, `./abis/TestToken.json`);
enum ContractTypes {
  TASK,
  HELPERS,
  IMPORT,
}

function getContractInfo(contractName: string, contractType: ContractTypes): { abi: any[]; address: string } {
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));

  if (contractType === ContractTypes.IMPORT) {
    const importAbiPath = path.join(__dirname, `./abis/${contractName}.json`);
    const abi = JSON.parse(fs.readFileSync(importAbiPath, 'utf-8'));
    return { abi, address: '' };
  }

  for (const deploymentId in deployments) {
    console.log(deployments[deploymentId]);
    const { status, contracts } = deployments[deploymentId];
    if (status !== 'ACTIVE') continue;
    const deploymentInfo = contracts.find((c) => {
      return c.name === contractName;
    });
    if (!deploymentInfo) continue;
    const artifactPath = path.join(__dirname, `../tasks/${deploymentId}/artifact/${contractName}.json`);

    const helpersArtifactPath = path.join(
      __dirname,
      `../src/helpers/.hardhat/artifacts/src/helpers/contracts/${contractName}.sol/${contractName}.json`
    );
    const abi = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')).abi;
    const { address } = deploymentInfo;
    return { abi, address };
  }
  return { abi: [], address: '' };
}

task('setup-local', 'Sets up a minimal dev environment').setAction(async (_, hre: HardhatRuntimeEnvironment) => {
  const { run } = hre;

  const signer = await getSigner();
  const deployer = signer.address;
  const initialBalanceBAL = hre.ethers.utils.parseEther('1000');
  const initialBalanceWETH = hre.ethers.utils.parseEther('10');
  const initialBalances = [initialBalanceBAL, initialBalanceWETH];

  console.log('>>> Deploying contracts');
  await run('deploy-tokens', { amount: '2' });
  await run('deploy-amm');
  await run('build-address-lookup');

  // Get Vault Instance
  const vaultInfo = getContractInfo('Vault', ContractTypes.TASK);
  const vaultInstance = await hre.ethers.getContractAt(vaultInfo.abi, vaultInfo.address);
  const protocolFeePercentagesInfo = getContractInfo('ProtocolFeePercentages', ContractTypes.TASK);
  const protocolFeePercentagesInstance = await hre.ethers.getContractAt(
    protocolFeePercentagesInfo.abi,
    protocolFeePercentagesInfo.address
  );

  // Get TestToken instances
  const tokensAddresses = JSON.parse(fs.readFileSync(tokensAddressesPath, 'utf-8'));
  const tokenAbi = JSON.parse(fs.readFileSync(tokensArtifactPath, 'utf-8')).abi;
  const balInstance = await hre.ethers.getContractAt(tokenAbi, tokensAddresses.BAL);
  const wethInstance = await hre.ethers.getContractAt(tokenAbi, tokensAddresses.WETH);

  // Deploy WeightedPool and get instance
  console.log('>>> Deploying Weighted Pool');
  const weightedPoolFactoryInfo = getContractInfo('WeightedPoolFactory', ContractTypes.TASK);
  const weightedPoolFactoryInstance = await hre.ethers.getContractAt(
    weightedPoolFactoryInfo.abi,
    weightedPoolFactoryInfo.address
  );
  const newWeightedPoolParams = {
    name: 'Test Pool BAL/WETH',
    symbol: 'TBD',
    tokens: [balInstance.address, wethInstance.address].sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    }),
    normalizedWeights: [fp(0.8), fp(0.2)],
    rateProviders: [ZERO_ADDRESS, ZERO_ADDRESS],
    assetManagers: [ZERO_ADDRESS, ZERO_ADDRESS],
    swapFeePercentage: bn(1e12),
  };
  const PoolVersion = { name: 'WeightedPool', version: 4, deployment: '20230320-weighted-pool-v4' };
  const weightedPoolArgs = {
    params: newWeightedPoolParams,
    vault: vaultInstance.address,
    protocolFeeProvider: protocolFeePercentagesInstance.address,
    pauseWindowDuration: undefined,
    bufferPeriodDuration: undefined,
    owner: ZERO_ADDRESS,
    version: PoolVersion,
  };
  const poolCreationReceipt = await (
    await weightedPoolFactoryInstance.create(
      weightedPoolArgs.params.name,
      weightedPoolArgs.params.symbol,
      weightedPoolArgs.params.tokens,
      weightedPoolArgs.params.normalizedWeights,
      weightedPoolArgs.params.rateProviders,
      weightedPoolArgs.params.swapFeePercentage,
      weightedPoolArgs.owner,
      ZERO_BYTES32
    )
  ).wait();
  const event = expectEvent.inReceipt(poolCreationReceipt, 'PoolCreated');
  const weightedPoolAddress = event.args.pool;
  const weightedPoolInfo = getContractInfo('WeightedPool', ContractTypes.IMPORT);
  const weightedPoolInstance = await hre.ethers.getContractAt(weightedPoolInfo.abi, weightedPoolAddress);

  // LP
  console.log('>>> Seeding pool with liquidity');
  await balInstance.mint(deployer, MAX_UINT256);
  await wethInstance.mint(deployer, MAX_UINT256);
  await balInstance.approve(vaultInstance.address, MAX_UINT256);
  await wethInstance.approve(vaultInstance.address, MAX_UINT256);
  const poolId = await weightedPoolInstance.getPoolId();
  const userData = WeightedPoolEncoder.joinInit(initialBalances);
  await vaultInstance.joinPool(poolId, deployer, deployer, {
    assets: newWeightedPoolParams.tokens,
    maxAmountsIn: initialBalances,
    fromInternalBalance: false,
    userData,
  });

  // Swap
  console.log('>>> Swapping 1 BAL for ETH');
  const amount = hre.ethers.utils.parseEther('1');
  await balInstance.approve(vaultInstance.address, amount);
  await vaultInstance.swap(
    {
      kind: SwapKind.GivenIn,
      poolId,
      assetIn: balInstance.address,
      assetOut: wethInstance.address,
      amount,
      userData: '0x',
    },
    { sender: deployer, recipient: deployer, fromInternalBalance: false, toInternalBalance: false },
    0,
    MAX_UINT256
  );
});
