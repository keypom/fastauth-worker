import { Hono } from "hono";
import { KeyPair } from "@near-js/crypto";
import { Account } from "@near-js/accounts";
import { Near } from "@near-js/wallet-account";
import { cors } from "hono/cors";
import { InMemoryKeyStore } from "@near-js/keystores";
import { parseNearAmount } from "@near-js/utils";
import { deriveEthAddressFromMpcKey } from "./mpc";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "http://localhost:3000",
  }),
);

// Parse JWT function
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

// Verify ID token signature
async function verifySignature(idToken) {
  // Fetch Google's public keys
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = await response.json();

  // Parse the JWT header to get the key ID (kid)
  const headerBase64Url = idToken.split(".")[0];
  const headerBase64 = headerBase64Url.replace(/-/g, "+").replace(/_/g, "/");
  const header = JSON.parse(atob(headerBase64));

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

// Verify ID token
async function verifyIdToken(idToken, clientId) {
  // Decode the payload
  const payload = parseJwt(idToken);
  console.log("payload", payload);
  console.log("clientId", clientId);

  if (!clientId) {
    console.error("clientId is undefined");
    throw new Error("Server configuration error: clientId is undefined");
  }

  // Verify the issuer
  if (
    payload.iss !== "https://accounts.google.com" &&
    payload.iss !== "accounts.google.com"
  ) {
    throw new Error("Invalid issuer");
  }

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

  return payload; // Return the payload (contains 'sub' which is the user ID)
}

// Helper function to setup NEAR connection
async function setupNear(env) {
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
    nodeUrl: `https://g.w.lavanet.xyz:443/gateway/neart/rpc-http/f653c33afd2ea30614f69bc1c73d4940`,
    walletUrl: `https://wallet.${NETWORK}.near.org`,
    helperUrl: `https://helper.${NETWORK}.near.org`,
    explorerUrl: `https://explorer.${NETWORK}.near.org`,
  };

  const near = new Near(nearConfig);
  const account = new Account(near.connection, ORACLE_ACCOUNT_ID);
  return account;
}

app.post("/add-session-key", async (context) => {
  const env = context.env;

  try {
    const { req } = context;
    const body = await req.json();

    const { idToken, sessionPublicKey } = body;

    if (!idToken || !sessionPublicKey) {
      return context.json(
        { error: "Missing idToken or sessionPublicKey" },
        400,
      );
    }

    // Verify the ID token
    const clientId = env.GOOGLE_CLIENT_ID;
    const payload = await verifyIdToken(idToken, clientId);

    const googleUserId = payload.sub;

    // Hash the Google User ID
    const encoder = new TextEncoder();
    const data = encoder.encode(googleUserId);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const userIdHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Now call the NEAR contract's add_session_key method
    const account = await setupNear(env);

    const FASTAUTH_CONTRACT_ID = env.FASTAUTH_CONTRACT_ID;
    const MPC_CONTRACT_ID = env.MPC_CONTRACT_ID;

    // Call the contract method
    console.log("Calling function add_session_key with user ID:", userIdHash);

    const path = userIdHash;
    let userBundle = await account.viewFunction({
      contractId: FASTAUTH_CONTRACT_ID,
      methodName: "get_bundle",
      args: {
        path,
      },
    });
    console.log("userBundle", userBundle);

    if (!userBundle) {
      const mpcKey = await account.viewFunction({
        contractId: MPC_CONTRACT_ID,
        methodName: "derived_public_key",
        args: {
          path,
          predecessor: FASTAUTH_CONTRACT_ID,
        },
      });
      console.log("mpcKey", mpcKey);
      const ethImplicitAccountId = deriveEthAddressFromMpcKey(mpcKey);
      console.log("ethImplicitAccountId", ethImplicitAccountId);
      const res = await account.functionCall({
        contractId: FASTAUTH_CONTRACT_ID,
        methodName: "activate_account",
        args: {
          mpc_key: mpcKey,
          eth_address: ethImplicitAccountId,
          path,
        },
        gas: "30000000000000",
        attachedDeposit: parseNearAmount("0.1"),
      });
      console.log("Account activated: ", res);
    }

    try {
      await account.functionCall({
        contractId: FASTAUTH_CONTRACT_ID,
        methodName: "add_session_key",
        args: {
          path,
          public_key: sessionPublicKey.toString(),
        },
        gas: "30000000000000",
        attachedDeposit: parseNearAmount("0.1"),
      });
    } catch (err) {
      console.error("Error during account.functionCall:", err.stack || err);
      throw err;
    }

    return context.json({ success: true });
  } catch (error) {
    console.error("Error in /add-session-key:", error.stack || error);
    return context.json({ error: error.message }, 500);
  }
});

app.post("/sign-txn", async (context) => {
  const env = context.env;

  try {
    const { req } = context;
    const body = await req.json();

    const { signature, payload, sessionKey } = body;

    if (!signature || !payload || !sessionKey) {
      return context.json({ error: "Missing signature, payload, or " }, 400);
    }

    // Verify the signature using the session key
    const sessionKeyPair = KeyPair.fromString(sessionKey);
    const payloadBytes = Buffer.from(JSON.stringify(payload));
    const signatureBytes = Buffer.from(signature, "base64");

    const isValid = sessionKeyPair.verify(payloadBytes, signatureBytes);

    if (!isValid) {
      return context.json({ error: "Invalid signature" }, 400);
    }

    // Reconstruct the transaction
    // Use the account to call the contract method
    const account = await setupNear(env);

    const FASTAUTH_CONTRACT_ID = env.FASTAUTH_CONTRACT_ID;
    // Prepare function call
    const result = await account.functionCall({
      contractId: FASTAUTH_CONTRACT_ID,
      methodName: "call_near_contract",
      args: {
        signature,
        payload,
        session_key: sessionKeyPair.getPublicKey().toString(),
      },
      gas: BigInt("300000000000000"),
      attachedDeposit: BigInt(0),
    });

    return context.json({ success: true, executionOutcome: result });
  } catch (error) {
    console.error("Error in /sign-transaction:", error.stack || error);
    return context.json({ error: error.message }, 500);
  }
});

export default {
  fetch: app.fetch,
};
