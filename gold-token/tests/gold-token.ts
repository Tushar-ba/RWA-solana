import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction  // ✅ Add this import
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

describe("gold-token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.GoldToken as Program<GoldToken>;
  console.log("Program Id", program.programId.toBase58());

  // Load keypairs from the secret keys in /new/ folder
  const admin = Keypair.fromSecretKey(Uint8Array.from([22,38,221,232,192,208,117,13,0,109,189,210,183,25,35,206,103,204,181,197,159,134,203,191,201,142,72,77,120,41,15,30,33,172,179,187,92,137,207,69,156,143,66,183,150,234,207,223,236,89,6,107,225,243,93,195,211,197,176,221,7,112,166,217]));
  const supplyController = Keypair.fromSecretKey(Uint8Array.from([179,55,26,209,91,93,189,73,71,212,14,240,58,28,191,28,84,90,10,155,48,78,37,13,41,88,254,51,244,233,224,0,157,49,137,87,90,227,40,51,235,179,91,113,184,192,184,221,190,33,121,24,181,104,13,173,188,75,12,39,123,49,82,10]));
  const assetProtection = Keypair.fromSecretKey(Uint8Array.from([167,10,169,233,68,183,188,120,169,21,189,106,253,185,194,176,44,108,54,67,97,12,200,232,206,24,182,55,231,250,230,111,204,18,122,220,250,155,194,131,146,254,114,202,95,207,76,72,250,69,123,137,17,31,129,54,46,236,63,57,49,115,135,38]));
  const feeController = Keypair.fromSecretKey(Uint8Array.from([240,124,110,210,175,223,93,40,91,174,137,211,188,49,64,254,36,21,99,69,179,255,235,120,249,245,40,154,209,87,198,77,188,93,135,213,14,176,211,224,36,169,207,67,90,234,9,166,227,8,113,181,94,60,42,109,12,27,28,47,37,234,7,147]));

  const user1 = Keypair.fromSecretKey(Uint8Array.from([166,2,121,159,134,93,24,165,0,10,7,77,99,167,231,87,211,165,246,137,238,135,113,176,230,218,200,14,10,90,126,210,185,31,223,64,213,2,69,234,255,185,58,239,105,55,39,13,152,187,86,25,138,182,12,58,120,39,6,157,11,97,71,29]))
  const user2 = Keypair.fromSecretKey(Uint8Array.from([220,59,123,11,58,117,93,86,238,233,124,206,112,210,113,8,105,64,161,46,55,65,182,32,242,80,113,38,219,42,57,164,78,178,194,164,194,127,239,87,127,170,168,134,88,184,59,120,69,123,8,120,114,235,60,155,232,175,155,27,58,88,12,37]))

  const tushar = Keypair.fromSecretKey(Uint8Array.from([
    136, 87, 238, 120, 158, 176, 198, 253, 22, 69, 120, 173, 78, 54, 41, 198,
    32, 246, 56, 157, 165, 115, 168, 235, 89, 159, 83, 221, 128, 226, 248, 102,
    250, 221, 43, 103, 249, 182, 104, 111, 62, 51, 162, 229, 173, 239, 105, 226,
    55, 55, 191, 240, 30, 51, 100, 62, 137, 62, 98, 189, 201, 16, 181, 71
]))
 
  const name = "Gold Token";
  const symbol = "GOLD";
  const uri = "https://raw.githubusercontent.com/Tushar-ba/metadata/refs/heads/main/metadata.json";
  const transferFeeBasisPoints = 20; // 0.02%
  const maximumFee = new BN("1000000000"); // 1 token with 9 decimals

  // Shared variables for all tests  
  const gatekeeperProgram = new PublicKey("8eVMybvKD5phhoqhpoFRDY2VZAhmbhqRg6LY9uj1t8MP");
  
  // Get the existing config account to find the initialized mint
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  // Function to get the existing mint from config
  async function getExistingMint(): Promise<PublicKey | null> {
    try {
      const config = await program.account.config.fetch(configAccount);
      return config.mint;
    } catch (error) {
      console.log("Config not found, mint not initialized yet");
      return null;
    }
  }

  // Helper function to log balances
  async function logBalances(accountName: string, tokenAccount: PublicKey) {
    try {
      const balance = await provider.connection.getTokenAccountBalance(tokenAccount);
      console.log(`${accountName} balance: ${balance.value.amount} tokens (${balance.value.uiAmount})`);
      return parseInt(balance.value.amount);
    } catch (error) {
      console.log(`${accountName} token account not found`);
      return 0;
    }
  }

  it("Should initialize token", async () => {
    // Check if already initialized
    const existingMint = await getExistingMint();
    if (existingMint) {
      console.log("Already initialized with mint:", existingMint.toBase58());
      console.log("Skipping initialization test");
      return;
    }

    console.log("Starting token initialization");
    
    // Fund the admin account if needed
    const adminBalance = await provider.connection.getBalance(admin.publicKey);
    if (adminBalance < 5000000000) { // Less than 5 SOL
      console.log("Funding admin account");
      const fundTx = await provider.connection.requestAirdrop(admin.publicKey, 5000000000); // 5 SOL
      await provider.connection.confirmTransaction(fundTx);
      console.log("Admin funded with 5 SOL");
    }
    
    // Fund the asset protection account if needed
    const assetProtectionBalance = await provider.connection.getBalance(assetProtection.publicKey);
    if (assetProtectionBalance < 1000000000) { // Less than 1 SOL
      console.log("Funding asset protection account");
      const fundTx = await provider.connection.requestAirdrop(assetProtection.publicKey, 1000000000); // 1 SOL
      await provider.connection.confirmTransaction(fundTx);
      console.log("Asset protection funded with 1 SOL");
    }
    
    // Generate new mint only if not initialized
    const mint = Keypair.generate();
    console.log("Generated mint:", mint.publicKey.toBase58());
 
    // Derive PDAs
    const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
      gatekeeperProgram
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority")],
      program.programId
    );
    const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), mint.publicKey.toBuffer()],
      gatekeeperProgram
    );

    console.log("Derived PDAs:");
    console.log("Config:", configAccount.toBase58());
    console.log("Mint Authority:", mintAuthorityPda.toBase58());
    console.log("Gatekeeper Config:", gatekeeperConfig.toBase58());
    console.log("Extra Account Meta List:", extraAccountMetaList.toBase58());
 
    // Call initialize
    const tx = await program.methods
      .initialize(name, symbol, uri, transferFeeBasisPoints, maximumFee)
      .accountsPartial({
        admin: admin.publicKey,
        supplyController: supplyController.publicKey,
        assetProtection: assetProtection.publicKey,
        feeController: feeController.publicKey,
        gatekeeperProgram: gatekeeperProgram,
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

    console.log("Initialize transaction successful:", tx);
    console.log("Token initialized with name:", name, "symbol:", symbol);
 
  });
 
  it("Should mint tokens", async () => {
    console.log("Starting mint tokens test");
    console.log("Recipient:", user1.publicKey.toBase58());
    
    // Get the existing mint from config
    const existingMint = await getExistingMint();
    if (!existingMint) {
      throw new Error("Mint not initialized. Run initialize test first.");
    }
    console.log("Using mint:", existingMint.toBase58());
    
    const amount = new BN(100000000000); // 100 tokens (with 9 decimals)
    console.log("Minting amount:", amount.toString(), "raw units");
    
    // Derive PDAs
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority")],
      program.programId
    );
    
    // Fund the supply controller if needed
    const supplyControllerBalance = await provider.connection.getBalance(supplyController.publicKey);
    if (supplyControllerBalance < 10000000) {
      console.log("Funding supply controller account");
      const fundTx = await provider.connection.requestAirdrop(supplyController.publicKey, 1000000000);
      await provider.connection.confirmTransaction(fundTx);
      console.log("Supply controller funded");
    }

    // Get recipient token account
    const user1TokenAccount = getAssociatedTokenAddressSync(
      existingMint,
      user1.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("User1 token account (from mint test):", user1TokenAccount.toBase58());

    // Log balance before mint
    await logBalances("User1 before mint", user1TokenAccount);

    const tx = await program.methods
      .mintTokens(amount, tushar.publicKey)
      .accountsPartial({
        config: configAccount,
        supplyController: supplyController.publicKey,
        mint: existingMint,
        mintAuthorityPda: mintAuthorityPda,
        recipient: user1.publicKey,
        recipientTokenAccount: user1TokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([supplyController])
      .rpc();
      
    console.log("Mint transaction successful:", tx);
    
    // Log balance after mint
    await logBalances("User1 after mint", user1TokenAccount);
  });


it("Should transfer tokens using transfer hook instruction", async () => {
  console.log("Starting transfer hook instruction test");
  
  const existingMint = await getExistingMint();
  if (!existingMint) {
    throw new Error("Mint not initialized");
  }
  
  const transferAmount = 10 * 10 ** 9; // 10 tokens (note: using number, not BN)
  console.log("Transfer amount:", transferAmount, "raw units");
  
  const user1TokenAccount = getAssociatedTokenAddressSync(
    existingMint,
    user1.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const user2TokenAccount = getAssociatedTokenAddressSync(
    existingMint,
    user2.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  console.log("User1 token account:", user1TokenAccount.toBase58());
  console.log("User2 token account:", user2TokenAccount.toBase58());
  
  // Fund user1 if needed
  const user1Balance = await provider.connection.getBalance(user1.publicKey);
  if (user1Balance < 10000000) {
    console.log("Funding user1 account");
    const fundTx = await provider.connection.requestAirdrop(user1.publicKey, 1000000000);
    await provider.connection.confirmTransaction(fundTx);
  }
  
  // Create user2 token account if needed
  const user2AccountInfo = await provider.connection.getAccountInfo(user2TokenAccount);
  if (!user2AccountInfo) {
    console.log("Creating user2 token account");
    const createAccountTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        user1.publicKey,
        user2TokenAccount,
        user2.publicKey,
        existingMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    
    const createTxSig = await provider.connection.sendTransaction(createAccountTx, [user1]);
    await provider.connection.confirmTransaction(createTxSig, 'confirmed');
    console.log("User2 token account created");
  }
  
  // Log balances before transfer
  await logBalances("User1 before transfer", user1TokenAccount);
  await logBalances("User2 before transfer", user2TokenAccount);
  
  try {
    // ✅ Use the proper transfer hook instruction - this automatically resolves all extra accounts
    const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      user1TokenAccount,           // source
      existingMint,               // mint
      user2TokenAccount,          // destination
      user1.publicKey,            // owner
      BigInt(transferAmount),     // amount (must be BigInt)
      9,                          // decimals
      [],                         // multiSigners
      "confirmed",                // commitment
      TOKEN_2022_PROGRAM_ID       // programId
    );
    
    console.log("Transfer instruction created with keys:", transferInstruction.keys.length);
    
    // Log all the accounts that were automatically resolved
    console.log("Automatically resolved accounts:");
    transferInstruction.keys.forEach((key, index) => {
      console.log(`${index}: ${key.pubkey.toBase58()} (writable: ${key.isWritable}, signer: ${key.isSigner})`);
    });
    
    const transaction = new anchor.web3.Transaction().add(transferInstruction);
    
    const tx = await provider.connection.sendTransaction(transaction, [user1], {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    
    await provider.connection.confirmTransaction(tx, 'confirmed');
    console.log("✅ Transfer hook transfer successful:", tx);
    
    // Log balances after transfer
    const user1BalanceAfter = await logBalances("User1 after transfer", user1TokenAccount);
    const user2BalanceAfter = await logBalances("User2 after transfer", user2TokenAccount);
    
    // Calculate transfer fee
    const user1BalanceBefore = await provider.connection.getTokenAccountBalance(user1TokenAccount);
    console.log("Transfer completed successfully!");
    
  } catch (error) {
    console.log("❌ Transfer failed:");
    console.log("Error message:", error.message);
    
    if (error.logs) {
      console.log("Transaction logs:");
      error.logs.forEach((log, index) => {
        console.log(`${index}: ${log}`);
      });
    }
    
    // If there's still an error, let's debug the extra account meta list
    console.log("Debugging ExtraAccountMetaList...");
    await debugExtraAccountMetaList(existingMint);
    
    throw error;
  }
});

// Helper function to debug the ExtraAccountMetaList
async function debugExtraAccountMetaList(mint: PublicKey) {
  const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    gatekeeperProgram
  );
  
  console.log("ExtraAccountMetaList PDA:", extraAccountMetaList.toBase58());
  
  const accountInfo = await provider.connection.getAccountInfo(extraAccountMetaList);
  if (accountInfo) {
    console.log("✅ ExtraAccountMetaList exists");
    console.log("Owner:", accountInfo.owner.toBase58());
    console.log("Data length:", accountInfo.data.length);
    console.log("First 64 bytes:", accountInfo.data.slice(0, 64));
  } else {
    console.log("❌ ExtraAccountMetaList does not exist!");
  }
}

it("Should verify correct program IDs", async () => {
  console.log("Gold Token Program:", program.programId.toBase58());
  console.log("Gatekeeper Program:", gatekeeperProgram.toBase58());
  
  const gatekeeperInfo = await provider.connection.getAccountInfo(gatekeeperProgram);
  console.log("Gatekeeper program exists:", !!gatekeeperInfo);
  
  if (!gatekeeperInfo) {
    throw new Error("Gatekeeper program not found - check program ID!");
  }
});

});
 