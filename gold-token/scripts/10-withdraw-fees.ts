import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync,
  unpackAccount,
  getTransferFeeAmount,
  withdrawWithheldTokensFromAccounts,
  createAssociatedTokenAccountInstruction
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
  console.log("Fee Controller:", feeController.publicKey.toBase58());
  console.log("User2:", user2.publicKey.toBase58());

  // Get fee controller's token account (destination for fees)
  const feeControllerTokenAccount = getAssociatedTokenAddressSync(
    mint,
    feeController.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Get user2's token account (source of fees)
  const user2TokenAccount = getAssociatedTokenAddressSync(
    mint,
    user2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("Fee controller token account:", feeControllerTokenAccount.toBase58());
  console.log("User2 token account:", user2TokenAccount.toBase58());

  // Fund fee controller if needed
  const feeControllerBalance = await provider.connection.getBalance(feeController.publicKey);
  if (feeControllerBalance < 10000000) {
    console.log("Funding fee controller account...");
    const fundTx = await provider.connection.requestAirdrop(feeController.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  // Check if fee controller token account exists, create if not
  try {
    const feeControllerAccountInfo = await provider.connection.getAccountInfo(feeControllerTokenAccount);
    if (!feeControllerAccountInfo) {
      console.log("Creating fee controller token account...");
      
      // Create ATA instruction
      const createAtaIx = createAssociatedTokenAccountInstruction(
        feeController.publicKey, // payer
        feeControllerTokenAccount, // associated token account
        feeController.publicKey, // owner
        mint, // mint
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Create and send transaction
      const createAtaTx = await provider.connection.sendTransaction(
        new anchor.web3.Transaction().add(createAtaIx),
        [feeController]
      );
      await provider.connection.confirmTransaction(createAtaTx);
      console.log("Fee controller ATA created:", createAtaTx);
    }
  } catch (error) {
    console.log("Fee controller token account doesn't exist, will be created during withdrawal");
  }

  try {
    // Retrieve all Token Accounts for the Mint Account
    console.log("Retrieving all token accounts for the mint...");
    const allAccounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: mint.toString(), // Mint Account address
          },
        },
      ],
    });

    console.log(`Found ${allAccounts.length} token accounts for the mint`);

    // List of Token Accounts to withdraw fees from
    const accountsToWithdrawFrom = [];
    for (const accountInfo of allAccounts) {
      try {
        const account = unpackAccount(
          accountInfo.pubkey, // Token Account address
          accountInfo.account, // Token Account data
          TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        // Extract transfer fee data from each account
        const transferFeeAmount = getTransferFeeAmount(account);
        // Check if fees are available to be withdrawn
        if (transferFeeAmount !== null && transferFeeAmount.withheldAmount > 0) {
          console.log(`Account ${accountInfo.pubkey.toBase58()} has ${transferFeeAmount.withheldAmount} withheld fees`);
          accountsToWithdrawFrom.push(accountInfo.pubkey); // Add account to withdrawal list
        }
      } catch (error) {
        // Skip accounts that can't be unpacked
        continue;
      }
    }

    if (accountsToWithdrawFrom.length === 0) {
      console.log("💡 No accounts with withheld fees found");
      return;
    }

    console.log(`Found ${accountsToWithdrawFrom.length} accounts with withheld fees to withdraw from`);

    // Withdraw withheld tokens from Token Accounts
    const transactionSignature = await withdrawWithheldTokensFromAccounts(
      connection,
      feeController, // Transaction fee payer and authority
      mint, // Mint Account address
      feeControllerTokenAccount, // Destination account for fee withdrawal
      feeController.publicKey, // Authority for fee withdrawal
      [], // Additional signers (empty array instead of undefined)
      accountsToWithdrawFrom, // Token Accounts to withdrawal from
      undefined, // Confirmation options
      TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
    );

    console.log("✅ Fees withdrawn successfully!");
    console.log("Transaction signature:", transactionSignature);
    console.log(`Transaction URL: https://solana.fm/tx/${transactionSignature}?cluster=devnet-solana`);

    // Check fee controller balance after withdrawal
    try {
      const balanceAfter = await provider.connection.getTokenAccountBalance(feeControllerTokenAccount);
      console.log("Fee controller balance after withdrawal:", balanceAfter.value.uiAmount, "tokens");
    } catch (error) {
      console.log("Could not fetch fee controller balance after withdrawal");
    }

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