const { Hono } = require("hono");
const { KeyPair } = require("@near-js/crypto");
const { Account } = require("@near-js/accounts");
const { Near } = require("@near-js/wallet-account");
const { InMemoryKeyStore } = require("@near-js/keystores");
const {
  getAgendaFromAirtable,
  getAlertsFromAirtable,
} = require("./airtableUtils");
const crypto = require("crypto");
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
  try {
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
  } catch (error) {
    console.error("Error setting up NEAR connection:", error);
    throw new Error("Failed to set up NEAR connection.");
  }
}

// Verify HMAC signature
function verifyHMAC(request, macSecretBase64) {
  try {
    const macSecretDecoded = Buffer.from(macSecretBase64, "base64");
    const body = request.clone().text(); // Clone the request to read it twice
    const hmac = crypto.createHmac("sha256", macSecretDecoded);
    hmac.update(body, "utf8");
    const expectedHMAC = "hmac-sha256=" + hmac.digest("hex");
    const receivedHMAC = request.headers.get("X-Airtable-Content-MAC");

    if (expectedHMAC !== receivedHMAC) {
      throw new Error("HMAC verification failed.");
    }
  } catch (error) {
    console.error("Error verifying HMAC:", error);
    throw new Error("HMAC verification failed.");
  }
}

// Update agenda function
async function callUpdateAgenda(context) {
  let workerAccount;
  try {
    workerAccount = await setupNear(context);
  } catch (error) {
    console.error("Error in setupNear during agenda update:", error);
    throw new Error("Failed to set up NEAR connection for agenda update.");
  }

  try {
    const factoryAccountId = context.env.FACTORY_ACCOUNT_ID;

    // Get new agenda from Airtable
    const newAgenda = await getAgendaFromAirtable();

    // Get current agenda from NEAR
    const currentAgenda = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_agenda",
    });

    // Compare and update if necessary
    if (JSON.stringify(newAgenda) !== JSON.stringify(currentAgenda)) {
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_agenda",
        args: { agenda: newAgenda },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
    }
  } catch (error) {
    console.error("Error updating agenda:", error);
    throw new Error("Failed to update agenda in NEAR.");
  }
}

// Update alerts function
async function callUpdateAlerts(context) {
  let workerAccount;
  try {
    workerAccount = await setupNear(context);
  } catch (error) {
    console.error("Error in setupNear during alerts update:", error);
    throw new Error("Failed to set up NEAR connection for alerts update.");
  }

  try {
    const factoryAccountId = context.env.FACTORY_ACCOUNT_ID;

    // Get new alerts from Airtable
    const newAlerts = await getAlertsFromAirtable();

    // Get current alerts from NEAR
    const currentAlerts = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_alerts",
    });

    // Compare and update if necessary
    if (JSON.stringify(newAlerts) !== JSON.stringify(currentAlerts)) {
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_alerts",
        args: { alert: newAlerts },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
    }
  } catch (error) {
    console.error("Error updating alerts:", error);
    throw new Error("Failed to update alerts in NEAR.");
  }
}

// Handle the agenda webhook
app.post("/webhook/agenda", async (context) => {
  try {
    const macSecretBase64 = context.env.AGENDA_MAC_SECRET_BASE64;

    try {
      verifyHMAC(context.req, macSecretBase64);
    } catch (error) {
      console.error("Error verifying HMAC for agenda webhook:", error);
      return context.json({ error: "Invalid HMAC signature" }, 403);
    }

    await callUpdateAgenda(context);
    return context.json({}, 200);
  } catch (error) {
    console.error("Error handling agenda webhook:", error);
    return context.json({ error: "Failed to handle agenda webhook" }, 500);
  }
});

// Handle the alerts webhook
app.post("/webhook/alerts", async (context) => {
  try {
    const macSecretBase64 = context.env.ALERTS_MAC_SECRET_BASE64;

    try {
      verifyHMAC(context.req, macSecretBase64);
    } catch (error) {
      console.error("Error verifying HMAC for alerts webhook:", error);
      return context.json({ error: "Invalid HMAC signature" }, 403);
    }

    await callUpdateAlerts(context);
    return context.json({}, 200);
  } catch (error) {
    console.error("Error handling alerts webhook:", error);
    return context.json({ error: "Failed to handle alerts webhook" }, 500);
  }
});

export default app;
