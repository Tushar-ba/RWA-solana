use anchor_lang::{
    prelude::*,
    system_program::{create_account, CreateAccount},
};
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

declare_id!("8eVMybvKD5phhoqhpoFRDY2VZAhmbhqRg6LY9uj1t8MP");

#[program]
pub mod transfer_hook_gatekeeper {
    use super::*;

    /// Initialize the extra account meta list for the transfer hook
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let account_metas = vec![
            // index 5: source blacklist PDA
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: "blacklist".as_bytes().to_vec() },
                    Seed::AccountKey { index: 3 }, // source token account owner
                ],
                false, // is_signer
                false, // is_writable
            )?,
            // index 6: destination blacklist PDA
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: "blacklist".as_bytes().to_vec() },
                    Seed::AccountKey { index: 2 }, // destination token account owner
                ],
                false, // is_signer
                false, // is_writable
            )?,
        ];

        let account_size = ExtraAccountMetaList::size_of(account_metas.len())? as u64;
        let lamports = Rent::get()?.minimum_balance(account_size as usize);

        let mint = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            &mint.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ]];

        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size,
            ctx.program_id,
        )?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &account_metas,
        )?;

        Ok(())
    }

    /// Initialize the gatekeeper configuration
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.config.authority = ctx.accounts.authority.key();
        Ok(())
    }
    
    /// Set a new authority for the gatekeeper
    pub fn set_authority(ctx: Context<SetAuthority>) -> Result<()> {
        ctx.accounts.config.authority = ctx.accounts.new_authority.key();
        Ok(())
    }
    
    /// Add an address to the blacklist
    pub fn add_to_blacklist(_ctx: Context<AddToBlacklist>) -> Result<()> { 
        Ok(()) 
    }
    
    /// Remove an address from the blacklist
    pub fn remove_from_blacklist(_ctx: Context<RemoveFromBlacklist>) -> Result<()> { 
        Ok(()) 
    }

    /// The main transfer hook execution function
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        // Validate that the owner matches the source token account owner
        require_keys_eq!(
            ctx.accounts.owner.key(),
            ctx.accounts.source_token.owner,
            GatekeeperError::Unauthorized
        );
    
        // Check if source blacklist PDA exists and has data (meaning the address is blacklisted)
        if ctx.accounts.source_blacklist_entry.data_len() > 8 { // More than just discriminator
            msg!("Source address is blacklisted. Transfer denied.");
            return err!(GatekeeperError::AddressBlacklisted);
        }
    
        // Check if destination blacklist PDA exists and has data
        if ctx.accounts.destination_blacklist_entry.data_len() > 8 { // More than just discriminator
            msg!("Destination address is blacklisted. Transfer denied.");
            return err!(GatekeeperError::AddressBlacklisted);
        }
    
        msg!("Transfer approved");
        Ok(())
    }

    /// Fallback function to handle transfer hook instructions
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;
        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => return Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

/// Initialize extra account meta list
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: ExtraAccountMetaList Account, must use these seeds
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: AccountInfo<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

/// Initialize the gatekeeper configuration
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Authority can be any account
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32, // discriminator + pubkey
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

/// Set a new authority
#[derive(Accounts)]
pub struct SetAuthority<'info> {
    #[account(
        mut, 
        has_one = authority,
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
    /// CHECK: New authority can be any account
    pub new_authority: AccountInfo<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
}

/// Add an address to the blacklist
#[derive(Accounts)]
pub struct AddToBlacklist<'info> {
    #[account(
        has_one = authority,
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The address being blacklisted
    pub target_address: AccountInfo<'info>,
    #[account(
        init,
        payer = authority,
        space = 8, // Just the discriminator
        seeds = [b"blacklist", target_address.key().as_ref()],
        bump
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

/// Remove an address from the blacklist
#[derive(Accounts)]
pub struct RemoveFromBlacklist<'info> {
    #[account(
        has_one = authority,
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The address being removed from blacklist
    pub target_address: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"blacklist", target_address.key().as_ref()],
        bump,
        close = authority
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,
    pub mint: InterfaceAccount<'info, Mint>,
}

/// Context for the transfer hook execution
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account owner - this should match source_token.owner
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: Source blacklist PDA - this account may not exist (which is OK)
    pub source_blacklist_entry: UncheckedAccount<'info>,
    /// CHECK: Destination blacklist PDA - this account may not exist (which is OK)
    pub destination_blacklist_entry: UncheckedAccount<'info>,
}
/// Configuration account for the gatekeeper
#[account]
pub struct Config {
    pub authority: Pubkey,
}

/// Empty account that marks an address as blacklisted
#[account]
pub struct BlacklistEntry {}

#[error_code]
pub enum GatekeeperError {
    #[msg("The address is on the transfer blacklist.")]
    AddressBlacklisted,
    #[msg("Unauthorized: The signer is not the configured authority.")]
    Unauthorized,
}