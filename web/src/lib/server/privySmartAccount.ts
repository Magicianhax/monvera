import "server-only";

// Server-side ERC-4337 client for Autopilot. Mirrors lib/aa.ts, but the smart
// account OWNER is signed by Privy's server wallet API (the user delegated their
// embedded wallet), not by a browser EIP-1193 provider. Same SimpleAccount owner
// address ⇒ same smart-account address the user funds and sees in the app.
//
// Requires: PRIVY_APP_SECRET (+ app id), PRIVY_AUTHORIZATION_KEY (the wallet-API
// authorization private key, base64 PKCS8), and PIMLICO_API_KEY.
import { createPublicClient, http, type Address } from "viem";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";

const ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;
const publicClient = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

let privyClient: PrivyClient | null = null;
function privy(): PrivyClient {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Privy app credentials are not configured.");
  if (!privyClient) privyClient = new PrivyClient({ appId, appSecret });
  return privyClient;
}

function authorizationContext() {
  const key = process.env.PRIVY_AUTHORIZATION_KEY;
  if (!key) throw new Error("PRIVY_AUTHORIZATION_KEY is not configured.");
  return { authorization_private_keys: [key] };
}

function bundlerUrl(): string {
  const key = process.env.PIMLICO_API_KEY;
  if (!key) throw new Error("PIMLICO_API_KEY is not configured.");
  return `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${key}`;
}

/**
 * Build the smart-account client for a delegated wallet. `owner` is the embedded
 * EOA address; `walletId` is the Privy wallet id the server is authorized to sign
 * for. Gas is sponsored by the Pimlico paymaster.
 */
export async function getServerSmartAccountClient(walletId: string, owner: Address) {
  const url = bundlerUrl();

  // Privy-signed owner: signMessage / signTypedData go to the Privy wallet API,
  // authorized by PRIVY_AUTHORIZATION_KEY — no browser, no user interaction.
  const ownerAccount = createViemAccount(privy(), {
    walletId,
    address: owner,
    authorizationContext: authorizationContext(),
  });

  const pimlico = createPimlicoClient({
    chain,
    transport: http(url),
    entryPoint: ENTRY_POINT,
  });

  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner: ownerAccount,
    entryPoint: ENTRY_POINT,
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(url),
    paymaster: pimlico,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
    },
  });

  // ownerAccount is exposed so callers can sign EOA typed data (e.g. the Arcus
  // Permit2 intents + USDG permits) with the same delegated Privy wallet.
  return { account, smartAccountClient, ownerAccount };
}
