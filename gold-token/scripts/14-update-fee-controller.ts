import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function updateFeeController() {
  console.log("=== Updating Fee Controller ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load new fee controller keypair
  const newFeeController = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/newfee.json", "utf8"))));

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("New Fee Controller:", newFeeController.publicKey.toBase58());

  // Derive config PDA
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log("Config account:", configAccount.toBase58());

  // Check current fee controller
  const configBefore = await program.account.config.fetch(configAccount);
  console.log("Current fee controller:", configBefore.feeController.toBase58());

  try {
    const tx = await program.methods
      .updateFeeController(newFeeController.publicKey)
      .accountsPartial({
        config: configAccount,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Fee controller updated successfully!");
    console.log("Transaction signature:", tx);

    // Check new fee controller
    const configAfter = await program.account.config.fetch(configAccount);
    console.log("New fee controller:", configAfter.feeController.toBase58());

    console.log("✅ Fee controller updated to use existing newfee.json keypair");

  } catch (error) {
    console.error("❌ Update fee controller failed:", error);
    throw error;
  }
}

updateFeeController()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });