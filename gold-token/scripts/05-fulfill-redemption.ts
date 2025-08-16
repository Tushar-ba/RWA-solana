import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import * as fs from "fs";

async function fulfillRedemption() {
  console.log("=== Fulfilling Token Redemption ===");

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

  // Get mint address from config
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const config = await program.account.config.fetch(configAccount);
  const mint = config.mint;

  // Load redemption request info
  const requestInfo = JSON.parse(fs.readFileSync("redemption-request.json", "utf8"));
  const user = new PublicKey(requestInfo.user);
  const redemptionRequest = new PublicKey(requestInfo.redemptionRequest);
  const redemptionPda = new PublicKey(requestInfo.redemptionPda);

  console.log("Mint:", mint.toBase58());
  console.log("Supply Controller:", supplyController.publicKey.toBase58());
  console.log("User:", user.toBase58());
  console.log("Redemption Request:", redemptionRequest.toBase58());

  // Get user token account
  const userTokenAccount = getAssociatedTokenAddressSync(
    mint,
    user,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("User token account:", userTokenAccount.toBase58());

  // Fund supply controller if needed
  const supplyControllerBalance = await provider.connection.getBalance(supplyController.publicKey);
  if (supplyControllerBalance < 10000000) {
    console.log("Funding supply controller...");
    const fundTx = await provider.connection.requestAirdrop(supplyController.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  // Check token balance before fulfillment
  const tokenBalanceBefore = await provider.connection.getTokenAccountBalance(userTokenAccount);
  console.log("Token balance before fulfillment:", tokenBalanceBefore.value.uiAmount, "tokens");

  // Get redemption request details
  const requestData = await program.account.redemptionRequest.fetch(redemptionRequest);
  console.log("Redemption request details:");
  console.log("  - Request ID:", requestData.requestId);
  console.log("  - Amount:", requestData.amount.toString());
  console.log("  - Status:", requestData.status);

  try {
    const tx = await program.methods
      .fulfillRedemption()
      .accountsPartial({
        config: configAccount,
        supplyController: supplyController.publicKey,
        redemptionRequest: redemptionRequest,
        mint: mint,
        userTokenAccount: userTokenAccount,
        user: user,
        redemptionPda: redemptionPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([supplyController])
      .rpc();

    console.log("✅ Redemption fulfilled successfully!");
    console.log("Transaction signature:", tx);

    // Check token balance after fulfillment
    const tokenBalanceAfter = await provider.connection.getTokenAccountBalance(userTokenAccount);
    console.log("Token balance after fulfillment:", tokenBalanceAfter.value.uiAmount, "tokens");

    console.log("Tokens have been burned from user account");

  } catch (error) {
    console.error("❌ Redemption fulfillment failed:", error);
    throw error;
  }
}

fulfillRedemption()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });