const { Hono } = require("hono");
const { KeyPair } = require("@near-js/crypto");
const { Account } = require("@near-js/accounts");
const { Near } = require("@near-js/wallet-account");
const { InMemoryKeyStore } = require("@near-js/keystores");
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
  const FACTORY_CONTRACT_ID = context.env.FACTORY_CONTRACT_ID;
  const workerKey = KeyPair.fromString(context.env.WORKER_NEAR_SK);

  let keyStore = new InMemoryKeyStore();
  keyStore.setKey(NETWORK, FACTORY_CONTRACT_ID, workerKey);

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
  return new Account(near.connection, FACTORY_CONTRACT_ID);
}

// Helper function to verify HMAC using Web Crypto API
async function verifyHMAC(request, macSecretBase64) {
  try {
    console.log("Starting HMAC verification..., ", request);
    const macSecretDecoded = Uint8Array.from(atob(macSecretBase64), (c) =>
      c.charCodeAt(0),
    );
    const body = await request.text(); // Read the body as a string
    console.log("Request body for HMAC verification:", body);

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      macSecretDecoded,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body),
    );

    const expectedHMAC =
      "hmac-sha256=" +
      Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    console.log("HEADERS: ", request.header);
    const receivedHMAC = request.header("X-Airtable-Content-MAC");
    console.log("RECEIVED HMAC: ", receivedHMAC);
    console.log("Expected HMAC:", expectedHMAC);

    if (expectedHMAC !== receivedHMAC) {
      throw new Error("HMAC verification failed.");
    }
    console.log("HMAC verification successful.");
  } catch (error) {
    console.error("Error verifying HMAC:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

// Global state to store timers for each webhook type
const currentTasks = {
  agenda: null,
  alerts: null,
};

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

    // Immediately return 200 OK to Airtable
    const response = context.json(
      { message: "HMAC verified, processing webhook" },
      200,
    );

    // If there is an ongoing task, cancel it by rejecting its Promise
    if (currentTasks[type]) {
      console.log(`Cancelling existing task for ${type} webhook`);
      currentTasks[type].cancel(); // Call the cancel function if it exists
    }

    // Create a new task
    const task = createProcessingTask(context, type);

    // Store the task in the currentTasks object
    currentTasks[type] = task;

    // Ensure the worker keeps running until the task is finished
    context.executionCtx.waitUntil(task.promise);

    return response; // Finalize the response to Airtable
  } catch (error) {
    console.error(`Error verifying HMAC for ${type} webhook:`, error);
    return context.json({ error: "Invalid HMAC signature" }, 403);
  }
});

// Helper function to create a processing task with a cancelable promise
function createProcessingTask(context, type) {
  let cancel;

  const promise = new Promise((resolve, reject) => {
    cancel = () => {
      console.log(`Task for ${type} webhook canceled.`);
      reject(new Error(`Task for ${type} canceled`));
    };

    // Simulate a delay with setTimeout
    setTimeout(async () => {
      console.log(`Processing the latest ${type} webhook after 5 seconds`);
      try {
        const timestamp = Date.now();
        if (type === "agenda") {
          await handleAgendaUpdate(context, timestamp).catch((error) =>
            console.error("Error handling agenda update:", error),
          );
        } else if (type === "alerts") {
          await handleAlertsUpdate(context, timestamp).catch((error) =>
            console.error("Error handling alerts update:", error),
          );
        }
        resolve(); // Resolve the promise if successful
      } catch (error) {
        reject(error); // Reject the promise if an error occurs
      }
    }, 2000); // Wait for 2 seconds before processing
  });

  return { promise, cancel };
}

const deepEqual = (obj1, obj2) => {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
};

const findDifferences = (obj1, obj2) => {
  const diff = [];
  obj1.forEach((item, index) => {
    if (!deepEqual(item, obj2[index])) {
      diff.push({ index, item1: item, item2: obj2[index] });
    }
  });
  return diff;
};

const addTimestampIfMissing = (item, timestamp) => {
  if (!item.Time) {
    item.Time = timestamp;
  }
  return item;
};

// Handle agenda updates
async function handleAgendaUpdate(context, timestamp) {
  try {
    const workerAccount = await setupNear(context);
    const factoryAccountId = context.env.FACTORY_CONTRACT_ID;

    // Get new agenda from Airtable
    const newAgenda = await getAgendaFromAirtable(context);
    console.log("New agenda from Airtable:", JSON.stringify(newAgenda));

    // Get current agenda from NEAR
    let agendaAtTimestamp = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_agenda",
    });
    let currentAgenda = agendaAtTimestamp[0];
    console.log("Current agenda from NEAR:", currentAgenda);

    // Parse currentAgenda from a JSON string to an object
    currentAgenda = JSON.parse(currentAgenda);
    console.log("Current agenda from NEAR:", JSON.stringify(currentAgenda));

    // Compare and update if necessary
    if (!deepEqual(newAgenda, currentAgenda)) {
      console.log("Agendas differ, checking for changes...");

      // Find differences between the new and current agenda
      const differences = findDifferences(newAgenda, currentAgenda);
      console.log("Differences found:", differences);

      // Update only the changed entries and add a timestamp if missing
      differences.forEach(({ index, item1: newItem }) => {
        newAgenda[index] = addTimestampIfMissing(
          newItem,
          new Date().toISOString(),
        );
      });

      // Update NEAR with the modified agenda containing timestamps
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_agenda",
        args: {
          new_agenda: JSON.stringify(newAgenda),
          timestamp, // Pass the timestamp here
        },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      console.log("Agenda updated successfully on NEAR.");
    } else {
      console.log("No changes to the agenda.");
    }
  } catch (error) {
    console.error("Error updating agenda:", error);
  }
}

// Handle alerts updates
async function handleAlertsUpdate(context, timestamp) {
  try {
    console.log("Starting alerts update...");
    const workerAccount = await setupNear(context);
    const factoryAccountId = context.env.FACTORY_CONTRACT_ID;

    // Get new alerts from Airtable
    const newAlerts = await getAlertsFromAirtable(context);
    console.log("New alerts from Airtable:", JSON.stringify(newAlerts));

    // Get current alerts from NEAR
    let alertAtTimestamp = await workerAccount.viewFunction({
      contractId: factoryAccountId,
      methodName: "get_alerts",
    });
    let currentAlerts = alertAtTimestamp[0];
    console.log("Current alerts from NEAR:", currentAlerts);

    // Parse currentAlerts from a JSON string to an object
    currentAlerts = JSON.parse(currentAlerts);
    console.log("Current alerts from NEAR:", JSON.stringify(currentAlerts));

    // Compare and update if necessary
    if (!deepEqual(newAlerts, currentAlerts)) {
      console.log("Alerts differ, checking for changes...");

      // Find differences between the new and current alerts
      const differences = findDifferences(newAlerts, currentAlerts);
      console.log("Differences found:", differences);

      // Update only the changed entries and add a timestamp if missing
      differences.forEach(({ index, item1: newItem, item2: currentItem }) => {
        newAlerts[index] = addTimestampIfMissing(
          newItem,
          new Date().toISOString(),
        );
      });

      // Update NEAR with the modified alerts containing timestamps
      await workerAccount.functionCall({
        contractId: factoryAccountId,
        methodName: "set_alerts",
        args: {
          new_alerts: JSON.stringify(newAlerts),
          timestamp, // Pass the timestamp here
        },
        gas: "30000000000000",
        attachedDeposit: "0",
      });
      console.log("Alerts updated successfully on NEAR.");
    } else {
      console.log("No changes to the alerts.");
    }
  } catch (error) {
    console.error("Error updating alerts:", error);
  }
}

export default app;
