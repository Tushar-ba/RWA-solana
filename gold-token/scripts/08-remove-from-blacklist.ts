import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { TransferHookGatekeeper } from "../target/types/transfer_hook_gatekeeper";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";

async function removeFromBlacklist() {
  console.log("=== Removing Address from Blacklist ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));

  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load other keypairs
  const assetProtection = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/asset.json", "utf8"))));

  // Get program instances
  const program = anchor.workspace.GoldToken as Program<GoldToken>;
  const gatekeeperProgram = anchor.workspace.TransferHookGatekeeper as Program<TransferHookGatekeeper>;

  // Get mint address from config
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const config = await program.account.config.fetch(configAccount);
  const mint = config.mint;

  // Load blacklist info
  const blacklistInfo = JSON.parse(fs.readFileSync("blacklist-info.json", "utf8"));
  const targetAddress = new PublicKey(blacklistInfo.targetAddress);
  const blacklistEntry = new PublicKey(blacklistInfo.blacklistEntry);

  console.log("Mint:", mint.toBase58());
  console.log("Asset Protection:", assetProtection.publicKey.toBase58());
  console.log("Target Address:", targetAddress.toBase58());
  console.log("Blacklist Entry:", blacklistEntry.toBase58());

  // Derive PDAs
  const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.toBuffer()],
    gatekeeperProgram.programId
  );

  console.log("Gatekeeper Config:", gatekeeperConfig.toBase58());

  // Verify blacklist entry exists before removal
  const blacklistAccountInfo = await provider.connection.getAccountInfo(blacklistEntry);
  if (!blacklistAccountInfo) {
    console.log("❌ Address is not on blacklist");
    return;
  }
  console.log("✓ Address is currently blacklisted");

  try {
    // Use direct gatekeeper program call
    const tx = await gatekeeperProgram.methods
      .removeFromBlacklist()
      .accountsPartial({
        config: gatekeeperConfig,
        authority: assetProtection.publicKey,
        targetAddress: targetAddress,
        blacklistEntry: blacklistEntry,
        mint: mint,
      })
      .signers([assetProtection])
      .rpc();

    console.log("✅ Address removed from blacklist successfully!");
    console.log("Transaction signature:", tx);

    // Verify blacklist entry no longer exists
    const blacklistInfoAfter = await provider.connection.getAccountInfo(blacklistEntry);
    console.log("Blacklist entry removed:", !blacklistInfoAfter);

  } catch (error) {
    console.error("❌ Removing from blacklist failed:", error);
    throw error;
  }
}

removeFromBlacklist()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });