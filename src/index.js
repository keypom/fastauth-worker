const { Hono } = require("hono");
const { KeyPair } = require("@near-js/crypto");
const { Account } = require("@near-js/accounts");
const { Near } = require("@near-js/wallet-account");
const { InMemoryKeyStore } = require("@near-js/keystores");
const app = new Hono();
import { cors } from "hono/cors";

// Setup CORS
const allowed_origins = ["http://localhost:3000", "http://localhost:3001"];
app.use(
  "*",
  cors({
    origin: allowed_origins,
    methods: ["GET", "POST", "HEAD"],
    allowedHeaders: ["Content-Type"],
  }),
);

// Handle alert updates
app.post("/update-alert", async (context) => {
  console.log("Starting alert update...");

  const NETWORK = context.env.NETWORK;
  const WORKER_ACCOUNT_ID = context.env.WORKER_ACCOUNT_ID;
  const FACTORY_ACCOUNT_ID = context.env.FACTORY_ACCOUNT_ID;

  let keyStore = new InMemoryKeyStore();
  const workerKey = KeyPair.fromString(context.env.WORKER_NEAR_SK);
  keyStore.setKey(NETWORK, WORKER_ACCOUNT_ID, workerKey);

  let nearConfig = {
    networkId: NETWORK,
    keyStore: keyStore,
    nodeUrl: `https://rpc.${NETWORK}.near.org`,
    walletUrl: `https://wallet.${NETWORK}.near.org`,
    helperUrl: `https://helper.${NETWORK}.near.org`,
    explorerUrl: `https://explorer.${NETWORK}.near.org`,
  };

  let near = new Near(nearConfig);
  let workerAccount = new Account(near.connection, WORKER_ACCOUNT_ID);
  console.log("NEAR CONFIG: ", nearConfig);
  console.log("KEYSTORE: ", keyStore);
  console.log("NEAR: ", near);
  console.log("WORKERACCOUNT: ", workerAccount);

  console.log("Worker account: ", workerAccount);
  const response = await workerAccount.viewFunction({
    contractId: FACTORY_ACCOUNT_ID,
    methodName: "get_agenda",
  });
  consoe.log("RESPONSE: ", response);
});

export default app;
