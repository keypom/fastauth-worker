const { KeyPair } = require("@near-js/crypto");
const { Account } = require("@near-js/accounts");
const { Near } = require("@near-js/wallet-account");
const { InMemoryKeyStore } = require("@near-js/keystores");

async function setupNear(accountId, network, sk) {
  const workerKey = KeyPair.fromString(sk);
  const WORKER = accountId;

  let keyStore = new InMemoryKeyStore();
  keyStore.setKey(network, WORKER, workerKey);

  let nearConfig = {
    networkId: network,
    keyStore: keyStore,
    nodeUrl: `https://rpc.${network}.near.org`,
    walletUrl: `https://wallet.${network}.near.org`,
    helperUrl: `https://helper.${network}.near.org`,
    explorerUrl: `https://explorer.${network}.near.org`,
  };

  let near = new Near(nearConfig);
  let workerAccount = new Account(near.connection, WORKER);
  console.log("NEAR CONFIG: ", nearConfig);
  console.log("KEYSTORE: ", keyStore);
  console.log("NEAR: ", near);
  console.log("WORKERACCOUNT: ", workerAccount);

  return workerAccount;
}

// Test function
async function testNearApi() {
  const network = "testnet"; // or 'mainnet'
  const workerAccountId = "worker.1725049501291-factory.testnet";
  const factoryAccountId = "1725049501291-factory.testnet";
  const workerSecretKey =
    "ed25519:34sLsntrZEoEDAkzqCqdaQqGrLn48MXBavPXUtHq2nGmyLXGcCApq7LXLK27Xoh58whdumSxs9WGxMwudY5m48RU";

  // Setup NEAR connection
  const workerAccount = await setupNear(
    workerAccountId,
    network,
    workerSecretKey,
  );

  console.log("Worker account: ", workerAccount);
  const response = await workerAccount.viewFunction({
    contractId: factoryAccountId,
    methodName: "get_agenda",
  });
  console.log("RESPONSE: ", response);
}

// Run the test
testNearApi().catch(console.error);
