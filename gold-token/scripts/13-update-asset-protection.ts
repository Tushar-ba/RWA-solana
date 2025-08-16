import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function updateAssetProtection() {
  console.log("=== Updating Asset Protection ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load new asset protection keypair
  const newAssetProtection = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/newAsset.json", "utf8"))));

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("New Asset Protection:", newAssetProtection.publicKey.toBase58());

  // Derive config PDA
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log("Config account:", configAccount.toBase58());

  // Check current asset protection
  const configBefore = await program.account.config.fetch(configAccount);
  console.log("Current asset protection:", configBefore.assetProtection.toBase58());

  try {
    const tx = await program.methods
      .updateAssetProtection(newAssetProtection.publicKey)
      .accountsPartial({
        config: configAccount,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Asset protection updated successfully!");
    console.log("Transaction signature:", tx);

    // Check new asset protection
    const configAfter = await program.account.config.fetch(configAccount);
    console.log("New asset protection:", configAfter.assetProtection.toBase58());

    console.log("✅ Asset protection updated to use existing newAsset.json keypair");

  } catch (error) {
    console.error("❌ Update asset protection failed:", error);
    throw error;
  }
}

updateAssetProtection()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });