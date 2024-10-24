import { Hono } from "hono";
import { cors } from "hono/cors";
import { KeyPair } from "@near-js/crypto";
import { Account } from "@near-js/accounts";
import { Near } from "@near-js/wallet-account";
import { InMemoryKeyStore } from "@near-js/keystores";
import {
  getAgendaFromAirtable,
  getAlertsFromAirtable,
  getAttendeeInfoFromAirtable,
} from "./airtableUtils";

const app = new Hono();

// Setup CORS
const allowed_origins = [
  "http://localhost:5173",
  "https://development.keypom-events-app.pages.dev",
  "https://app.redactedbangkok.ai",
];
app.use(
  "*",
  cors({
    origin: allowed_origins,
    methods: ["GET", "POST", "HEAD"],
    allowedHeaders: ["Content-Type"],
  }),
);

export function getEnvVariable(name, env) {
  return env[name];
}

function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) throw new Error("Invalid token");
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("Failed to parse JWT:", e);
    throw new Error("Failed to parse JWT");
  }
}

// Retry helper with exponential backoff
async function retryWithBackoff(fn, retries = 5, backoff = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(); // Try executing the function
    } catch (error) {
      if (attempt === retries || !shouldRetry(error)) {
        throw error; // Rethrow the error if we've reached max retries or it's not retryable
      }
      console.warn(`Attempt ${attempt} failed. Retrying in ${backoff}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff)); // Wait before retrying
      backoff *= 2; // Exponential backoff
    }
  }
}

// Helper function to determine if error is retryable
function shouldRetry(error) {
  if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
    return true; // Retry on network errors
  }
  if (error.response && error.response.status === 429) {
    return true; // Retry on rate limiting
  }
  return false; // Don't retry on other errors
}

// Helper function to setup NEAR connection
async function setupNear(env) {
  const NETWORK = getEnvVariable("NETWORK", env);
  const FACTORY_CONTRACT_ID = getEnvVariable("FACTORY_CONTRACT_ID", env);
  const workerKey = KeyPair.fromString(getEnvVariable("WORKER_NEAR_SK", env));

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
  const env = context.env;
  const { type } = context.req.param();
  console.log(`Received webhook of type: ${type}`);
  let macSecretBase64;

  if (type === "agenda") {
    macSecretBase64 = getEnvVariable("AGENDA_MAC_SECRET_BASE64", env);
  } else if (type === "alerts") {
    macSecretBase64 = getEnvVariable("ALERTS_MAC_SECRET_BASE64", env);
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
    const task = createProcessingTask(env, type);

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

app.get("/fetch-attendees", async (context) => {
  const env = context.env;
  const authHeader = context.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return context.json({ error: "Unauthorized" }, 401);
  }

  const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Decode the ID token
    const payload = parseJwt(idToken);

    // Verify the token
    await verifyIdToken(
      idToken,
      payload,
      getEnvVariable("GOOGLE_CLIENT_ID", env),
    );

    // Check if the email is an authorized admin
    const authorizedAdmins = getEnvVariable("AUTHORIZED_ADMINS", env).split(
      ",",
    );
    if (!authorizedAdmins.includes(payload.email)) {
      return context.json({ error: "Access denied" }, 403);
    }

    // Fetch attendee data
    const attendees = await getAttendeeInfoFromAirtable(env);
    return context.json({ attendees });
  } catch (error) {
    console.error("Error verifying ID token:", error);
    return context.json({ error: "Invalid or expired token" }, 401);
  }
});

app.get("/fetch-admin-login", async (context) => {
  const env = context.env;
  const authHeader = context.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return context.json({ error: "Unauthorized" }, 401);
  }

  const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Decode the ID token
    const payload = parseJwt(idToken);

    // Verify the token
    await verifyIdToken(
      idToken,
      payload,
      getEnvVariable("GOOGLE_CLIENT_ID", env),
    );

    // Check if the email is an authorized admin
    const authorizedAdmins = getEnvVariable("AUTHORIZED_ADMINS", env).split(
      ",",
    );
    if (!authorizedAdmins.includes(payload.email)) {
      return context.json({ error: "Access denied" }, 403);
    }

    return context.json({
      accountId: `admin.${getEnvVariable("FACTORY_CONTRACT_ID", env)}`,
      displayName: "admin",
      secretKey: getEnvVariable("ADMIN_NEAR_SK", env),
    });
  } catch (error) {
    console.error("Error verifying ID token:", error);
    return context.json({ error: "Invalid or expired token" }, 401);
  }
});

async function verifyIdToken(idToken, payload, clientId) {
  // Verify the issuer
  if (
    payload.iss !== "https://accounts.google.com" &&
    payload.iss !== "accounts.google.com"
  ) {
    throw new Error("Invalid issuer");
  }

  // **Add these logs**
  console.log("payload.aud:", payload.aud);
  console.log("Expected clientId:", clientId);

  // Verify the audience
  if (Array.isArray(payload.aud)) {
    if (!payload.aud.includes(clientId)) {
      throw new Error("Invalid audience");
    }
  } else {
    if (payload.aud !== clientId) {
      throw new Error("Invalid audience");
    }
  }

  // Verify the expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("Token expired");
  }

  // Verify the signature using Google's public keys
  const valid = await verifySignature(idToken);
  if (!valid) {
    throw new Error("Invalid token signature");
  }
}

// Function to verify the token's signature
async function verifySignature(idToken) {
  // Fetch Google's public keys
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = await response.json();

  // Parse the JWT header to get the key ID (kid)
  const header = JSON.parse(
    atob(idToken.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")),
  );
  const key = keys.find((k) => k.kid === header.kid);

  if (!key) {
    throw new Error("Invalid key ID");
  }

  // Import the public key
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["verify"],
  );

  // Verify the signature
  const encoder = new TextEncoder();
  const data = encoder.encode(idToken.split(".").slice(0, 2).join("."));
  const signature = Uint8Array.from(
    atob(idToken.split(".")[2].replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    data,
  );

  return valid;
}

// Helper function to create a processing task with a cancelable promise
function createProcessingTask(env, type) {
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
          await handleAgendaUpdate(env, timestamp).catch((error) =>
            console.error("Error handling agenda update:", error),
          );
        } else if (type === "alerts") {
          await handleAlertsUpdate(env, timestamp).catch((error) =>
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

const addTimestampIfMissing = (item, existingItem, timestamp) => {
  if (!existingItem.Time) {
    item.Time = timestamp; // Add timestamp to the blockchain data only if it doesn't exist
  } else {
    item.Time = existingItem.Time; // Preserve the existing timestamp
  }
  return item;
};

// Handle agenda updates with retries
async function handleAgendaUpdate(env, timestamp) {
  try {
    const workerAccount = await setupNear(env);
    const factoryAccountId = getEnvVariable("FACTORY_CONTRACT_ID", env);

    const newAgenda = await getAgendaFromAirtable(env);
    console.log("New agenda from Airtable:", JSON.stringify(newAgenda));

    let agendaAtTimestamp = await retryWithBackoff(() =>
      workerAccount.viewFunction({
        contractId: factoryAccountId,
        methodName: "get_agenda",
      }),
    );

    let currentAgenda = JSON.parse(agendaAtTimestamp[0]);
    console.log("Current agenda from NEAR:", currentAgenda);

    if (!deepEqual(newAgenda, currentAgenda)) {
      console.log("Agendas differ, updating blockchain...");

      const updatedAgenda = newAgenda.map((newItem, index) => {
        const existingItem = currentAgenda[index] || {};
        return addTimestampIfMissing(
          newItem,
          existingItem,
          new Date().toISOString(),
        );
      });

      await retryWithBackoff(() =>
        workerAccount.functionCall({
          contractId: factoryAccountId,
          methodName: "set_agenda",
          args: {
            new_agenda: JSON.stringify(updatedAgenda),
            timestamp,
          },
          gas: "30000000000000",
          attachedDeposit: "0",
        }),
      );

      console.log("Agenda updated successfully on NEAR.");
    } else {
      console.log("No changes to the agenda.");
    }
  } catch (error) {
    console.error("Error updating agenda:", error);
  }
}

// Handle alerts updates with retries
async function handleAlertsUpdate(env, timestamp) {
  try {
    console.log("Starting alerts update...");
    const workerAccount = await setupNear(env);
    const factoryAccountId = getEnvVariable("FACTORY_CONTRACT_ID", env);

    const newAlerts = await getAlertsFromAirtable(env);
    console.log("New alerts from Airtable:", JSON.stringify(newAlerts));

    let alertAtTimestamp = await retryWithBackoff(() =>
      workerAccount.viewFunction({
        contractId: factoryAccountId,
        methodName: "get_alerts",
      }),
    );

    let currentAlerts = JSON.parse(alertAtTimestamp[0]);
    console.log("Current alerts from NEAR:", currentAlerts);

    if (!deepEqual(newAlerts, currentAlerts)) {
      console.log("Alerts differ, updating blockchain...");

      const updatedAlerts = newAlerts.map((newItem, index) => {
        const existingItem = currentAlerts[index] || {};
        return addTimestampIfMissing(
          newItem,
          existingItem,
          new Date().toISOString(),
        );
      });

      await retryWithBackoff(() =>
        workerAccount.functionCall({
          contractId: factoryAccountId,
          methodName: "set_alerts",
          args: {
            new_alerts: JSON.stringify(updatedAlerts),
            timestamp,
          },
          gas: "30000000000000",
          attachedDeposit: "0",
        }),
      );

      console.log("Alerts updated successfully on NEAR.");
    } else {
      console.log("No changes to the alerts.");
    }
  } catch (error) {
    console.error("Error updating alerts:", error);
  }
}

async function refreshAirtableWebhooks(env) {
  console.log("Refreshing Airtable webhooks...", env);
  const webhookIds = {
    agenda: getEnvVariable("AGENDA_WEBHOOK_ID", env),
    alerts: getEnvVariable("ALERTS_WEBHOOK_ID", env),
  };

  const baseId = getEnvVariable("AIRTABLE_AGENDA_ALERTS_BASE_ID", env);
  const airtableApiKey = getEnvVariable("AIRTABLE_PERSONAL_ACCESS_TOKEN", env);

  for (const [type, webhookId] of Object.entries(webhookIds)) {
    try {
      const response = await fetch(
        `https://api.airtable.com/v0/bases/${baseId}/webhooks/${webhookId}/refresh`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${airtableApiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        console.error(
          `Failed to refresh ${type} webhook. Status: ${response.status}`,
        );
        const errorText = await response.text();
        console.error(`Error: ${errorText}`);
        continue;
      }

      const data = await response.json();
      const newExpiration = data.expirationTime;

      console.log(
        `Successfully refreshed ${type} webhook. New expiration: ${newExpiration}`,
      );

      // Optionally, store the new expiration time in KV storage or update environment variables
    } catch (error) {
      console.error(`Error refreshing ${type} webhook:`, error);
    }
  }
}

app.get("/test-scheduled", async (context) => {
  await handleScheduledEvent(null, context.env, context.executionCtx);
  return context.json({ message: "Scheduled function executed" });
});

async function handleScheduledEvent(event, env, ctx) {
  await refreshAirtableWebhooks(env);
}

export default {
  fetch: app.fetch,
  scheduled: handleScheduledEvent,
};
