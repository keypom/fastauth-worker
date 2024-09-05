import fetch from "node-fetch";
import crypto from "crypto";
import nearJsCrypto from "@near-js/crypto";
import nearJsKeystores from "@near-js/keystores";
import nearJsAccounts from "@near-js/accounts";
import nearJsWalletAccount from "@near-js/wallet-account";

import dotenv from "dotenv";
dotenv.config({ path: ".dev.vars" });

const { Near } = nearJsWalletAccount;
const { Account } = nearJsAccounts;
const { InMemoryKeyStore } = nearJsKeystores;
const { KeyPair } = nearJsCrypto;

// Load environment variables
const NETWORK = process.env.NETWORK;
const FACTORY_CONTRACT_ID = process.env.FACTORY_CONTRACT_ID;
const WORKER_NEAR_SK = process.env.WORKER_NEAR_SK;
const AGENDA_MAC_SECRET_BASE64 = process.env.AGENDA_MAC_SECRET_BASE64.trim();
const ALERTS_MAC_SECRET_BASE64 = process.env.ALERTS_MAC_SECRET_BASE64.trim();
const AIRTABLE_WORKER_URL =
  "https://airtable-worker-dev.keypom.workers.dev/webhook/";

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

  console.log(
    `Response from Cloudflare Worker (${type}):`,
    await response.json(),
  );
}

// Helper function to setup NEAR connection
async function setupNear() {
  const keyStore = new InMemoryKeyStore();
  const workerKey = KeyPair.fromString(WORKER_NEAR_SK);
  keyStore.setKey(NETWORK, FACTORY_CONTRACT_ID, workerKey);

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

// Fetch the latest agenda from NEAR
async function fetchUpdatedAgenda() {
  const account = await setupNear();
  const factoryAccountId = FACTORY_CONTRACT_ID;

  const agenda = await account.viewFunction({
    contractId: factoryAccountId,
    methodName: "get_agenda",
  });

  console.log("Updated agenda from NEAR:", agenda);
}

// Main function to run the script
async function main() {
  const type = process.argv[2]; // 'agenda' or 'alerts'

  if (!type || (type !== "agenda" && type !== "alerts")) {
    console.error('Please specify the webhook type as "agenda" or "alerts".');
    process.exit(1);
  }

  const macSecretBase64 =
    type === "agenda" ? AGENDA_MAC_SECRET_BASE64 : ALERTS_MAC_SECRET_BASE64;

  // Send the webhook request
  await sendWebhook(type, macSecretBase64);

  // Fetch the updated agenda from NEAR
  await fetchUpdatedAgenda();
}

main().catch((error) => {
  console.error("Error:", error);
});
