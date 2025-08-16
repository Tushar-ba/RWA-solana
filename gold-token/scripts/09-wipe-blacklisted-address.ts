import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { TransferHookGatekeeper } from "../target/types/transfer_hook_gatekeeper";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";

async function wipeBlacklistedAddress() {
  console.log("=== Wiping Tokens from Blacklisted Address ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load other keypairs
  const assetProtection = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/asset.json", "utf8"))));
  const user2 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/user2.json", "utf8"))));

  // Get program instances
  const program = anchor.workspace.GoldToken as Program<GoldToken>;
  const gatekeeperProgram = anchor.workspace.TransferHookGatekeeper as Program<TransferHookGatekeeper>;

  // Get mint address from config
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const config = await program.account.config.fetch(configAccount);
  const mint = config.mint;

  console.log("Mint:", mint.toBase58());
  console.log("Asset Protection:", assetProtection.publicKey.toBase58());
  console.log("Target User:", user2.publicKey.toBase58());

  const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.toBuffer()],
    gatekeeperProgram.programId
  );

  const [blacklistEntry] = PublicKey.findProgramAddressSync(
    [Buffer.from("blacklist"), user2.publicKey.toBuffer()],
    gatekeeperProgram.programId
  );

  // Get target user token account
  const targetTokenAccount = getAssociatedTokenAddressSync(
    mint,
    user2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("Target token account:", targetTokenAccount.toBase58());
  console.log("Blacklist Entry PDA:", blacklistEntry.toBase58());

  // First, add user to blacklist if not already blacklisted
  const blacklistAccountInfo = await provider.connection.getAccountInfo(blacklistEntry);
  if (!blacklistAccountInfo) {
    console.log("Adding user to blacklist first...");
    
    const addTx = await gatekeeperProgram.methods
      .addToBlacklist()
      .accountsPartial({
        config: gatekeeperConfig,
        authority: assetProtection.publicKey,
        targetAddress: user2.publicKey,
        blacklistEntry: blacklistEntry,
        mint: mint,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([assetProtection])
      .rpc();

    console.log("User added to blacklist:", addTx);
  } else {
    console.log("✓ User is already blacklisted");
  }

  // Check token balance before wipe
  const tokenBalanceBefore = await provider.connection.getTokenAccountBalance(targetTokenAccount);
  console.log("Token balance before wipe:", tokenBalanceBefore.value.uiAmount, "tokens");

  // Wipe amount (15 tokens)
  const wipeAmount = new BN(15000000000);
  console.log("Wipe amount:", wipeAmount.toString(), "raw units (15 tokens)");

  try {
    const tx = await program.methods
      .wipeBlacklistedAddress(wipeAmount)
      .accountsPartial({
        config: configAccount,
        assetProtection: assetProtection.publicKey,
        mint: mint,
        targetUser: user2.publicKey,
        targetTokenAccount: targetTokenAccount,
        blacklistEntry: blacklistEntry,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([assetProtection])
      .rpc();

    console.log("✅ Tokens wiped from blacklisted address successfully!");
    console.log("Transaction signature:", tx);

    // Check token balance after wipe
    const tokenBalanceAfter = await provider.connection.getTokenAccountBalance(targetTokenAccount);
    console.log("Token balance after wipe:", tokenBalanceAfter.value.uiAmount, "tokens");

    const wiped = tokenBalanceBefore.value.uiAmount - tokenBalanceAfter.value.uiAmount;
    console.log("Tokens wiped:", wiped, "tokens");

  } catch (error) {
    console.error("❌ Wiping tokens failed:", error);
    throw error;
  }
}

wipeBlacklistedAddress()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });