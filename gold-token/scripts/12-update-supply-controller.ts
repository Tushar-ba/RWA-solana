import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function updateSupplyController() {
  console.log("=== Updating Supply Controller ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load new supply controller keypair
  const newSupplyController = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/newsupply.json", "utf8"))));

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("New Supply Controller:", newSupplyController.publicKey.toBase58());

  // Derive config PDA
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log("Config account:", configAccount.toBase58());

  // Check current supply controller
  const configBefore = await program.account.config.fetch(configAccount);
  console.log("Current supply controller:", configBefore.supplyController.toBase58());

  try {
    const tx = await program.methods
      .updateSupplyController(newSupplyController.publicKey)
      .accountsPartial({
        config: configAccount,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Supply controller updated successfully!");
    console.log("Transaction signature:", tx);

    // Check new supply controller
    const configAfter = await program.account.config.fetch(configAccount);
    console.log("New supply controller:", configAfter.supplyController.toBase58());

    console.log("✅ Supply controller updated to use existing newsupply.json keypair");

  } catch (error) {
    console.error("❌ Update supply controller failed:", error);
    throw error;
  }
}

updateSupplyController()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });