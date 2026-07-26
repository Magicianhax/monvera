// Finalize the staking ownership handoff — run with the COLD key.
//
// The deploy set the cold key as PENDING owner of the registry + distributor
// (Ownable2Step). This accepts it, so a hot key is never the resting owner. Run:
//   COLD_PK=0x<cold private key> node scripts/accept-ownership.mjs
// The key is read from env and used only to sign these two txs; nothing is logged.
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

const EXPECTED_COLD = "0xca0c8c28EC2f352649B3b9D2b8C673E6254142D6";
const CONTRACTS = {
  GroveCuratorRegistry: "0xe1882878df4e39566abea9ef9200d73dba83a0cf",
  SeasonDistributor: "0xe51658ee2fed7ae09b81a91e2e0ffc6698648163",
};
const abi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function acceptOwnership()",
]);

async function main() {
  const pk = (process.env.COLD_PK ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("set COLD_PK to the cold key's private key");
  const account = privateKeyToAccount(pk);
  if (getAddress(account.address) !== getAddress(EXPECTED_COLD)) {
    throw new Error(`COLD_PK is ${account.address}, expected ${EXPECTED_COLD} — wrong key, aborting.`);
  }
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wc = createWalletClient({ account, chain, transport: http(RPC) });
  console.log(`accepting ownership as ${account.address}\n`);

  for (const [name, address] of Object.entries(CONTRACTS)) {
    const pending = await pub.readContract({ address, abi, functionName: "pendingOwner" });
    if (getAddress(pending) !== getAddress(account.address)) {
      console.log(`  ${name}: pendingOwner is ${pending}, not us — skipping (already accepted?)`);
      continue;
    }
    const hash = await wc.writeContract({ address, abi, functionName: "acceptOwnership", chain, account });
    await pub.waitForTransactionReceipt({ hash });
    const owner = await pub.readContract({ address, abi, functionName: "owner" });
    console.log(`  ${name}: owner now ${owner}  ${getAddress(owner) === getAddress(account.address) ? "✓" : "✗"}  (tx ${hash})`);
  }
  console.log(`\nDone. The cold key now owns both contracts; the deployer is fully out.`);
}
main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
