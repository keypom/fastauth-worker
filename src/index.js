const { Hono } = require("hono");
const { KeyPair } = require("@near-js/crypto");
const { Account } = require("@near-js/accounts");
const { Near } = require("@near-js/wallet-account");
const { InMemoryKeyStore } = require("@near-js/keystores");
const crypto = require("crypto");
const {
  getAgendaFromAirtable,
  getAlertsFromAirtable,
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
  console.log("Setting up NEAR connection with the following parameters:", {
    NETWORK,
    WORKER_ACCOUNT_ID,
  });
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
  console.log("NEAR connection established:", near);
  return new Account(near.connection, WORKER_ACCOUNT_ID);
}

// Helper function to verify HMAC
async function verifyHMAC(request, macSecretBase64) {
  try {
    console.log("Starting HMAC verification...");
    const macSecretDecoded = Buffer.from(macSecretBase64, "base64");
    const body = Buffer.from(
      JSON.stringify(webhookNotificationDeliveryPayload),
      "utf8",
    );
    const hmac = require("crypto").createHmac("sha256", macSecretDecoded);
    hmac.update(body.toString(), "ascii");
    const expectedHMAC = "hmac-sha256=" + hmac.digest("hex");
    const receivedHMAC = request.headers.get("X-Airtable-Content-MAC");
    console.log("Expected HMAC:", expectedHMAC);
    console.log("Received HMAC:", receivedHMAC);

    if (expectedHMAC !== receivedHMAC) {
      throw new Error("HMAC verification failed.");
    }
    console.log("HMAC verification successful.");
  } catch (error) {
    console.error("Error verifying HMAC:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

// Handle the webhook requests
app.post("/webhook/:type", async (context) => {
  const { type } = context.req.param();
  console.log(`Received webhook of type: ${type}`);
  let macSecretBase64;

  if (type === "agenda") {
    macSecretBase64 = context.env.AGENDA_MAC_SECRET_BASE64;
  } else if (type === "alerts") {
    macSecretBase64 = context.env.ALERTS_MAC_SECRET_BASE64;
  } else {
    console.error("Invalid webhook type:", type);
    return context.json({ error: "Invalid webhook type" }, 400);
  }

  try {
    await verifyHMAC(context.req, macSecretBase64);
    console.log(`HMAC verification succeeded for ${type} webhook`);

    if (type === "agenda") {
      // Call your agenda update function
      return await handleAgendaUpdate(context);
    } else if (type === "alerts") {
      // Call your alerts update function
      return await handleAlertsUpdate(context);
    }
  } catch (error) {
    console.error(`Error verifying HMAC for ${type} webhook:`, error);
    return context.json({ error: "Invalid HMAC signature" }, 403);
  }
});

// Handle agenda updates
async function handleAgendaUpdate(context) {
  try {
    console.log("Starting agenda update...");
    const workerAccount = await setupNear(context);
    const factoryAccountId = context.env.FACTORY_ACCOUNT_ID;

    // Get new agenda from Airtable
    const newAgenda = await getAgendaFromAirtable();
    console.log("New agenda from Airtable:", newAgenda);

    // Get current agenda from NEAR
    const currentAgenda = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_agenda",
    });
    console.log("Current agenda from NEAR:", currentAgenda);

    // Compare and update if necessary
    if (JSON.stringify(newAgenda) !== JSON.stringify(currentAgenda)) {
      console.log("Agendas differ, updating NEAR contract...");
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_agenda",
        args: { agenda: newAgenda },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      console.log("Agenda updated successfully on NEAR.");
      return context.json({ message: "Agenda updated successfully" }, 200);
    } else {
      console.log("No changes to the agenda.");
      return context.json({ message: "No changes to the agenda" }, 200);
    }
  } catch (error) {
    console.error("Error updating agenda:", error);
    return context.json({ error: "Failed to update agenda" }, 500);
  }
}

// Handle alerts updates
async function handleAlertsUpdate(context) {
  try {
    console.log("Starting alerts update...");
    const workerAccount = await setupNear(context);
    const factoryAccountId = context.env.FACTORY_ACCOUNT_ID;

    // Get new alerts from Airtable
    const newAlerts = await getAlertsFromAirtable();
    console.log("New alerts from Airtable:", newAlerts);

    // Get current alerts from NEAR
    const currentAlerts = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_alerts",
    });
    console.log("Current alerts from NEAR:", currentAlerts);

    // Compare and update if necessary
    if (JSON.stringify(newAlerts) !== JSON.stringify(currentAlerts)) {
      console.log("Alerts differ, updating NEAR contract...");
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_alerts",
        args: { alert: newAlerts },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      console.log("Alerts updated successfully on NEAR.");
      return context.json({ message: "Alerts updated successfully" }, 200);
    } else {
      console.log("No changes to the alerts.");
      return context.json({ message: "No changes to the alerts" }, 200);
    }
  } catch (error) {
    console.error("Error updating alerts:", error);
    return context.json({ error: "Failed to update alerts" }, 500);
  }
}

export default app;
