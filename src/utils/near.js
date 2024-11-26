import { KeyPair } from "@near-js/crypto";
import { Account } from "@near-js/accounts";
import { Near } from "@near-js/wallet-account";
import { InMemoryKeyStore } from "@near-js/keystores";

// Helper function to setup NEAR connection
export async function setupNear(env) {
  const NETWORK = env.NETWORK;
  const ORACLE_ACCOUNT_ID = env.ORACLE_ACCOUNT_ID;
  const ORACLE_ACCOUNT_PRIVATE_KEY = env.ORACLE_ACCOUNT_PRIVATE_KEY;

  console.log("Setting up NEAR with NETWORK:", NETWORK);
  console.log("ORACLE_ACCOUNT_ID:", ORACLE_ACCOUNT_ID);

  const keyStore = new InMemoryKeyStore();
  const keyPair = KeyPair.fromString(ORACLE_ACCOUNT_PRIVATE_KEY);
  keyStore.setKey(NETWORK, ORACLE_ACCOUNT_ID, keyPair);

  const nearConfig = {
    networkId: NETWORK,
    keyStore,
    nodeUrl: `https://test.rpc.fastnear.com`,
    walletUrl: `https://wallet.${NETWORK}.near.org`,
    helperUrl: `https://helper.${NETWORK}.near.org`,
    explorerUrl: `https://explorer.${NETWORK}.near.org`,
  };

  const near = new Near(nearConfig);
  const account = new Account(near.connection, ORACLE_ACCOUNT_ID);
  return { near, account };
}

export const contractCall = async ({
  near,
  account,
  contractId,
  methodName,
  args,
  gas,
  attachedDeposit,
}) => {
  const { connection } = near;
  const { provider } = connection;

  try {
    // Execute the function call
    const result = await account.functionCall({
      contractId,
      methodName,
      args,
      gas,
      attachedDeposit,
    });

    // Extract and parse the execution outcome
    const executionOutcome = parseExecutionOutcome(result);
    return executionOutcome;
  } catch (e) {
    if (/TIMEOUT_ERROR/gi.test(JSON.stringify(e))) {
      console.error(
        "Timeout error encountered. Attempting to poll transaction status...",
      );
      const transactionHash = e.context?.transactionHash;
      if (transactionHash) {
        const txStatus = await pollTransactionStatus(provider, transactionHash);
        return parseExecutionOutcome(txStatus);
      }
    }

    // Rethrow if the error is not timeout-related
    throw e;
  }
};

const parseExecutionOutcome = (result) => {
  if (!result) throw new Error("No result received for transaction");

  const { status, receipts_outcome, transaction_outcome } = result;

  // Check if the transaction was successful
  if (status.Failure) {
    throw new Error(
      `Transaction failed with error: ${JSON.stringify(status.Failure)}`,
    );
  }

  // Extract and decode the success value if available
  const successValue = status.SuccessValue
    ? Buffer.from(status.SuccessValue, "base64").toString("utf-8")
    : null;

  const logs = receipts_outcome.flatMap((receipt) => receipt.outcome.logs);
  return {
    successValue,
    transactionHash: transaction_outcome.id,
    logs,
  };
};

const pollTransactionStatus = async (provider, transactionHash) => {
  const maxRetries = 20; // Max attempts (1 minute = 20 attempts at 3 seconds each)
  const interval = 3000; // 3 seconds

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const txStatus = await provider.txStatus(transactionHash, "unused");

      if (txStatus.status && txStatus.status.SuccessValue !== undefined) {
        console.log("Transaction finalized successfully.");
        return txStatus;
      }
    } catch (err) {
      console.error("Error checking transaction status:", err);
    }

    console.log(
      `Polling attempt ${attempt + 1}/${maxRetries}. Retrying in 3 seconds...`,
    );
    await sleep(interval);
  }

  throw new Error(
    "Transaction not finalized within the maximum polling duration.",
  );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Add a helper function to extract deposit amount from the payload
export function extractDepositFromPayload(payload) {
  console.log("payload:", payload);
  if (payload?.action?.FunctionCall) {
    return BigInt(payload.action.FunctionCall.deposit || 0);
  } else if (payload?.action?.Transfer) {
    return BigInt(payload.action.Transfer.amount || 0);
  }
  return BigInt(0);
}
