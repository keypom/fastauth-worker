// utils/crypto.js

export async function hashUserId(userId) {
  // Hash the User ID using SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const userIdHash = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return userIdHash;
}

// Parse JWT function (if needed)
export function parseJwt(token) {
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
