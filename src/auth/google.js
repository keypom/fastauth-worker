// backend/auth/google.js

import { parseJwt, hashUserId } from "../utils/crypto.js";

export async function verifyGoogleToken(code, env) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_ORIGIN } = env;
  console.log("AUTH_ORIGIN", AUTH_ORIGIN);
  console.log("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
  console.log("GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET);

  // Exchange authorization code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${AUTH_ORIGIN}/oauth/callback`, // Updated
      grant_type: "authorization_code",
    }),
  });

  console.log("Code", code);
  console.log("tokenResponse", JSON.stringify(tokenResponse));
  const tokenData = await tokenResponse.json();
  console.log("tokenData", tokenData);

  if (!tokenData.id_token) {
    throw new Error("No ID token received from Google");
  }

  // Verify the ID token
  const clientId = GOOGLE_CLIENT_ID;
  const { userIdHash } = await verifyGoogleIdToken(
    tokenData.id_token,
    clientId,
  );

  return { userIdHash };
}

async function verifyGoogleIdToken(idToken, clientId) {
  // Decode the payload
  const payload = parseJwt(idToken);

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
  const valid = await verifyGoogleSignature(idToken);
  if (!valid) {
    throw new Error("Invalid token signature");
  }

  const userId = payload.sub;
  const userIdHash = await hashUserId(userId);

  return { userIdHash };
}

async function verifyGoogleSignature(idToken) {
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
