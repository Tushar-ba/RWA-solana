import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

// Admin keypair for initialization
const ADMIN_SECRET = [36,158,144,127,107,25,26,208,83,230,35,72,99,45,54,226,143,5,164,6,48,7,237,15,217,109,130,35,13,23,74,226,85,236,23,97,197,191,171,102,224,176,126,201,90,100,87,222,253,112,236,100,21,97,195,15,124,60,14,228,38,121,110,170];
const admin = Keypair.fromSecretKey(new Uint8Array(ADMIN_SECRET));

async function setupProvider() {
  // Configure for devnet
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  return { connection, provider };
}

async function initializeGoldToken() {
  console.log("🚀 Starting Gold Token Initialization...\n");
  
  const { connection, provider } = await setupProvider();
  const program = anchor.workspace.GoldToken as Program<GoldToken>;
  
  // Generate new mint keypair
  const mint = Keypair.generate();
  console.log("🪙 Mint Address:", mint.publicKey.toString());
  
  // Define role authorities
  const supplyController = Keypair.generate();
  const assetProtection = Keypair.generate();
  const feeController = Keypair.generate();
  
  console.log("👑 Admin:", admin.publicKey.toString());
  console.log("📈 Supply Controller:", supplyController.publicKey.toString());
  console.log("🛡️ Asset Protection:", assetProtection.publicKey.toString());
  console.log("💰 Fee Controller:", feeController.publicKey.toString());
  
  // Derive PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    program.programId
  );
  
  // Gatekeeper program ID (from your transfer hook program)
  const gatekeeperProgramId = new PublicKey("CsMsG5FueDqKdmZ1THbBRhvN2NXkDVsaHCABDsfmL4Ld");
  
  const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.publicKey.toBuffer()],
    gatekeeperProgramId
  );
  
  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    gatekeeperProgramId
  );
  
  console.log("📍 Config PDA:", configPda.toString());
  console.log("🔑 Mint Authority PDA:", mintAuthorityPda.toString());
  console.log("🔒 Gatekeeper Config:", gatekeeperConfig.toString());
  console.log("📋 Extra Account Meta List:", extraAccountMetaList.toString());
  
  // Check if accounts already exist
  console.log("\n🔍 Checking for existing accounts...");
  const configExists = await checkAccountExists(connection, configPda);
  const gatekeeperConfigExists = await checkAccountExists(connection, gatekeeperConfig);
  const extraAccountMetaListExists = await checkAccountExists(connection, extraAccountMetaList);
  
  if (configExists) {
    console.log("❌ Token already initialized! Config PDA already exists.");
    console.log("💡 If you want to initialize a fresh token, please:");
    console.log("   1. Use a different program ID, or");
    console.log("   2. Use a different admin account, or");
    console.log("   3. Reset your local validator state");
    return;
  }
  
  if (gatekeeperConfigExists && extraAccountMetaListExists) {
    console.log("⚠️ Gatekeeper already configured - this will fail. Please use a fresh mint address or reset your local state.");
    console.log("💡 Try running: solana-test-validator --reset");
    return;
  }
  
  try {
    console.log("\n📝 Initializing Gold Token...");
    
    // Token parameters
    const transferFeeBasisPoints = 20; // 0.2% fee
    const maximumFee = new BN(1_000_000_000); // 1 token maximum fee (9 decimals)
    
    const txSignature = await program.methods
      .initialize(
        "Gold Token",           // name
        "GOLD",                // symbol  
        "https://gold-token.example.com/metadata.json", // uri
        transferFeeBasisPoints, // transfer fee basis points
        maximumFee             // maximum fee
      )
      .accounts({
        admin: admin.publicKey,
        supplyController: supplyController.publicKey,
        assetProtection: assetProtection.publicKey,
        feeController: feeController.publicKey,
        gatekeeperProgram: gatekeeperProgramId,
        config: configPda,
        gatekeeperConfig: gatekeeperConfig,
        extraAccountMetaList: extraAccountMetaList,
        mint: mint.publicKey,
        mintAuthorityPda: mintAuthorityPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin, mint, assetProtection])
      .rpc();
    
    console.log("✅ Initialization successful!");
    console.log("📝 Transaction signature:", txSignature);
    
    // Verify the mint was created with extensions
    console.log("\n=== VERIFICATION ===");
    const mintAccount = await connection.getAccountInfo(mint.publicKey);
    if (mintAccount) {
      console.log("✅ Mint account created");
      console.log("📊 Mint account owner:", mintAccount.owner.toString());
      console.log("📏 Mint account size:", mintAccount.data.length, "bytes");
      
      // Check if it's Token-2022
      if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        console.log("✅ Created with Token-2022 program (extensions supported)");
      } else {
        console.log("⚠️ Created with standard Token program (no extensions)");
      }
    }
    
    // Display all important addresses
    console.log("\n=== IMPORTANT ADDRESSES ===");
    console.log("🪙 Mint:", mint.publicKey.toString());
    console.log("📍 Config PDA:", configPda.toString());
    console.log("🔑 Mint Authority PDA:", mintAuthorityPda.toString());
    console.log("👑 Admin:", admin.publicKey.toString());
    console.log("📈 Supply Controller:", supplyController.publicKey.toString());
    console.log("🛡️ Asset Protection:", assetProtection.publicKey.toString());
    console.log("💰 Fee Controller:", feeController.publicKey.toString());
    
    // Display explorer links
    console.log("\n=== EXPLORER LINKS ===");
    console.log("🌐 Transaction:", `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
    console.log("🪙 Mint:", `https://explorer.solana.com/address/${mint.publicKey}?cluster=devnet`);
    console.log("📍 Config:", `https://explorer.solana.com/address/${configPda}?cluster=devnet`);
    
    console.log("\n🎉 Gold Token initialization completed successfully!");
    console.log("💡 You can now use this mint address for minting tokens:");
    console.log(`   Mint Address: ${mint.publicKey.toString()}`);
    
  } catch (error) {
    console.error("❌ Initialization failed:", error);
    
    if (error.message?.includes("already in use") || error.message?.includes("already exists")) {
      console.log("\n💡 This error usually means:");
      console.log("   🔄 Gatekeeper config already exists from a previous run");
      console.log("   🛠️ Solution: Reset your local validator state:");
      console.log("      solana-test-validator --reset");
      console.log("   📝 Or use a different network/cluster");
    } else if (error.message?.includes("insufficient funds")) {
      console.log("💡 Make sure the admin account has enough SOL for transaction fees");
    } else if (error.message?.includes("custom program error: 0x0")) {
      console.log("\n💡 Account allocation error detected:");
      console.log("   🔄 This usually means an account (likely gatekeeper config) already exists");
      console.log("   🛠️ Solution options:");
      console.log("      1. Reset local validator: solana-test-validator --reset");
      console.log("      2. Switch to a fresh devnet/testnet");
      console.log("      3. Use a different admin keypair");
    }
  }
}

async function checkAccountExists(connection: anchor.web3.Connection, address: PublicKey): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(address);
    return accountInfo !== null;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  try {
    console.log("🌟 Gold Token Initialization Script");
    console.log("=====================================\n");
    
    await initializeGoldToken();
    
    console.log("\n✨ Initialization script completed!");
  } catch (error) {
    console.error("❌ Script failed:", error);
  }
}

main().catch(console.error);