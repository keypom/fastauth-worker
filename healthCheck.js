// health_report.js

import nearJsCrypto from "@near-js/crypto";
import nearJsKeystores from "@near-js/keystores";
import nearJsAccounts from "@near-js/accounts";
import nearJsWalletAccount from "@near-js/wallet-account";
import { formatNearAmount } from "@near-js/utils";
import chalk from "chalk";

// Destructure necessary modules
const { Near } = nearJsWalletAccount;
const { Account } = nearJsAccounts;
const { InMemoryKeyStore } = nearJsKeystores;

const NETWORK = "mainnet";
const ACCOUNT_ID = "redacted2024.near"; // Replace with your actual account ID

async function setupNear() {
  const keyStore = new InMemoryKeyStore();

  const nearConfig = {
    networkId: NETWORK,
    keyStore: keyStore,
    nodeUrl: `https://rpc.${NETWORK}.near.org`,
    walletUrl: `https://wallet.${NETWORK}.near.org`,
    helperUrl: `https://helper.${NETWORK}.near.org`,
    explorerUrl: `https://explorer.${NETWORK}.near.org`,
  };

  const near = new Near(nearConfig);
  const response = await near.connection.provider.experimental_protocolConfig({
    finality: "final",
  });
  const storage_price = response.runtime_config.storage_amount_per_byte;
  const account = new Account(near.connection, ACCOUNT_ID);
  return { near, account, storage_price };
}

async function main() {
  const { account, storage_price } = await setupNear();
  const state = await account.state();

  const amount = BigInt(state.amount);
  const storage_usage = BigInt(state.storage_usage);
  const storage_price_per_byte = BigInt(storage_price); // yoctoNEAR per byte

  const storage_cost = storage_usage * storage_price_per_byte;

  const available_balance = amount - storage_cost;

  // Convert yoctoNEAR to NEAR
  const available_balance_near = parseFloat(
    formatNearAmount(available_balance.toString()),
  );
  const total_balance_near = parseFloat(formatNearAmount(amount.toString()));
  const storage_cost_near = parseFloat(
    formatNearAmount(storage_cost.toString()),
  );

  const health_factor = available_balance_near / storage_cost_near;

  // Use Chalk for colored output
  console.log(chalk.bold.blue("NEAR Account Health Report"));
  console.log(chalk.blue("=".repeat(60)));
  console.log(`Account ID:          ${chalk.green(ACCOUNT_ID)}`);
  console.log(
    `Total Balance:       ${chalk.green(`${total_balance_near.toFixed(2)} NEAR`)}`,
  );
  console.log(`Storage Used:        ${chalk.yellow(`${storage_usage} bytes`)}`);
  console.log(
    `Storage Cost:        ${chalk.yellow(`${storage_cost_near.toFixed(4)} NEAR`)}`,
  );
  console.log(
    `Available Balance:   ${chalk.green(`${available_balance_near.toFixed(2)} NEAR`)}`,
  );
  console.log(
    `Health Factor:       ${chalk.cyan(
      `${health_factor.toFixed(2)} (Available Balance / Storage Cost)`,
    )}`,
  );
  console.log(chalk.blue("=".repeat(60)));

  // Configuration parameters based on provided storage costs
  const actionCosts = [
    {
      action: "Create Admin Account",
      netCostNear: 0.072,
    },
    {
      action: "Create Sponsor Account",
      netCostNear: 0.081,
    },
    {
      action: "Create DataSetter Account",
      netCostNear: 0.079,
    },
    {
      action: "Add 1 Ticket",
      netCostNear: 0.013,
    },
    {
      action: "Add 10 Tickets",
      netCostNear: 0.124,
    },
    {
      action: "Scan a Ticket",
      netCostNear: 0.001,
    },
    {
      action: "Scan 10 Tickets",
      netCostNear: 0.01,
    },
    {
      action: "Create Conference Account",
      netCostNear: 0.068,
    },
    {
      action: "Create 10 Conference Accounts",
      netCostNear: 0.613,
    },
    {
      action: "Add a Token Drop",
      netCostNear: 0.02,
    },
    {
      action: "Add a NFT Drop",
      netCostNear: 0.034,
    },
    {
      action: "Add a Multichain Drop",
      netCostNear: 0.025,
    },
    // Add more actions as needed based on your table
  ];

  // Calculate how many times each action can be performed
  console.log(
    chalk.bold.blue("Estimated Actions Available with Current Balance:"),
  );
  console.log(chalk.blue("=".repeat(60)));
  actionCosts.forEach(({ action, netCostNear }) => {
    const maxActions = Math.floor(available_balance_near / netCostNear);
    console.log(
      `- ${action}:`.padEnd(40) +
        chalk.green(`${maxActions} times`) +
        ` (Cost per action: ${netCostNear} NEAR)`,
    );
  });
  console.log(chalk.blue("=".repeat(60)));
}

main().catch((error) => {
  console.error("Error:", error);
});
