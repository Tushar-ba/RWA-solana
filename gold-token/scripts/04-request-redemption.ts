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

async function requestRedemption() {
  console.log("=== Requesting Token Redemption ===");

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
  console.log("Redemption PDA:", redemptionPda.toBase58());

  // Redemption amount (20 tokens)
  const redemptionAmount = new BN(20000000000);
  console.log("Redemption amount:", redemptionAmount.toString(), "raw units (20 tokens)");

  // Fund user if needed
  const userBalance = await provider.connection.getBalance(user2.publicKey);
  if (userBalance < 10000000) {
    console.log("Funding user...");
    const fundTx = await provider.connection.requestAirdrop(user2.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  // Check token balance before redemption request
  const tokenBalance = await provider.connection.getTokenAccountBalance(userTokenAccount);
  console.log("Token balance before redemption:", tokenBalance.value.uiAmount, "tokens");

  try {
    const tx = await program.methods
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

    console.log("✅ Redemption request created successfully!");
    console.log("Transaction signature:", tx);
    console.log("Request ID:", nextRequestId);

    // Verify the request was created
    const requestData = await program.account.redemptionRequest.fetch(redemptionRequest);
    console.log("Redemption request details:");
    console.log("  - Request ID:", requestData.requestId);
    console.log("  - Amount:", requestData.amount.toString());
    console.log("  - Status:", requestData.status);
    console.log("  - User:", requestData.user.toBase58());

    // Save request info for other scripts
    const requestInfo = {
      requestId: nextRequestId,
      user: user2.publicKey.toBase58(),
      redemptionRequest: redemptionRequest.toBase58(),
      redemptionPda: redemptionPda.toBase58()
    };
    fs.writeFileSync("redemption-request.json", JSON.stringify(requestInfo, null, 2));
    console.log("Request info saved to redemption-request.json");

  } catch (error) {
    console.error("❌ Redemption request failed:", error);
    throw error;
  }
}

requestRedemption()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });