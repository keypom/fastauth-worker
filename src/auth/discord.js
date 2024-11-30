// auth/discord.js

import { hashUserId } from "../utils/crypto.js";

export async function verifyDiscordToken(code, env) {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } = env;

  // Exchange authorization code for tokens
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: code,
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      redirect_uri: `${env.AUTH_ORIGIN}/oauth/callback`,
      scope: "identify email",
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    throw new Error("No access token received from Discord");
  }

  // Fetch user information from Discord
  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  const userData = await userResponse.json();

  if (!userData.id) {
    throw new Error("Unable to retrieve user ID from Discord");
  }

  const userId = userData.id;
  const userIdHash = await hashUserId(userId);

  return { userIdHash };
}
