import { Hono } from "hono";
import { KeyPair } from "@near-js/crypto";
import {
  contractCall,
  extractDepositFromPayload,
  setupNear,
} from "./utils/near";
import { addSessionKey } from "./contract/helpers";
import { verifyGoogleToken } from "./auth/google";
import { verifyDiscordToken } from "./auth/discord";
import { verifyAppleToken } from "./auth/apple";

const app = new Hono();

// CORS middleware for `/verify-google-token` and `/verify-discord-token`
const corsMiddleware = async (context, next) => {
  const env = context.env;
  const authOrigin = env.AUTH_ORIGIN; // Frontend origin
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

// Apply CORS middleware to verification endpoints
app.use("/verify-google-token", corsMiddleware);
app.use("/verify-discord-token", corsMiddleware);
app.use("/verify-apple-token", corsMiddleware);

app.options("/sign-txn", async (context) => {
  console.log("Received preflight request for /sign-txn");
  context.res.headers.set("Access-Control-Allow-Origin", "*");
  context.res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  context.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(null, {
    status: 204,
    headers: context.res.headers,
  });
});

app.post("/verify-google-token", async (context) => {
  const env = context.env;
  const authOrigin = env.AUTH_ORIGIN;

  const requestOrigin = context.req.header("Origin");
  if (requestOrigin !== authOrigin) {
    return context.json({ error: "Unauthorized" }, 403);
  }

  try {
    const { req } = context;
    const body = await req.json();

    const { idToken, sessionPublicKey, appId } = body;
    console.log("appId:", appId);

    if (!idToken || !sessionPublicKey) {
      return context.json(
        { error: "Missing idToken or sessionPublicKey" },
        400,
      );
    }

    // Verify the ID token
    const clientId = env.GOOGLE_CLIENT_ID;
    const { userIdHash } = await verifyGoogleToken(idToken, clientId);

    // Add session key to smart contract
    await addSessionKey(env, userIdHash, sessionPublicKey, appId);

    return context.json({ success: true, userIdHash: userIdHash });
  } catch (error) {
    console.error("Error in /verify-google-token:", error.stack || error);
    return context.json({ error: error.message }, 500);
  }
});

app.post("/verify-discord-token", async (context) => {
  // Similar implementation as verify-google-token
  const env = context.env;
  const authOrigin = env.AUTH_ORIGIN;

  const requestOrigin = context.req.header("Origin");
  if (requestOrigin !== authOrigin) {
    return context.json({ error: "Unauthorized" }, 403);
  }

  try {
    const { req } = context;
    const body = await req.json();

    const { code, sessionPublicKey, appId } = body;
    console.log("appId:", appId);

    if (!code || !sessionPublicKey || !appId) {
      return context.json(
        { error: "Missing code, sessionPublicKey, or appId" },
        400,
      );
    }

    // Verify the authorization code with Discord
    const { userIdHash } = await verifyDiscordToken(code, env);

    // Add session key to smart contract
    await addSessionKey(env, userIdHash, sessionPublicKey, appId);

    return context.json({ success: true, userIdHash: userIdHash });
  } catch (error) {
    console.error("Error in /verify-discord-token:", error.stack || error);
    return context.json({ error: error.message }, 500);
  }
});

// Apple token verification
app.post("/verify-apple-token", async (context) => {
  const env = context.env;
  const authOrigin = env.AUTH_ORIGIN;

  const requestOrigin = context.req.header("Origin");
  if (requestOrigin !== authOrigin) {
    return context.json({ error: "Unauthorized" }, 403);
  }

  try {
    const { req } = context;
    const body = await req.json();

    const { code, sessionPublicKey, appId } = body;

    if (!code || !sessionPublicKey || !appId) {
      return context.json(
        { error: "Missing code, sessionPublicKey, or appId" },
        400,
      );
    }

    const { userIdHash } = await verifyAppleToken(code, env);

    await addSessionKey(env, userIdHash, sessionPublicKey, appId);

    return context.json({ success: true, userIdHash });
  } catch (error) {
    console.error("Error in /verify-apple-token:", error.stack || error);
    return context.json({ error: error.message }, 500);
  }
});

// OAuth Initiation for Google
app.get("/oauth/google", async (context) => {
  const { req, env } = context;
  const url = new URL(req.url);
  const parentOrigin = url.searchParams.get("parentOrigin");
  const publicKey = url.searchParams.get("publicKey");
  const appId = url.searchParams.get("appId");

  if (!parentOrigin || !publicKey || !appId) {
    return context.json(
      { error: "Missing parentOrigin, publicKey, or appId" },
      400,
    );
  }

  // Generate a unique state parameter
  const state = crypto.randomUUID();

  // Store the state mapping in Workers KV
  await env.SESSIONS.put(
    state,
    JSON.stringify({
      parentOrigin,
      publicKey,
      appId,
      provider: "google",
    }),
    { expirationTtl: 600 }, // 10 minutes
  );

  // Construct the OAuth authorization URL for Google
  const redirectUri = `${env.AUTH_ORIGIN}/oauth/callback`;
  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(
    env.GOOGLE_CLIENT_ID,
  )}&redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&scope=openid%20email%20profile&state=${encodeURIComponent(state)}`;

  // Redirect to Google's OAuth 2.0 server
  return context.redirect(oauthUrl);
});

// OAuth Initiation for Discord
app.get("/oauth/discord", async (context) => {
  const { req, env } = context;
  const url = new URL(req.url);
  const parentOrigin = url.searchParams.get("parentOrigin");
  const publicKey = url.searchParams.get("publicKey");
  const appId = url.searchParams.get("appId");

  if (!parentOrigin || !publicKey || !appId) {
    return context.json(
      { error: "Missing parentOrigin, publicKey, or appId" },
      400,
    );
  }

  // Generate a unique state parameter
  const state = crypto.randomUUID();

  // Store the state mapping in Workers KV
  await env.SESSIONS.put(
    state,
    JSON.stringify({
      parentOrigin,
      publicKey,
      appId,
      provider: "discord",
    }),
    { expirationTtl: 600 }, // 10 minutes
  );

  // Construct the OAuth authorization URL for Discord
  const redirectUri = `${env.AUTH_ORIGIN}/oauth/callback`;
  const oauthUrl = `https://discord.com/api/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(
    env.DISCORD_CLIENT_ID,
  )}&redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&scope=identify%20email&state=${encodeURIComponent(state)}`;

  // Redirect to Discord's OAuth 2.0 server
  return context.redirect(oauthUrl);
});

// OAuth Initiation for Apple
app.get("/oauth/apple", async (context) => {
  const { req, env } = context;
  const url = new URL(req.url);
  const parentOrigin = url.searchParams.get("parentOrigin");
  const publicKey = url.searchParams.get("publicKey");
  const appId = url.searchParams.get("appId");

  if (!parentOrigin || !publicKey || !appId) {
    return context.json(
      { error: "Missing parentOrigin, publicKey, or appId" },
      400,
    );
  }

  const state = crypto.randomUUID();

  await env.SESSIONS.put(
    state,
    JSON.stringify({
      parentOrigin,
      publicKey,
      appId,
      provider: "apple",
    }),
    { expirationTtl: 600 },
  );

  const redirectUri = `${env.AUTH_ORIGIN}/oauth/callback`;
  const oauthUrl = `https://appleid.apple.com/auth/authorize?response_type=code&client_id=${encodeURIComponent(
    env.APPLE_CLIENT_ID,
  )}&redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&state=${encodeURIComponent(state)}&scope=email`;

  return context.redirect(oauthUrl);
});

// OAuth Callback Handler (updated for Apple)
app.get("/oauth/callback", async (context) => {
  const { req, env } = context;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return context.html(`
      <script>
        window.opener.postMessage({ type: 'auth-error', error: '${error}' }, '*');
        window.close();
      </script>
    `);
  }

  if (!code || !state) {
    return context.html(`
      <script>
        window.opener.postMessage({ type: 'auth-error', error: 'Missing code or state.' }, '*');
        window.close();
      </script>
    `);
  }

  try {
    const sessionDataRaw = await env.SESSIONS.get(state);
    if (!sessionDataRaw) {
      throw new Error("Invalid or expired state parameter.");
    }

    const sessionData = JSON.parse(sessionDataRaw);
    const { parentOrigin, publicKey, appId, provider } = sessionData;

    await env.SESSIONS.delete(state);

    let userIdHash;

    if (provider === "google") {
      const { userIdHash: googleUserIdHash } = await verifyGoogleToken(
        code,
        env,
      );
      userIdHash = googleUserIdHash;
    } else if (provider === "discord") {
      const { userIdHash: discordUserIdHash } = await verifyDiscordToken(
        code,
        env,
      );
      userIdHash = discordUserIdHash;
    } else if (provider === "apple") {
      const { userIdHash: appleUserIdHash } = await verifyAppleToken(code, env);
      userIdHash = appleUserIdHash;
    } else {
      throw new Error("Unsupported provider.");
    }

    await addSessionKey(env, userIdHash, publicKey, appId);

    return context.html(`
      <script>
        window.opener.postMessage({ type: 'auth-success', userIdHash: '${userIdHash}' }, '${parentOrigin}');
        window.close();
      </script>
    `);
  } catch (err) {
    console.error("Error in /oauth/callback:", err);
    return context.html(`
      <script>
        window.opener.postMessage({ type: 'auth-error', error: '${err.message}' }, '*');
        window.close();
      </script>
    `);
  }
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

    const { signature, payload, sessionKey, appId } = body;
    console.log("appId:", appId);

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
    const SHOULD_COVER_DEPOSITS = context.env.SHOULD_COVER_DEPOSITS;

    // Determine the attached deposit
    let attachedDeposit = BigInt(0);
    if (SHOULD_COVER_DEPOSITS === "TRUE") {
      console.log("Covering attached deposit...");
      attachedDeposit = extractDepositFromPayload(payload);
    }

    // Prepare function call
    const result = await contractCall({
      near,
      account,
      contractId: FASTAUTH_CONTRACT_ID,
      methodName: "execute_near_action",
      args: {
        signature,
        payload,
        session_key: sessionKeyPair.getPublicKey().toString(),
        app_id: appId,
      },
      gas: BigInt("300000000000000"),
      attachedDeposit,
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
