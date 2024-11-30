import { parseNearAmount } from "@near-js/utils";
import { deriveEthAddressFromMpcKey } from "../utils/mpc";
import { setupNear } from "../utils/near";

// Helper function to add session key to smart contract
export async function addSessionKey(env, userIdHash, sessionPublicKey, appId) {
  const FASTAUTH_CONTRACT_ID = env.FASTAUTH_CONTRACT_ID;
  const MPC_CONTRACT_ID = env.MPC_CONTRACT_ID;

  const { account } = await setupNear(env);

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
      app_id: appId,
    },
    gas: "30000000000000",
    attachedDeposit: parseNearAmount("0.1"),
  });
}
