import fetch from "node-fetch";
import crypto from "crypto";
import nearJsCrypto from "@near-js/crypto";
import nearJsKeystores from "@near-js/keystores";
import nearJsAccounts from "@near-js/accounts";
import nearJsWalletAccount from "@near-js/wallet-account";

import dotenv from "dotenv";

// Accept environment as a command-line argument
const type = process.argv[2]; // 'agenda' or 'alerts'
const ENVIRONMENT = process.argv[3] || "dev"; // 'dev' or 'production'

// Validate the webhook type
if (!type || (type !== "agenda" && type !== "alerts")) {
  console.error('Please specify the webhook type as "agenda" or "alerts".');
  process.exit(1);
}

// Validate the environment
if (ENVIRONMENT !== "dev" && ENVIRONMENT !== "production") {
  console.error("Invalid environment specified. Use 'dev' or 'production'.");
  process.exit(1);
}

// Load the appropriate environment variables file
dotenv.config({
  path: ENVIRONMENT === "dev" ? ".dev.vars" : ".prod.vars",
});

// Destructure necessary modules
const { Near } = nearJsWalletAccount;
const { Account } = nearJsAccounts;
const { InMemoryKeyStore } = nearJsKeystores;
const { KeyPair } = nearJsCrypto;

// Load environment variables
const NETWORK = process.env.NETWORK;
const FACTORY_CONTRACT_ID = process.env.FACTORY_CONTRACT_ID;
const WORKER_NEAR_SK = process.env.WORKER_NEAR_SK.trim();
const AGENDA_MAC_SECRET_BASE64 = process.env.AGENDA_MAC_SECRET_BASE64.trim();
const ALERTS_MAC_SECRET_BASE64 = process.env.ALERTS_MAC_SECRET_BASE64.trim();

// Set the base URL depending on the environment
let BASE_URL;
if (ENVIRONMENT === "dev") {
  BASE_URL = "https://airtable-worker-dev.keypom.workers.dev";
} else if (ENVIRONMENT === "production") {
  BASE_URL = "https://airtable-worker-prod.keypom.workers.dev";
}

// Set the Airtable Worker URL
const AIRTABLE_WORKER_URL = `${BASE_URL}/webhook/`;

// Helper function to create HMAC signature
function createHMACSignature(body, macSecretBase64) {
  const macSecretDecoded = Buffer.from(macSecretBase64, "base64");
  return crypto
    .createHmac("sha256", macSecretDecoded)
    .update(body)
    .digest("hex");
}

// Helper function to send request to the Cloudflare Worker
async function sendWebhook(type, macSecretBase64) {
  const url = `${AIRTABLE_WORKER_URL}${type}`;
  const body = JSON.stringify({}); // Empty body

  const hmacSignature = `hmac-sha256=${createHMACSignature(body, macSecretBase64)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Airtable-Content-MAC": hmacSignature,
    },
    body: body,
  });

  const responseData = await response.json();

  console.log(`Response from Cloudflare Worker (${type}):`, responseData);
}

// Helper function to setup NEAR connection
async function setupNear() {
  const keyStore = new InMemoryKeyStore();
  const workerKey = KeyPair.fromString(WORKER_NEAR_SK);
  await keyStore.setKey(NETWORK, FACTORY_CONTRACT_ID, workerKey);

  const nearConfig = {
    networkId: NETWORK,
    keyStore: keyStore,
    nodeUrl: `https://rpc.${NETWORK}.near.org`,
    walletUrl: `https://wallet.${NETWORK}.near.org`,
    helperUrl: `https://helper.${NETWORK}.near.org`,
    explorerUrl: `https://explorer.${NETWORK}.near.org`,
  };

  const near = new Near(nearConfig);
  return new Account(near.connection, FACTORY_CONTRACT_ID);
}

// Fetch the latest data (agenda or alerts) from NEAR
async function fetchUpdatedData(type) {
  const account = await setupNear();
  const factoryAccountId = FACTORY_CONTRACT_ID;

  // Wait for a few seconds to allow the data to be updated
  await new Promise((resolve) => setTimeout(resolve, 8000));

  const methodName = type === "agenda" ? "get_agenda" : "get_alerts";

  const data = await account.viewFunction({
    contractId: factoryAccountId,
    methodName: methodName,
  });

  console.log(`Updated ${type} from NEAR:`, data);
}

// Main function to run the script
async function main() {
  const macSecretBase64 =
    type === "agenda" ? AGENDA_MAC_SECRET_BASE64 : ALERTS_MAC_SECRET_BASE64;

  // Send the webhook request
  await sendWebhook(type, macSecretBase64);

  // Fetch the updated data from NEAR
  await fetchUpdatedData(type);
}

main().catch((error) => {
  console.error("Error:", error);
});
