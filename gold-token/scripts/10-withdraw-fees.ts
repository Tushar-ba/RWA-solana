import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import * as fs from "fs";

async function withdrawFees() {
  console.log("=== Withdrawing Transfer Fees ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load other keypairs
  const feeController = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/fee.json", "utf8"))));

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
  console.log("Fee Controller:", feeController.publicKey.toBase58());

  // Get fee controller's token account
  const feeControllerTokenAccount = getAssociatedTokenAddressSync(
    mint,
    feeController.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("Fee controller token account:", feeControllerTokenAccount.toBase58());

  // Fund fee controller if needed
  const feeControllerBalance = await provider.connection.getBalance(feeController.publicKey);
  if (feeControllerBalance < 10000000) {
    console.log("Funding fee controller account...");
    const fundTx = await provider.connection.requestAirdrop(feeController.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  // Check fee controller balance before withdrawal
  try {
    const balanceBefore = await provider.connection.getTokenAccountBalance(feeControllerTokenAccount);
    console.log("Fee controller balance before withdrawal:", balanceBefore.value.uiAmount, "tokens");
  } catch (error) {
    console.log("Fee controller token account doesn't exist yet, will be created during withdrawal");
  }

  try {
    const tx = await program.methods
      .withdrawWithheldTokensFromMint()
      .accountsPartial({
        config: configAccount,
        feeController: feeController.publicKey,
        mint: mint,
        destinationTokenAccount: feeControllerTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([feeController])
      .rpc();

    console.log("✅ Fees withdrawn successfully!");
    console.log("Transaction signature:", tx);

    // Check fee controller balance after withdrawal
    const balanceAfter = await provider.connection.getTokenAccountBalance(feeControllerTokenAccount);
    console.log("Fee controller balance after withdrawal:", balanceAfter.value.uiAmount, "tokens");

  } catch (error) {
    console.error("❌ Fee withdrawal failed:", error);
    if (error.message.includes("InsufficientFunds") || error.message.includes("no fees")) {
      console.log("💡 No fees accumulated yet to withdraw - this is normal if few transfers have been made");
    } else {
      throw error;
    }
  }
}

withdrawFees()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });