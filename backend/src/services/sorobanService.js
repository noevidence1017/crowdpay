const {
  Contract,
  Address,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
  Keypair,
  Operation,
} = require('@stellar/stellar-sdk');
const { server, networkPassphrase } = require('../config/stellar');
const logger = require('../config/logger');
const { TX_TIMEOUT_CONTRIBUTION_S } = require('../config/constants');
const crypto = require('crypto');

async function simulateAndPrepare(tx) {
  const simulation = await server.simulateTransaction(tx);
  if (simulation.result) {
    const meta = xdr.TransactionMeta.fromXDR(simulation.result.meta, 'base64');
    const sorobanMeta = meta.v3().sorobanMeta();
    if (sorobanMeta && sorobanMeta.returnValue().type() === xdr.ScValType.scvError) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.result)}`);
    }
  }
  return server.prepareTransaction(tx);
}

async function invokeContract({ contractId, method, args, signerSecret }) {
  const signer = Keypair.fromSecret(signerSecret);
  const source = await server.loadAccount(signer.publicKey());

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT_CONTRIBUTION_S)
    .build();

  const preparedTx = await simulateAndPrepare(tx);
  preparedTx.sign(signer);
  const result = await server.submitTransaction(preparedTx);

  if (result.status === 'SUCCESS') {
    if (result.resultMetaXdr) {
      const resultMetaXdrParsed = xdr.TransactionMeta.fromXDR(result.resultMetaXdr, 'base64');
      const sorobanMeta = resultMetaXdrParsed.v3().sorobanMeta();
      if (sorobanMeta && sorobanMeta.returnValue()) {
        return scValToNative(sorobanMeta.returnValue());
      }
    }
    return null;
  }
  throw new Error(`Transaction failed: ${result.status}`);
}

async function invokeContractReadOnly({ contractId, method, args }) {
  const source = await server.loadAccount(
    Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY).publicKey()
  );

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT_CONTRIBUTION_S)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (simulation.result) {
    const meta = xdr.TransactionMeta.fromXDR(simulation.result.meta, 'base64');
    const sorobanMeta = meta.v3().sorobanMeta();
    if (sorobanMeta && sorobanMeta.returnValue()) {
      if (sorobanMeta.returnValue().type() === xdr.ScValType.scvError) {
        throw new Error(`Simulation returned error: ${JSON.stringify(simulation.result)}`);
      }
      return scValToNative(sorobanMeta.returnValue());
    }
  }
  throw new Error(`Simulation failed: ${JSON.stringify(simulation)}`);
}

async function initializeEscrow({
  contractId,
  adminAddress,
  campaignId,
  target,
  deadline,
  assetContractAddress,
  platformFeeBps,
  platformFeeRecipientAddress,
  signerSecret,
}) {
  return invokeContract({
    contractId,
    method: 'initialize',
    args: [
      nativeToScVal(Address.fromString(adminAddress), { type: 'address' }),
      nativeToScVal(campaignId, { type: 'u64' }),
      nativeToScVal(target, { type: 'i128' }),
      nativeToScVal(deadline, { type: 'u64' }),
      nativeToScVal(Address.fromString(assetContractAddress), { type: 'address' }),
      nativeToScVal(platformFeeBps, { type: 'u32' }),
      nativeToScVal(Address.fromString(platformFeeRecipientAddress), { type: 'address' }),
    ],
    signerSecret,
  });
}

async function initializeMilestones({
  contractId,
  creatorAddress,
  platformAddress,
  escrowContractId,
  milestones,
  signerSecret,
}) {
  const milestoneScVals = milestones.map((m) => {
    const titleHash = Buffer.alloc(32);
    Buffer.from(crypto.createHash('sha256').update(m.title).digest()).copy(titleHash);
    return nativeToScVal({
      title_hash: titleHash,
      release_bps: m.release_percentage_units || Math.round(parseFloat(m.release_percentage) * 100),
      status: 0,
      evidence_hash: null,
    });
  });

  return invokeContract({
    contractId,
    method: 'initialize',
    args: [
      nativeToScVal(Address.fromString(creatorAddress), { type: 'address' }),
      nativeToScVal(Address.fromString(platformAddress), { type: 'address' }),
      nativeToScVal(Address.fromString(escrowContractId), { type: 'address' }),
      nativeToScVal(milestoneScVals),
    ],
    signerSecret,
  });
}

async function depositToEscrow({ contractId, fromAddress, amount, signerSecret }) {
  return invokeContract({
    contractId,
    method: 'deposit',
    args: [
      nativeToScVal(Address.fromString(fromAddress), { type: 'address' }),
      nativeToScVal(amount, { type: 'i128' }),
    ],
    signerSecret,
  });
}

async function requestRefund({ contractId, contributorAddress, signerSecret }) {
  return invokeContract({
    contractId,
    method: 'refund',
    args: [
      nativeToScVal(Address.fromString(contributorAddress), { type: 'address' }),
    ],
    signerSecret,
  });
}

async function getEscrowTotalRaised(contractId) {
  return invokeContractReadOnly({
    contractId,
    method: 'get_total_raised',
    args: [],
  });
}

async function getEscrowAsset(contractId) {
  return invokeContractReadOnly({
    contractId,
    method: 'get_asset',
    args: [],
  });
}

async function getEscrowPlatformFeeConfig(contractId) {
  return invokeContractReadOnly({
    contractId,
    method: 'get_platform_fee_config',
    args: [],
  });
}

function encodeMilestone(m) {
  const titleHash = Buffer.alloc(32);
  Buffer.from(crypto.createHash('sha256').update(m.title).digest()).copy(titleHash);

  return nativeToScVal({
    title_hash: titleHash,
    release_bps: m.release_percentage_units ||
      Math.round(parseFloat(m.release_percentage || m.release_percentage_units || 0) * 100),
    status: 0,
    evidence_hash: null,
  });
}

async function refund(contractId, contributorPublicKey) {
  return invokeContract({
    contractId,
    method: 'refund',
    args: [nativeToScVal(Address.fromString(contributorPublicKey))],
    signerSecret: process.env.PLATFORM_SECRET_KEY,
  });
}

/**
 * Deploy escrow and milestones contracts for a new campaign.
 * Uses pre-deployed contract IDs from environment variables.
 */
async function deployCampaignContracts({
  creatorPublicKey,
  platformPublicKey,
  campaignId,
  targetAmount,
  deadlineUnix,
  assetContractAddress,
  platformFeeBps,
  milestones,
  signerSecret,
}) {
  const escrowContractId = process.env.ESCROW_CONTRACT_ID || null;
  const milestonesContractId = process.env.MILESTONES_CONTRACT_ID || null;

  if (escrowContractId) {
    await initializeEscrow({
      contractId: escrowContractId,
      adminAddress: creatorPublicKey,
      campaignId,
      target: targetAmount,
      deadline: deadlineUnix,
      assetContractAddress,
      platformFeeBps,
      platformFeeRecipientAddress: platformPublicKey,
      signerSecret,
    });
  }

  if (milestonesContractId && milestones && milestones.length) {
    await initializeMilestones({
      contractId: milestonesContractId,
      creatorAddress: creatorPublicKey,
      platformAddress: platformPublicKey,
      escrowContractId,
      milestones,
      signerSecret,
    });
  }

  return { escrowContractId, milestonesContractId };
}

module.exports = {
  invokeContract,
  invokeContractReadOnly,
  initializeEscrow,
  initializeMilestones,
  depositToEscrow,
  requestRefund,
  getEscrowTotalRaised,
  getEscrowAsset,
  getEscrowPlatformFeeConfig,
  deployCampaignContracts,
  encodeMilestone,
  nativeToScVal,
  refund,
};
