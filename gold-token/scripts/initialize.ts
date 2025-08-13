import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { TransferHookGatekeeper } from "../target/types/transfer_hook_gatekeeper";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

async function initialize() {
  // Configure the client to use the local cluster (same as test)
  anchor.setProvider(anchor.AnchorProvider.env());

  const goldTokenProgram = anchor.workspace.GoldToken as Program<GoldToken>;
  const gatekeeperProgram = anchor.workspace.TransferHookGatekeeper as Program<TransferHookGatekeeper>;

  const goldTokenProgram = anchor.workspace.GoldToken as Program<GoldToken>;
  const gatekeeperProgram = anchor.workspace.TransferHookGatekeeper as Program<TransferHookGatekeeper>;

  // Generate keypairs for roles
  const admin = anchor.AnchorProvider.env().wallet.publicKey;
  const supplyController = Keypair.generate();
  const assetProtection = Keypair.generate(); 
  const feeController = Keypair.generate();

  console.log("Admin:", admin.toString());
  console.log("Supply Controller:", supplyController.publicKey.toString());
  console.log("Asset Protection:", assetProtection.publicKey.toString());
  console.log("Fee Controller:", feeController.publicKey.toString());

  // Derive PDAs
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    goldTokenProgram.programId
  );

  const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    gatekeeperProgram.programId
  );

  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    goldTokenProgram.programId
  );

  // Generate mint keypair
  const mint = Keypair.generate();

  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    gatekeeperProgram.programId
  );

  try {
    const tx = await goldTokenProgram.methods
      .initialize("Gold Token", "GOLD", "https://example.com/metadata.json")
      .accounts({
        admin: admin,
        supplyController: supplyController.publicKey,
        assetProtection: assetProtection.publicKey,
        feeController: feeController.publicKey,
        gatekeeperProgram: gatekeeperProgram.programId,
        config: config,
        gatekeeperConfig: gatekeeperConfig,
        extraAccountMetaList: extraAccountMetaList,
        mint: mint.publicKey,
        mintAuthorityPda: mintAuthority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mint])
      .rpc();

    console.log("Initialize transaction signature:", tx);
    console.log("Mint address:", mint.publicKey.toString());
    
    // Save important addresses
    console.log("\n=== SAVE THESE ADDRESSES ===");
    console.log("Config PDA:", config.toString());
    console.log("Mint:", mint.publicKey.toString());
    console.log("Mint Authority PDA:", mintAuthority.toString());
    console.log("Supply Controller Keypair:", JSON.stringify(Array.from(supplyController.secretKey)));
    console.log("Asset Protection Keypair:", JSON.stringify(Array.from(assetProtection.secretKey)));
    console.log("Fee Controller Keypair:", JSON.stringify(Array.from(feeController.secretKey)));
    
  } catch (error) {
    console.error("Error:", error);
  }
}

initialize();