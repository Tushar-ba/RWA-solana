import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { TransferHookGatekeeper } from "../target/types/transfer_hook_gatekeeper";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";

async function testBlacklistStatus() {
  console.log("=== Testing Blacklist Status ===");

  // Load admin keypair to use as wallet
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("new/admin.json", "utf8"))));
  
  // Setup provider with admin as wallet
  const connection = new anchor.web3.Connection("http://localhost:8899", "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load user2 keypair
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
  console.log("User2:", user2.publicKey.toBase58());

  // Check blacklist entry
  const [blacklistEntry] = PublicKey.findProgramAddressSync(
    [Buffer.from("blacklist"), user2.publicKey.toBuffer()],
    gatekeeperProgram.programId
  );

  console.log("Blacklist Entry PDA:", blacklistEntry.toBase58());

  // Check if blacklist entry exists
  const blacklistAccountInfo = await provider.connection.getAccountInfo(blacklistEntry);
  
  if (blacklistAccountInfo) {
    console.log("✅ Blacklist entry exists");
    console.log("   - Owner:", blacklistAccountInfo.owner.toBase58());
    console.log("   - Data length:", blacklistAccountInfo.data.length);
    console.log("   - Lamports:", blacklistAccountInfo.lamports);
    
    // Check if it's owned by the gatekeeper program
    if (blacklistAccountInfo.owner.equals(gatekeeperProgram.programId)) {
      console.log("✅ Blacklist entry is owned by gatekeeper program");
    } else {
      console.log("❌ Blacklist entry is NOT owned by gatekeeper program");
      console.log("   Expected:", gatekeeperProgram.programId.toBase58());
      console.log("   Actual:", blacklistAccountInfo.owner.toBase58());
    }
  } else {
    console.log("❌ Blacklist entry does NOT exist");
  }

  // Check gatekeeper config
  const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.toBuffer()],
    gatekeeperProgram.programId
  );

  console.log("Gatekeeper Config:", gatekeeperConfig.toBase58());

  const gatekeeperConfigInfo = await provider.connection.getAccountInfo(gatekeeperConfig);
  if (gatekeeperConfigInfo) {
    console.log("✅ Gatekeeper config exists");
  } else {
    console.log("❌ Gatekeeper config does NOT exist");
  }

  // Check extra account meta list
  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    gatekeeperProgram.programId
  );

  console.log("Extra Account Meta List:", extraAccountMetaList.toBase58());

  const extraAccountMetaInfo = await provider.connection.getAccountInfo(extraAccountMetaList);
  if (extraAccountMetaInfo) {
    console.log("✅ Extra Account Meta List exists");
    console.log("   - Data length:", extraAccountMetaInfo.data.length);
  } else {
    console.log("❌ Extra Account Meta List does NOT exist");
  }
}

testBlacklistStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });