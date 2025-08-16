import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function setRedemptionProcessing() {
  console.log("=== Setting Redemption to Processing Status ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load other keypairs
  const supplyController = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/supply.json", "utf8"))));

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  // Load redemption request info
  const requestInfo = JSON.parse(fs.readFileSync("redemption-request.json", "utf8"));
  const redemptionRequest = new PublicKey(requestInfo.redemptionRequest);

  console.log("Supply Controller:", supplyController.publicKey.toBase58());
  console.log("Redemption Request:", redemptionRequest.toBase58());

  // Derive config PDA
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  // Check current redemption request status
  const requestData = await program.account.redemptionRequest.fetch(redemptionRequest);
  console.log("Current redemption status:", requestData.status);
  console.log("Request ID:", requestData.requestId);
  console.log("Amount:", requestData.amount.toString());

  if (!("pending" in requestData.status)) {
    console.log("❌ Redemption request is not in Pending status");
    return;
  }

  try {
    const tx = await program.methods
      .setRedemptionProcessing()
      .accountsPartial({
        config: configAccount,
        supplyController: supplyController.publicKey,
        redemptionRequest: redemptionRequest,
      })
      .signers([supplyController])
      .rpc();

    console.log("✅ Redemption status set to Processing successfully!");
    console.log("Transaction signature:", tx);

    // Check new redemption request status
    const requestDataAfter = await program.account.redemptionRequest.fetch(redemptionRequest);
    console.log("New redemption status:", requestDataAfter.status);

  } catch (error) {
    console.error("❌ Setting redemption to processing failed:", error);
    throw error;
  }
}

setRedemptionProcessing()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });