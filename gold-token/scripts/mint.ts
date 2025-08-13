import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

async function mintTokens() {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const goldTokenProgram = anchor.workspace.GoldToken as Program<GoldToken>;

  // ============================================
  // CONFIGURATION - Replace with your addresses
  // ============================================
  const CONFIG_PDA = new PublicKey("3oN9az3bVpmQWPUgkzRGowYzeGnE9dZuxthmf3ShMt2u");
  const MINT_ADDRESS = new PublicKey("FAESU8Ks782mg4bd7eoMmXaY3ZVqaTDGpydoL1VDw24");
  const MINT_AUTHORITY_PDA = new PublicKey("FeYAcs3joh6YKp7tKc6BjqbZf3KNhfbUYGCWyMAhSHqA");
  
  // Supply Controller - Replace with your saved keypair
  const SUPPLY_CONTROLLER_SECRET = [115,166,50,109,115,25,36,12,55,90,139,191,63,185,252,61,108,183,151,85,246,178,16,115,165,113,240,131,50,209,94,49,227,136,132,63,161,234,91,42,148,132,76,42,33,209,25,118,116,92,246,246,90,85,86,89,12,15,141,94,202,173,222,194];
  const supplyController = Keypair.fromSecretKey(new Uint8Array(SUPPLY_CONTROLLER_SECRET));

  // ============================================
  // MINT PARAMETERS
  // ============================================
  const AMOUNT_TO_MINT = 1000; // 1000 tokens (with 9 decimals = 1000.000000000)
  
  // Create a recipient (or use existing wallet)
  const recipient = Keypair.generate(); // Generate new user
  // const recipient = new PublicKey("EXISTING_USER_ADDRESS"); // Or use existing address

  console.log("=== MINTING GOLD TOKENS ===");
  console.log("Config PDA:", CONFIG_PDA.toString());
  console.log("Mint Address:", MINT_ADDRESS.toString());
  console.log("Supply Controller:", supplyController.publicKey.toString());
  console.log("Recipient:", recipient.publicKey.toString());
  console.log("Amount to mint:", AMOUNT_TO_MINT);

  // ============================================
  // DERIVE ASSOCIATED TOKEN ACCOUNT
  // ============================================
  const recipientTokenAccount = await getAssociatedTokenAddress(
    MINT_ADDRESS,
    recipient.publicKey,
    false, // allowOwnerOffCurve
    TOKEN_2022_PROGRAM_ID
  );

  console.log("Recipient Token Account:", recipientTokenAccount.toString());

  // ============================================
  // MINT TOKENS
  // ============================================
  try {
    const tx = await goldTokenProgram.methods
      .mintTokens(
        new BN(AMOUNT_TO_MINT * 10**9), // Convert to smallest unit (9 decimals)
        recipient.publicKey
      )
      .accounts({
        config: CONFIG_PDA,
        supplyController: supplyController.publicKey,
        mint: MINT_ADDRESS,
        mintAuthorityPda: MINT_AUTHORITY_PDA,
        recipient: recipient.publicKey,
        recipientTokenAccount: recipientTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([supplyController]) // Supply controller must sign
      .rpc();

    console.log("\n🎉 MINT SUCCESS!");
    console.log("Transaction signature:", tx);
    console.log("\n=== RESULTS ===");
    console.log("✅ Minted", AMOUNT_TO_MINT, "GOLD tokens");
    console.log("✅ To recipient:", recipient.publicKey.toString());
    console.log("✅ Token account:", recipientTokenAccount.toString());

    // ============================================
    // SAVE RECIPIENT INFO
    // ============================================
    console.log("\n=== SAVE RECIPIENT INFO ===");
    console.log("Recipient Public Key:", recipient.publicKey.toString());
    console.log("Recipient Secret Key:", JSON.stringify(Array.from(recipient.secretKey)));
    
  } catch (error) {
    console.error("❌ Mint failed:", error);
    
    // Check if error is due to insufficient funds for account creation
    if (error.message?.includes("insufficient lamports")) {
      console.log("\n💡 TIP: Make sure the supply controller has enough SOL for:");
      console.log("  - Transaction fees");
      console.log("  - Associated token account creation (~0.002 SOL)");
      console.log("  - Run: solana airdrop 1 " + supplyController.publicKey.toString());
    }
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Function to mint to multiple recipients
async function mintToMultipleUsers() {
  console.log("=== BATCH MINTING ===");
  
  const recipients = [
    { name: "Alice", amount: 1000 },
    { name: "Bob", amount: 500 },
    { name: "Charlie", amount: 2000 }
  ];

  for (const { name, amount } of recipients) {
    console.log(`\nMinting ${amount} tokens to ${name}...`);
    // Call mintTokens() with different parameters
    // Implementation similar to above
  }
}

// Function to check token balance
async function checkBalance(tokenAccount: PublicKey) {
  try {
    const provider = anchor.AnchorProvider.env();
    const accountInfo = await provider.connection.getTokenAccountBalance(tokenAccount);
    console.log("Token Balance:", accountInfo.value.uiAmount, "GOLD");
    return accountInfo.value.uiAmount;
  } catch (error) {
    console.log("Token account doesn't exist or error:", error.message);
    return 0;
  }
}

// Run the mint function
mintTokens().catch(console.error);