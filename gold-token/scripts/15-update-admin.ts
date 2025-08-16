import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function updateAdmin() {
  console.log("=== Updating Admin ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Generate new admin or use existing one
  const newAdmin = Keypair.generate();

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  console.log("Current Admin:", admin.publicKey.toBase58());
  console.log("New Admin:", newAdmin.publicKey.toBase58());

  // Derive config PDA
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log("Config account:", configAccount.toBase58());

  // Check current admin
  const configBefore = await program.account.config.fetch(configAccount);
  console.log("Current admin in config:", configBefore.admin.toBase58());

  try {
    const tx = await program.methods
      .updateAdmin(newAdmin.publicKey)
      .accountsPartial({
        config: configAccount,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Admin updated successfully!");
    console.log("Transaction signature:", tx);

    // Check new admin
    const configAfter = await program.account.config.fetch(configAccount);
    console.log("New admin in config:", configAfter.admin.toBase58());

    // Save new admin keypair
    fs.writeFileSync("new-admin.json", JSON.stringify(Array.from(newAdmin.secretKey)));
    console.log("New admin keypair saved to new-admin.json");

    console.log("⚠️  WARNING: Admin has been changed! Use the new admin keypair for future admin operations.");

  } catch (error) {
    console.error("❌ Update admin failed:", error);
    throw error;
  }
}

updateAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });