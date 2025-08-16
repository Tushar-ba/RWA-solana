import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { TransferHookGatekeeper } from "../target/types/transfer_hook_gatekeeper";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  createAssociatedTokenAccount,
  getMint,
  createTransferCheckedInstruction,
  getAccount
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import assert from "assert";

const program = anchor.workspace.goldToken as Program<GoldToken>;
const gatekeeperProgram = anchor.workspace.transferHookGatekeeper as Program<TransferHookGatekeeper>;
const provider = anchor.AnchorProvider.env();
const adminWallet = provider.wallet;
const adminKey = adminWallet.publicKey;
const user3Keypair = Keypair.generate();
const connection = provider.connection;

const adminKey2 = Keypair.fromSecretKey(Uint8Array.from([22,38,221,232,192,208,117,13,0,109,189,210,183,25,35,206,103,204,181,197,159,134,203,191,201,142,72,77,120,41,15,30,33,172,179,187,92,137,207,69,156,143,66,183,150,234,207,223,236,89,6,107,225,243,93,195,211,197,176,221,7,112,166,217]));
const supplyControllerKey = Keypair.fromSecretKey(Uint8Array.from([179,55,26,209,91,93,189,73,71,212,14,240,58,28,191,28,84,90,10,155,48,78,37,13,41,88,254,51,244,233,224,0,157,49,137,87,90,227,40,51,235,179,91,113,184,192,184,221,190,33,121,24,181,104,13,173,188,75,12,39,123,49,82,10]));
const assetProtectionKey = Keypair.fromSecretKey(Uint8Array.from([167,10,169,233,68,183,188,120,169,21,189,106,253,185,194,176,44,108,54,67,97,12,200,232,206,24,182,55,231,250,230,111,204,18,122,220,250,155,194,131,146,254,114,202,95,207,76,72,250,69,123,137,17,31,129,54,46,236,63,57,49,115,135,38]));
const feeControllerKey = Keypair.fromSecretKey(Uint8Array.from([240,124,110,210,175,223,93,40,91,174,137,211,188,49,64,254,36,21,99,69,179,255,235,120,249,245,40,154,209,87,198,77,188,93,135,213,14,176,211,224,36,169,207,67,90,234,9,166,227,8,113,181,94,60,42,109,12,27,28,47,37,234,7,147]));
const user2 = Keypair.fromSecretKey(Uint8Array.from([220,59,123,11,58,117,93,86,238,233,124,206,112,210,113,8,105,64,161,46,55,65,182,32,242,80,113,38,219,42,57,164,78,178,194,164,194,127,239,87,127,170,168,134,88,184,59,120,69,123,8,120,114,235,60,155,232,175,155,27,58,88,12,37]));

console.log("Supplycontroller", supplyControllerKey.publicKey.toBase58());
console.log("Assetprotection", assetProtectionKey.publicKey.toBase58());
console.log("Feecontroller", feeControllerKey.publicKey.toBase58());
console.log("User2", user2.publicKey.toBase58());
console.log("User3", user3Keypair.publicKey.toBase58());

const mint = Keypair.generate();
const gatekeeperProgramId = new PublicKey("Bx71tovdDHUDwqFLmUc8NXRAG9P33kX59wjRYejM6Cj7");

const [configToken,bump] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
  [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
  gatekeeperProgramId
);
const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint_authority")],
  program.programId
);

const [gatekeeperConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("config"), mint.publicKey.toBuffer()],
  gatekeeperProgramId
);

describe("gold-token", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.goldToken as Program<GoldToken>;

  it("Is initialized!", async () => {
    const tx = await program.methods.initialize("Gold Token", "GOLD", "https://example.com/metadata.json", 20, new BN(1000000000))
    .accounts({
      admin: adminKey,
      supplyController: supplyControllerKey.publicKey,
      assetProtection: assetProtectionKey.publicKey,
      feeController: feeControllerKey.publicKey,
      gatekeeperProgram: gatekeeperProgramId,
      config: configToken,
      gatekeeperConfig: gatekeeperConfig,
      extraAccountMetaList: extraAccountMetaList,
      mint: mint.publicKey,
      mintAuthorityPda: mintAuthorityPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }).signers([mint, assetProtectionKey])
    .rpc();
    console.log("Your transaction signature", tx);
  });
  
  it("It should mint tokens to user2 and test transfer with fee", async () => {
    const mintAmount = new BN(1000 * LAMPORTS_PER_SOL);
    
    // Get the existing mint from config first
    const configInfo = await program.account.config.fetch(configToken);
    console.log("Existing mint account", configInfo);
    const existingMintAccount = configInfo.mint;
    console.log("Existing mint account", existingMintAccount);
    
    // Calculate user2TokenAccount using the EXISTING mint
    const user2TokenAccount = getAssociatedTokenAddressSync(
      existingMintAccount, 
      user2.publicKey, 
      false, 
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Get balance before minting
    let balanceBefore = new BN(0);
    try {
      const balanceInfo = await connection.getTokenAccountBalance(user2TokenAccount);
      balanceBefore = new BN(balanceInfo.value.amount);
      console.log("User2 balance before mint:", balanceInfo.value.amount);
    } catch (error) {
      console.log("User2 token account doesn't exist yet - will be created");
    }
    
    // 1. Mint tokens to user2
    const mintTx = await program.methods
      .mintTokens(mintAmount, user2.publicKey)
      .accountsPartial({
        config: configToken,
        supplyController: supplyControllerKey.publicKey,
        mint: existingMintAccount,
        mintAuthorityPda: mintAuthorityPda,
        recipient: user2.publicKey,
        recipientTokenAccount: user2TokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([supplyControllerKey])
      .rpc();
  
    console.log("Mint transaction signature:", mintTx);
    
    // Verify minting worked
    const user2TokenBalance = await connection.getTokenAccountBalance(user2TokenAccount);
    console.log("User2 token balance after mint:", user2TokenBalance.value.amount);
    
    // Check that the balance increased by the minted amount
    const balanceAfter = new BN(user2TokenBalance.value.amount);
    const expectedBalance = balanceBefore.add(mintAmount);
    assert.equal(balanceAfter.toString(), expectedBalance.toString(), 
      `Balance should increase by ${mintAmount.toString()}. Before: ${balanceBefore.toString()}, After: ${balanceAfter.toString()}, Expected: ${expectedBalance.toString()}`);
  
    console.log("========= Starting transfer hook function test =========");
    
    const transferAmount = new BN(1000 * 10 ** 9); // 1000 tokens with 9 decimals
    const feeRate = 20; // 20 basis points = 0.2%
    const expectedFee = transferAmount.mul(new BN(feeRate)).div(new BN(10000));
    const expectedReceivedAmount = transferAmount.sub(expectedFee);
    
    // Get user3's token account (receiver)
    const user3TokenAccount = getAssociatedTokenAddressSync(
      existingMintAccount, 
      user3Keypair.publicKey, 
      false, 
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Get balances before transfer
    const user2BalanceBefore = await connection.getTokenAccountBalance(user2TokenAccount);
    console.log("User2 balance before transfer:", user2BalanceBefore.value.amount);
    
    // Build transfer transaction
    const transferTx = new Transaction();
    
    // Create user3's token account if it doesn't exist
    try {
      const accountInfo = await connection.getAccountInfo(user3TokenAccount);
      if (!accountInfo) {
        console.log("Creating User3 token account");
        const createUser3ATAIx = createAssociatedTokenAccountInstruction(
          user2.publicKey,  // User2 pays for user3's account creation
          user3TokenAccount,       // ATA address for user3
          user3Keypair.publicKey,  // Owner (user3)
          existingMintAccount,   // Mint
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        transferTx.add(createUser3ATAIx);
      } else {
        console.log("User3 token account already exists");
      }
    } catch (error) {
      console.log("Creating User3 token account");
      const createUser3ATAIx = createAssociatedTokenAccountInstruction(
        user2.publicKey,  // User2 pays for user3's account creation
        user3TokenAccount,       // ATA address for user3
        user3Keypair.publicKey,  // Owner (user3)
        existingMintAccount,   // Mint
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      transferTx.add(createUser3ATAIx);
    }
    
    // Get mint info to ensure we have the correct decimals
    const mintInfo = await getMint(
      connection,
      existingMintAccount,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log("Mint info decimals:", mintInfo.decimals);
    
    // Calculate the extra account meta list for the existing mint (not the generated one)
    const [extraAccountMetaListForTransfer] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), existingMintAccount.toBuffer()],
      gatekeeperProgramId
    );
    
    console.log("Extra account meta list:", extraAccountMetaListForTransfer.toBase58());
    
    // Create transfer instruction with transfer hook - CORRECT APPROACH
    try {
      console.log("Creating transfer with transfer hook instruction...");
      
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        user2TokenAccount,      // Source token account
        existingMintAccount,    // Mint address (use existing mint, not generated one)
        user3TokenAccount,      // Destination token account
        user2.publicKey,        // Owner of source account
        BigInt(transferAmount.toString()), // Amount as BigInt
        mintInfo.decimals,      // Use actual decimals from mint info
        [],                     // Multi-signers
        "confirmed",            // Commitment
        TOKEN_2022_PROGRAM_ID   // Token program
      );
      
      console.log("Transfer instruction created successfully");
      console.log("Instruction program ID:", transferIx.programId.toBase58());
      console.log("Expected program ID:", TOKEN_2022_PROGRAM_ID.toBase58());
      console.log("Transfer instruction keys:", JSON.stringify(transferIx.keys.map(key => ({
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable
      }))));
      
      transferTx.add(transferIx);
      
    } catch (error) {
      console.error("Error creating transfer instruction:", error);
      throw error;
    }
    
    // Sign and send transfer transaction
    console.log("Sending transaction...");
    const transferTxSignature = await sendAndConfirmTransaction(
      connection,
      transferTx,
      [user2], // User2 signs the transfer
      { 
        commitment: 'confirmed',
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      }
    );
    
    console.log("Transfer transaction signature:", transferTxSignature);
    
    // Get balances after transfer
    const user2BalanceAfter = await connection.getTokenAccountBalance(user2TokenAccount);
    const user3BalanceAfter = await connection.getTokenAccountBalance(user3TokenAccount);
    
    console.log("User2 balance after transfer:", user2BalanceAfter.value.amount);
    console.log("User3 balance after transfer:", user3BalanceAfter.value.amount);
    
    // Calculate expected remaining balance for user2
    const originalBalance = new BN(user2BalanceBefore.value.amount);
    const expectedRemainingBalance = originalBalance.sub(transferAmount);
    
    // Assertions
    console.log("========= Assertions =========");
    
    // 1. Sender (user2) should have correct remaining balance
    assert.equal(
      user2BalanceAfter.value.amount, 
      expectedRemainingBalance.toString(),
      "Sender balance should decrease by transfer amount"
    );
    
    // 2. Receiver (user3) should receive amount minus fee
    assert.equal(
      user3BalanceAfter.value.amount,
      expectedReceivedAmount.toString(),
      `Receiver should get ${expectedReceivedAmount.toString()} tokens (transfer amount minus fee)`
    );
    
    // 3. Verify the fee calculation
    const actualFee = transferAmount.sub(new BN(user3BalanceAfter.value.amount));
    assert.equal(
      actualFee.toString(),
      expectedFee.toString(),
      `Fee should be ${expectedFee.toString()} tokens (20 BP of transfer amount)`
    );
    
    console.log("========= Test Results =========");
    console.log(`Transfer Amount: ${transferAmount.toString()}`);
    console.log(`Expected Fee (20 BP): ${expectedFee.toString()}`);
    console.log(`Expected Received: ${expectedReceivedAmount.toString()}`);
    console.log(`Actual Received: ${user3BalanceAfter.value.amount}`);
    console.log(`Actual Fee: ${actualFee.toString()}`);
    
    console.log("✅ All assertions passed! Transfer from User2 to User3 with 20 BP fee successful!");
  });
});