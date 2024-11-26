import { Hono } from "hono";
import { KeyPair } from "@near-js/crypto";
import { cors } from "hono/cors";
import { parseNearAmount } from "@near-js/utils";
import { deriveEthAddressFromMpcKey } from "./utils/mpc";
import { contractCall, setupNear } from "./utils/near";
import { userIdFromAuth, verifyIdToken } from "./utils/auth";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "http://localhost:3000",
  }),
);

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
    const userIdHash = await userIdFromAuth(payload);

    // Now call the NEAR contract's add_session_key method
    const { account } = await setupNear(env);

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
    const { near, account } = await setupNear(env);

    const FASTAUTH_CONTRACT_ID = env.FASTAUTH_CONTRACT_ID;
    // Prepare function call
    const result = await contractCall({
      near,
      account,
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
