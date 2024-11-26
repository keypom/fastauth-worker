import { Hono } from "hono";
import { KeyPair } from "@near-js/crypto";
import { parseNearAmount } from "@near-js/utils";
import { deriveEthAddressFromMpcKey } from "./utils/mpc";
import { contractCall, setupNear } from "./utils/near";
import { userIdFromAuth, verifyIdToken } from "./utils/auth";

const app = new Hono();

// CORS middleware for `/verify-id-token` only
const corsMiddleware = async (context, next) => {
  const env = context.env;
  const authOrigin = env.AUTH_ORIGIN;
  const requestOrigin = context.req.header("Origin");

  if (requestOrigin === authOrigin) {
    context.res.headers.set("Access-Control-Allow-Origin", requestOrigin);
    context.res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    context.res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    context.res.headers.set("Access-Control-Allow-Credentials", "true");
  }

  if (context.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: context.res.headers,
    });
  }

  await next();
};

// `/verify-id-token` with CORS
app.use("/verify-id-token", corsMiddleware);

app.post("/verify-id-token", async (context) => {
  const env = context.env;
  const authOrigin = env.AUTH_ORIGIN;

  const requestOrigin = context.req.header("Origin");
  if (requestOrigin !== authOrigin) {
    return context.json({ error: "Unauthorized" }, 403);
  }

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

    // Check if the user has a bundle; if not, activate the account
    const path = userIdHash;
    let userBundle = await account.viewFunction({
      contractId: FASTAUTH_CONTRACT_ID,
      methodName: "get_bundle",
      args: {
        path,
      },
    });

    if (!userBundle) {
      const mpcKey = await account.viewFunction({
        contractId: MPC_CONTRACT_ID,
        methodName: "derived_public_key",
        args: {
          path,
          predecessor: FASTAUTH_CONTRACT_ID,
        },
      });

      const ethImplicitAccountId = deriveEthAddressFromMpcKey(mpcKey);

      await account.functionCall({
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
    }

    // Add the session key
    await account.functionCall({
      contractId: FASTAUTH_CONTRACT_ID,
      methodName: "add_session_key",
      args: {
        path,
        public_key: sessionPublicKey,
      },
      gas: "30000000000000",
      attachedDeposit: parseNearAmount("0.1"),
    });

    return context.json({ success: true, userIdHash: userIdHash });
  } catch (error) {
    console.error("Error in /verify-id-token:", error.stack || error);
    return context.json({ error: error.message }, 500);
  }
});

// **Add an OPTIONS handler for `/sign-txn`**
app.options("/sign-txn", async (context) => {
  // Set CORS headers for any origin
  context.res.headers.set("Access-Control-Allow-Origin", "*");
  context.res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  context.res.headers.set("Access-Control-Allow-Headers", "Content-Type");

  return new Response(null, {
    status: 204,
    headers: context.res.headers,
  });
});

// `/sign-txn` endpoint with open CORS
app.post("/sign-txn", async (context) => {
  // Set CORS headers for any origin
  context.res.headers.set("Access-Control-Allow-Origin", "*");
  context.res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  context.res.headers.set("Access-Control-Allow-Headers", "Content-Type");

  try {
    const { req } = context;
    const body = await req.json();

    const { signature, payload, sessionKey } = body;

    if (!signature || !payload || !sessionKey) {
      return context.json(
        { error: "Missing signature, payload, or sessionKey" },
        400,
      );
    }

    // Verify the signature using the session key
    const sessionKeyPair = KeyPair.fromString(sessionKey);
    const payloadBytes = Buffer.from(JSON.stringify(payload));
    const signatureBytes = Buffer.from(signature, "base64");

    const isValid = sessionKeyPair.verify(payloadBytes, signatureBytes);

    if (!isValid) {
      return context.json({ error: "Invalid signature" }, 400);
    }

    // Use the account to call the contract method
    const { near, account } = await setupNear(context.env);

    const FASTAUTH_CONTRACT_ID = context.env.FASTAUTH_CONTRACT_ID;

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
    console.error("Error in /sign-txn:", error.stack || error);
    return context.json({ error: error.message }, 500);
  }
});

export default {
  fetch: app.fetch,
};
