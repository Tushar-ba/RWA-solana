import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { TransferHookGatekeeper } from "../target/types/transfer_hook_gatekeeper";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";

async function initialize() {
  console.log("=== Initializing Gold Token ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const program = anchor.workspace.GoldToken as Program<GoldToken>;
  const gatekeeperProgram = anchor.workspace.TransferHookGatekeeper as Program<TransferHookGatekeeper>;

  console.log("Gold Token Program ID:", program.programId.toBase58());
  console.log("Gatekeeper Program ID:", gatekeeperProgram.programId.toBase58());

  // Load other keypairs from files (admin already loaded above)
  const supplyController = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/supply.json", "utf8"))));
  const assetProtection = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/asset.json", "utf8"))));
  const feeController = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/fee.json", "utf8"))));

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("Supply Controller:", supplyController.publicKey.toBase58());
  console.log("Asset Protection:", assetProtection.publicKey.toBase58());
  console.log("Fee Controller:", feeController.publicKey.toBase58());

  // Token metadata
  const name = "Gold Token";
  const symbol = "GOLD";
  const uri = "https://raw.githubusercontent.com/Tushar-ba/metadata/refs/heads/main/metadata.json";
  const transferFeeBasisPoints = 20; // 0.02%
  const maximumFee = new BN("1000000000"); // 1 token with 9 decimals

  // Generate new mint
  const mint = Keypair.generate();
  console.log("Generated mint:", mint.publicKey.toBase58());

  // Derive PDAs
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    gatekeeperProgram.programId
  );

  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    program.programId
  );

  const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.publicKey.toBuffer()],
    gatekeeperProgram.programId
  );

  console.log("Config PDA:", configAccount.toBase58());
  console.log("Mint Authority PDA:", mintAuthorityPda.toBase58());
  console.log("Gatekeeper Config:", gatekeeperConfig.toBase58());
  console.log("Extra Account Meta List:", extraAccountMetaList.toBase58());

  // Fund accounts if needed
  const adminBalance = await provider.connection.getBalance(admin.publicKey);
  if (adminBalance < 5000000000) {
    console.log("Funding admin account...");
    const fundTx = await provider.connection.requestAirdrop(admin.publicKey, 5000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  const assetProtectionBalance = await provider.connection.getBalance(assetProtection.publicKey);
  if (assetProtectionBalance < 1000000000) {
    console.log("Funding asset protection account...");
    const fundTx = await provider.connection.requestAirdrop(assetProtection.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  try {
    const tx = await program.methods
      .initialize(name, symbol, uri, transferFeeBasisPoints, maximumFee)
      .accountsPartial({
        admin: admin.publicKey,
        supplyController: supplyController.publicKey,
        assetProtection: assetProtection.publicKey,
        feeController: feeController.publicKey,
        gatekeeperProgram: gatekeeperProgram.programId,
        config: configAccount,
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

    console.log("✅ Token initialized successfully!");
    console.log("Transaction signature:", tx);
    console.log("Mint address:", mint.publicKey.toBase58());

    console.log("✅ Mint address is now stored in the config account and can be retrieved by other scripts");

  } catch (error) {
    console.error("❌ Initialization failed:", error);
    throw error;
  }
}

initialize()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });