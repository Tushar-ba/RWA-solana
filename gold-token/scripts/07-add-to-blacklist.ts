import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { TransferHookGatekeeper } from "../target/types/transfer_hook_gatekeeper";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";

async function addToBlacklist() {
  console.log("=== Adding Address to Blacklist ===");

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
  console.log("Target Address (user2):", user2.publicKey.toBase58());

  const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.toBuffer()],
    gatekeeperProgram.programId
  );

  const [blacklistEntry] = PublicKey.findProgramAddressSync(
    [Buffer.from("blacklist"), user2.publicKey.toBuffer()],
    gatekeeperProgram.programId
  );

  console.log("Gatekeeper Config:", gatekeeperConfig.toBase58());
  console.log("Blacklist Entry PDA:", blacklistEntry.toBase58());

  // Fund asset protection if needed
  const assetProtectionBalance = await provider.connection.getBalance(assetProtection.publicKey);
  if (assetProtectionBalance < 10000000) {
    console.log("Funding asset protection account...");
    const fundTx = await provider.connection.requestAirdrop(assetProtection.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }

  try {
    // Use direct gatekeeper program call
    const tx = await gatekeeperProgram.methods
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

    console.log("✅ Address added to blacklist successfully!");
    console.log("Transaction signature:", tx);

    // Verify blacklist entry exists
    const blacklistInfo = await provider.connection.getAccountInfo(blacklistEntry);
    console.log("Blacklist entry exists:", !!blacklistInfo);
    if (blacklistInfo) {
      console.log("Blacklist entry data length:", blacklistInfo.data.length);
    }

    // Save blacklist info for other scripts
    const blacklistInfo2 = {
      targetAddress: user2.publicKey.toBase58(),
      blacklistEntry: blacklistEntry.toBase58()
    };
    fs.writeFileSync("blacklist-info.json", JSON.stringify(blacklistInfo2, null, 2));
    console.log("Blacklist info saved to blacklist-info.json");

  } catch (error) {
    console.error("❌ Adding to blacklist failed:", error);
    throw error;
  }
}

addToBlacklist()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });