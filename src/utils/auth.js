// Verify ID token
export async function verifyIdToken(idToken, clientId) {
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

export async function userIdFromAuth(payload) {
  const googleUserId = payload.sub;

  // Hash the Google User ID
  const encoder = new TextEncoder();
  const data = encoder.encode(googleUserId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const userIdHash = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return userIdHash;
}

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
