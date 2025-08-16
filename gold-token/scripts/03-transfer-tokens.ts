import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction
} from "@solana/spl-token";
import * as fs from "fs";

async function transferTokens() {
  console.log("=== Transferring Gold Tokens ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load other keypairs
  const user2 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/user2.json", "utf8"))));

  // Get program instance (needed before using it)
  const program = anchor.workspace.GoldToken as Program<GoldToken>;

  // Get mint address from config
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const config = await program.account.config.fetch(configAccount);
  const mint = config.mint;

  console.log("Mint:", mint.toBase58());
  console.log("From (user2):", user2.publicKey.toBase58());
  console.log("To (admin):", admin.publicKey.toBase58());

  // Get token accounts
  const fromTokenAccount = getAssociatedTokenAddressSync(
    mint,
    user2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const toTokenAccount = getAssociatedTokenAddressSync(
    mint,
    admin.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("From token account:", fromTokenAccount.toBase58());
  console.log("To token account:", toTokenAccount.toBase58());

  // Fund user2 if needed
  const user2Balance = await provider.connection.getBalance(user2.publicKey);
  if (user2Balance < 10000000) {
    console.log("Funding user2...");
    const fundTx = await provider.connection.requestAirdrop(user2.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  // Create destination token account if needed
  const toAccountInfo = await provider.connection.getAccountInfo(toTokenAccount);
  if (!toAccountInfo) {
    console.log("Creating destination token account...");
    const createAccountTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        user2.publicKey,
        toTokenAccount,
        admin.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    
    const createTxSig = await provider.connection.sendTransaction(createAccountTx, [user2]);
    await provider.connection.confirmTransaction(createTxSig, 'confirmed');
    console.log("Destination token account created");
  }

  // Transfer amount (10 tokens)
  const transferAmount = 10 * 10 ** 9;
  console.log("Transfer amount:", transferAmount / 10**9, "tokens");

  // Check balances before transfer
  const fromBalanceBefore = await provider.connection.getTokenAccountBalance(fromTokenAccount);
  console.log("From balance before:", fromBalanceBefore.value.uiAmount, "tokens");

  try {
    const toBalanceBefore = await provider.connection.getTokenAccountBalance(toTokenAccount);
    console.log("To balance before:", toBalanceBefore.value.uiAmount, "tokens");
  } catch (error) {
    console.log("To balance before: 0 tokens (new account)");
  }

  try {
    // Create transfer instruction with transfer hook
    const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      fromTokenAccount,
      mint,
      toTokenAccount,
      user2.publicKey,
      BigInt(transferAmount),
      9,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Transfer instruction created with", transferInstruction.keys.length, "accounts");

    const transaction = new anchor.web3.Transaction().add(transferInstruction);
    
    const tx = await provider.connection.sendTransaction(transaction, [user2], {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    await provider.connection.confirmTransaction(tx, 'confirmed');
    console.log("✅ Transfer successful!");
    console.log("Transaction signature:", tx);

    // Check balances after transfer
    const fromBalanceAfter = await provider.connection.getTokenAccountBalance(fromTokenAccount);
    const toBalanceAfter = await provider.connection.getTokenAccountBalance(toTokenAccount);
    
    console.log("From balance after:", fromBalanceAfter.value.uiAmount, "tokens");
    console.log("To balance after:", toBalanceAfter.value.uiAmount, "tokens");

  } catch (error) {
    console.error("❌ Transfer failed:", error);
    if (error.logs) {
      console.log("Transaction logs:");
      error.logs.forEach((log, index) => {
        console.log(`${index}: ${log}`);
      });
    }
    throw error;
  }
}

transferTokens()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });