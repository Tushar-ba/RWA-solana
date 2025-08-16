import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function togglePause() {
  console.log("=== Toggling Contract Pause Status ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  console.log("Admin:", admin.publicKey.toBase58());

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  // Derive config PDA
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log("Config account:", configAccount.toBase58());

  // Check current pause status
  const configBefore = await program.account.config.fetch(configAccount);
  console.log("Current pause status:", configBefore.isPaused);

  try {
    const tx = await program.methods
      .togglePause()
      .accountsPartial({
        config: configAccount,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Pause status toggled successfully!");
    console.log("Transaction signature:", tx);

    // Check new pause status
    const configAfter = await program.account.config.fetch(configAccount);
    console.log("New pause status:", configAfter.isPaused);

    if (configAfter.isPaused) {
      console.log("🔒 Contract is now PAUSED - most operations will be blocked");
    } else {
      console.log("🔓 Contract is now UNPAUSED - operations are allowed");
    }

  } catch (error) {
    console.error("❌ Toggle pause failed:", error);
    throw error;
  }
}

togglePause()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });