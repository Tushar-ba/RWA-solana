import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoldToken } from "../target/types/gold_token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

describe("gold-token", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.goldToken as Program<GoldToken>;

  const supplyController = Keypair.generate();
  const assetProtection = Keypair.generate();
  const feeController = Keypair.generate();
  const gatekeeperProgram = Keypair.generate();

  const mint_pda = PublicKey.findProgramAddressSync([Buffer.from("mint_authority")], program.programId);

  it("Is initialized!", async () => {
    const tx = await program.methods.initialize("Gold Token", "GOLD", "https://gold.com", 100, new BN(1000000000000000000)).accounts({
      admin: provider.wallet.publicKey,
      mint: mint.publicKey,
      supplyController: supplyController.publicKey,
      assetProtection: assetProtection.publicKey,
      feeController: feeController.publicKey,
      gatekeeperProgram: gatekeeperProgram.publicKey,
    }).signers([supplyController, assetProtection, feeController, gatekeeperProgram]).rpc();

    console.log("Your transaction signature", tx);
  });
});