const { Hono } = require("hono");
const { KeyPair } = require("@near-js/crypto");
const { Account } = require("@near-js/accounts");
const { Near } = require("@near-js/wallet-account");
const { InMemoryKeyStore } = require("@near-js/keystores");
const {
  getAgendaFromAirtable,
  updateAgendaInAirtable,
  getAlertsFromAirtable,
  updateAlertsInAirtable,
} = require("./airtableUtils");
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

// Helper function to setup NEAR connection
async function setupNear(context) {
  const NETWORK = context.env.NETWORK;
  const WORKER_ACCOUNT_ID = context.env.WORKER_ACCOUNT_ID;
  const workerKey = KeyPair.fromString(context.env.WORKER_NEAR_SK);

  let keyStore = new InMemoryKeyStore();
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
  return new Account(near.connection, WORKER_ACCOUNT_ID);
}

// Handle agenda updates
app.post("/update-agenda", async (context) => {
  try {
    const workerAccount = await setupNear(context);
    const factoryAccountId = context.env.FACTORY_ACCOUNT_ID;

    // Get current agenda from NEAR
    const currentAgenda = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_agenda",
    });

    // Get new agenda from Airtable
    const newAgenda = await getAgendaFromAirtable();

    // Compare and update if necessary
    if (JSON.stringify(newAgenda) !== JSON.stringify(currentAgenda)) {
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_agenda",
        args: { agenda: newAgenda },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      await updateAgendaInAirtable(newAgenda); // Update Airtable as well
      return context.json({ message: "Agenda updated successfully" }, 200);
    } else {
      return context.json({ message: "No changes to the agenda" }, 200);
    }
  } catch (error) {
    console.error("Error updating agenda:", error);
    return context.json({ error: "Failed to update agenda" }, 500);
  }
});

// Handle alert updates
app.post("/update-alert", async (context) => {
  try {
    const workerAccount = await setupNear(context);
    const factoryAccountId = context.env.FACTORY_ACCOUNT_ID;

    // Get current alerts from NEAR
    const currentAlerts = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_alerts",
    });

    // Get new alerts from Airtable
    const newAlerts = await getAlertsFromAirtable();

    // Compare and update if necessary
    if (JSON.stringify(newAlerts) !== JSON.stringify(currentAlerts)) {
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_alerts",
        args: { alert: newAlerts },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      await updateAlertsInAirtable(newAlerts); // Update Airtable as well
      return context.json({ message: "Alerts updated successfully" }, 200);
    } else {
      return context.json({ message: "No changes to the alerts" }, 200);
    }
  } catch (error) {
    console.error("Error updating alerts:", error);
    return context.json({ error: "Failed to update alerts" }, 500);
  }
});

export default app;
