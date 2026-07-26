import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
dotenv.config();

// The env value may carry a trailing inline comment — the key is the first token.
const PRIVATE_KEY = (process.env.PRIVATE_KEY ?? "").trim().split(/\s+/)[0];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun", // Mantle supports Cancun opcodes (mcopy/tstore); required by OZ 5.6
    },
  },
  networks: {
    mantle: {
      url: process.env.MANTLE_RPC_URL ?? "https://rpc.mantle.xyz",
      chainId: 5000,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    mantleSepolia: {
      url: process.env.MANTLE_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.mantle.xyz",
      chainId: 5003,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    robinhood: {
      url: process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    robinhoodTestnet: {
      url: process.env.ROBINHOOD_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    xlayer: {
      url: process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech",
      chainId: 196,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  // Etherscan V2: ONE API key verifies across chains. Mantle (5000) isn't built into the plugin,
  // so register it explicitly via the V2 unified endpoint (the plugin appends chainid automatically).
  etherscan: {
    // Per-network keys: a bare string routes everything through the Etherscan V2
    // unified endpoint (which rejects chain 4663). An object keyed by network name
    // makes hardhat-verify use each customChain's apiURL — so robinhood verifies
    // against Blockscout with the Blockscout key, not Etherscan.
    apiKey: {
      mantle: process.env.ETHERSCAN_API_KEY ?? "",
      robinhood: process.env.BLOCKSCOUT_API_KEY ?? "",
      robinhoodTestnet: process.env.BLOCKSCOUT_API_KEY ?? "",
    },
    customChains: [
      {
        network: "mantle",
        chainId: 5000,
        urls: { apiURL: "https://api.etherscan.io/v2/api", browserURL: "https://mantlescan.xyz" },
      },
      {
        // Robinhood Chain verifies via Blockscout (Etherscan-compatible, keyless).
        network: "robinhood",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com",
        },
      },
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://robinhoodchain-testnet.blockscout.com/api",
          browserURL: "https://robinhoodchain-testnet.blockscout.com",
        },
      },
    ],
  },
};

export default config;
