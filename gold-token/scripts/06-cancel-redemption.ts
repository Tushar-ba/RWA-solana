import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";

async function cancelRedemption() {
  console.log("=== Cancelling Token Redemption ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load other keypairs
  const user2 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/user2.json", "utf8"))));

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  // Get mint address from config
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const config = await program.account.config.fetch(configAccount);
  const mint = config.mint;

  console.log("Mint:", mint.toBase58());
  console.log("User:", user2.publicKey.toBase58());

  // Get current config to determine next request ID
  const nextRequestId = config.redemptionRequestCounter.toNumber() + 1;

  const [redemptionRequest] = PublicKey.findProgramAddressSync(
    [Buffer.from("redemption_request"), user2.publicKey.toBuffer(), new BN(nextRequestId).toBuffer("le", 8)],
    program.programId
  );

  const [redemptionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("redemption_pda"), user2.publicKey.toBuffer(), new BN(nextRequestId).toBuffer("le", 8)],
    program.programId
  );

  // Get user token account
  const userTokenAccount = getAssociatedTokenAddressSync(
    mint,
    user2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("User token account:", userTokenAccount.toBase58());
  console.log("Redemption request PDA:", redemptionRequest.toBase58());

  // Fund user if needed
  const userBalance = await provider.connection.getBalance(user2.publicKey);
  if (userBalance < 10000000) {
    console.log("Funding user...");
    const fundTx = await provider.connection.requestAirdrop(user2.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  // First create a redemption request to cancel
  const redemptionAmount = new BN(10000000000); // 10 tokens
  console.log("Creating redemption request to cancel...");

  try {
    // Create redemption request
    const createTx = await program.methods
      .requestRedemption(redemptionAmount)
      .accountsPartial({
        user: user2.publicKey,
        config: configAccount,
        redemptionRequest: redemptionRequest,
        userTokenAccount: userTokenAccount,
        mint: mint,
        redemptionPda: redemptionPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    console.log("Redemption request created:", createTx);

    // Now cancel the redemption
    console.log("Cancelling redemption request...");

    const cancelTx = await program.methods
      .cancelRedemption()
      .accountsPartial({
        user: user2.publicKey,
        redemptionRequest: redemptionRequest,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    console.log("✅ Redemption cancelled successfully!");
    console.log("Cancel transaction signature:", cancelTx);

  } catch (error) {
    console.error("❌ Redemption cancellation failed:", error);
    throw error;
  }
}

cancelRedemption()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });