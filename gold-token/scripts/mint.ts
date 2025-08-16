import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

async function mintTokens() {
  console.log("=== Minting Gold Tokens ===");

  // Setup provider from local environment
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // Load program
  const program = anchor.workspace.GoldToken as Program<GoldToken>;
  

  const MINT_ADDRESS = "YOUR_MINT_ADDRESS_HERE"; // 
  const SUPPLY_CONTROLLER_PRIVATE_KEY = ""; // Replace with actual key
  
  // If you don't have the private key, generate a new supply controller and update config
  const supplyController = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(SUPPLY_CONTROLLER_PRIVATE_KEY))
  );
  
  const mint = new PublicKey(MINT_ADDRESS);
  
  // Derive config account
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  // Derive mint authority PDA
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    program.programId
  );

  // Recipient (can be any address, using CLI wallet here)
  const recipient = provider.wallet.publicKey;
  console.log("Minting to recipient:", recipient.toBase58());

  // Calculate recipient's token account address
  const recipientTokenAccount = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false, // allowOwnerOffCurve
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("Recipient token account:", recipientTokenAccount.toBase58());

  // Amount to mint (100 tokens with 9 decimals)
  const amount = new BN(100_000_000_000);
  console.log("Minting amount:", amount.toString(), "raw units (100 tokens)");

  // Fund supply controller if needed
  const supplyControllerBalance = await provider.connection.getBalance(supplyController.publicKey);
  if (supplyControllerBalance < 10_000_000) { // Less than 0.01 SOL
    console.log("Funding supply controller...");
    const fundTx = await provider.connection.requestAirdrop(
      supplyController.publicKey,
      1_000_000_000 // 1 SOL
    );
    await provider.connection.confirmTransaction(fundTx);
    console.log("Supply controller funded");
  }

  // Check balance before minting
  try {
    const balanceBefore = await provider.connection.getTokenAccountBalance(recipientTokenAccount);
    console.log("Balance before mint:", balanceBefore.value.uiAmount, "tokens");
  } catch (error) {
    console.log("Token account doesn't exist yet, will be created during mint");
  }

  try {
    // Execute mint transaction
    const tx = await program.methods
      .mintTokens(amount, recipient) // Amount and intended recipient
      .accountsPartial({
        config: configAccount,
        supplyController: supplyController.publicKey, // Must match the one in config
        mint: mint,
        mintAuthorityPda: mintAuthorityPda, // PDA that has mint authority
        recipient: recipient,
        recipientTokenAccount: recipientTokenAccount, // Where tokens will be minted to
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([
        supplyController // Supply controller must sign to authorize minting
      ])
      .rpc();

    console.log("✅ Tokens minted successfully!");
    console.log("Transaction signature:", tx);

    // Check balance after minting
    const balanceAfter = await provider.connection.getTokenAccountBalance(recipientTokenAccount);
    console.log("Balance after mint:", balanceAfter.value.uiAmount, "tokens");

  } catch (error) {
    console.error("❌ Minting failed:", error);
    throw error;
  }
}

// Run the script
mintTokens()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });