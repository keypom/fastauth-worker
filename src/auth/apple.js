import { SignJWT } from "jose";
import { parseJwt, hashUserId, validatePemPrivateKey } from "../utils/crypto";

export async function verifyAppleToken(code, env) {
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_PRIVATE_KEY, APPLE_KEY_ID } =
    env;

  const privateKey = APPLE_PRIVATE_KEY.replace(/\\n/g, "\n");

  // Validate the private key format
  validatePemPrivateKey(privateKey);

  // Import the private key using jose
  const privateKeyObj = await importPKCS8(privateKey);

  // Create the client secret JWT using jose
  const clientSecret = await new SignJWT({
    iss: APPLE_TEAM_ID,
    aud: "https://appleid.apple.com",
    sub: APPLE_CLIENT_ID,
  })
    .setProtectedHeader({ alg: "ES256", kid: APPLE_KEY_ID })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKeyObj);
  console.log(clientSecret);

  // Exchange authorization code for tokens
  const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  console.log("Code", code);
  console.log("tokenResponse", JSON.stringify(tokenResponse));

  const tokenData = await tokenResponse.json();
  console.log("tokenData", tokenData);

  if (!tokenData.id_token) {
    throw new Error("No ID token received from Apple");
  }

  // Verify the ID token
  const userIdHash = await verifyAppleIdToken(
    tokenData.id_token,
    APPLE_CLIENT_ID,
  );

  return { userIdHash };
}

// Add the validatePrivateKey function as shown earlier

async function importPKCS8(pem) {
  const pemContents = pem.trim();
  const binaryDerString = atob(
    pemContents
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replace(/\n/g, ""),
  );
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign"],
  );
}

async function verifyAppleIdToken(idToken, clientId) {
  // Decode the JWT header to get the key ID
  const headerBase64Url = idToken.split(".")[0];
  const headerBase64 = headerBase64Url.replace(/-/g, "+").replace(/_/g, "/");
  const header = JSON.parse(atob(headerBase64));
  const kid = header.kid;

  // Fetch Apple's public keys
  const response = await fetch("https://appleid.apple.com/auth/keys");
  const { keys } = await response.json();

  // Find the key that matches the `kid`
  const key = keys.find((k) => k.kid === kid);
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
  const dataToVerify = idToken.split(".").slice(0, 2).join(".");
  const signature = Uint8Array.from(
    atob(idToken.split(".")[2].replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    new TextEncoder().encode(dataToVerify),
  );

  if (!valid) {
    throw new Error("Invalid token signature");
  }

  // Decode and validate the payload
  const payload = parseJwt(idToken);

  // Verify the issuer
  if (payload.iss !== "https://appleid.apple.com") {
    throw new Error("Invalid issuer");
  }

  // Verify the audience
  if (payload.aud !== clientId) {
    throw new Error("Invalid audience");
  }

  // Verify the expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("Token expired");
  }

  // Hash the user ID
  const userIdHash = await hashUserId(payload.sub);

  return userIdHash;
}
