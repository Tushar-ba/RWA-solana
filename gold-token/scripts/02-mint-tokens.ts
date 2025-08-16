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
import * as fs from "fs";

async function mintTokens() {
  console.log("=== Minting Gold Tokens ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load other keypairs
  const supplyController = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/supply.json", "utf8"))));
  const user2 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/user2.json", "utf8"))));

  // Get program instance
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  // Derive config PDA and get mint address from config
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const config = await program.account.config.fetch(configAccount);
  const mint = config.mint;

  console.log("Mint:", mint.toBase58());
  console.log("Supply Controller:", supplyController.publicKey.toBase58());
  console.log("Recipient:", user2.publicKey.toBase58());

  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    program.programId
  );

  // Get recipient token account
  const recipientTokenAccount = getAssociatedTokenAddressSync(
    mint,
    user2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("Recipient token account:", recipientTokenAccount.toBase58());

  // Amount to mint (100 tokens with 9 decimals)
  const amount = new BN(100000000000);
  console.log("Minting amount:", amount.toString(), "raw units (100 tokens)");

  // Fund supply controller if needed
  const supplyControllerBalance = await provider.connection.getBalance(supplyController.publicKey);
  if (supplyControllerBalance < 10000000) {
    console.log("Funding supply controller...");
    const fundTx = await provider.connection.requestAirdrop(supplyController.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  // Check balance before minting
  try {
    const balanceBefore = await provider.connection.getTokenAccountBalance(recipientTokenAccount);
    console.log("Balance before mint:", balanceBefore.value.uiAmount, "tokens");
  } catch (error) {
    console.log("Token account doesn't exist yet, will be created during mint");
  }

  try {
    const tx = await program.methods
      .mintTokens(amount, user2.publicKey)
      .accountsPartial({
        config: configAccount,
        supplyController: supplyController.publicKey,
        mint: mint,
        mintAuthorityPda: mintAuthorityPda,
        recipient: user2.publicKey,
        recipientTokenAccount: recipientTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([supplyController])
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

mintTokens()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });