// lib.rs -> Complete Gold Token Program (Anchor 0.31.1)

add admin pda to change the 3 roles and this admin can also be changed by deployer and both of them will have the same authority to change the roles

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        burn, mint_to, approve, revoke,
        Burn, Mint, MintTo, TokenAccount, TokenInterface,
        Approve, Revoke,
    },
    token_2022::spl_token_2022::{
        instruction::{
            initialize_permanent_delegate,
        },
        extension::transfer_hook::instruction::initialize,

    },
};
use anchor_lang::solana_program::program::invoke_signed;

// Import the gatekeeper program to use its account types and CPI contexts
use transfer_hook_gatekeeper::program::TransferHookGatekeeper;


// This is the Program ID of the main gold token program
declare_id!("EN54bHs4cXhfcqaAbvcSzcF4vBwSeyCSMaDm9W6MXFhC");

#[program]
pub mod gold_token {
    use super::*;

    // ============================================
    // INITIALIZATION & CONFIGURATION
    // ============================================
    pub fn initialize(
        ctx: Context<Initialize>,
        _name: String,
        _symbol: String,
        _uri: String,
        transfer_fee_basis_points: u16,
        maximum_fee: u64,
    ) -> Result<()> {
        use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
        use anchor_lang::solana_program::system_instruction;

        // Calculate space needed for mint with extensions
        let mint_size = ExtensionType::try_calculate_account_len::<anchor_spl::token_2022::spl_token_2022::state::Mint>(&[
            ExtensionType::TransferFeeConfig,
            ExtensionType::PermanentDelegate,
            ExtensionType::TransferHook,
        ])?;

        // Create mint account
        let create_mint_ix = system_instruction::create_account(
            ctx.accounts.admin.key,
            &ctx.accounts.mint.key(),
            ctx.accounts.rent.minimum_balance(mint_size),
            mint_size as u64,
            &anchor_spl::token_2022::ID,
        );

        anchor_lang::solana_program::program::invoke(
            &create_mint_ix,
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Initialize Transfer Fee Extension FIRST
        invoke_signed(
            &anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.mint.key(),
                Some(&ctx.accounts.fee_controller.key()),
                Some(&ctx.accounts.fee_controller.key()),
                transfer_fee_basis_points,
                maximum_fee,
            )?,
            &[
                ctx.accounts.mint.to_account_info(),
            ],
            &[],
        )?;

        // Initialize Permanent Delegate Extension SECOND
        invoke_signed(
            &initialize_permanent_delegate(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.mint.key(),
                &ctx.accounts.asset_protection.key(),
            )?,
            &[
                ctx.accounts.mint.to_account_info(),
            ],
            &[],
        )?;

        // Initialize Transfer Hook Extension THIRD
        invoke_signed(
            &anchor_spl::token_2022::spl_token_2022::extension::transfer_hook::instruction::initialize(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.mint.key(),
                Some(ctx.accounts.asset_protection.key()),
                Some(ctx.accounts.gatekeeper_program.key()),
            )?,
            &[
                ctx.accounts.mint.to_account_info(),
            ],
            &[],
        )?;

        // Get mint authority seeds for signing
        let mint_authority_bump = ctx.bumps.mint_authority_pda;
        let mint_authority_seeds: &[&[u8]] = &[
            b"mint_authority".as_ref(),
            &[mint_authority_bump],
        ];
        let mint_authority_signer = &[&mint_authority_seeds[..]];

        // NOW initialize the basic mint (this must come AFTER all extensions)
        invoke_signed(
            &anchor_spl::token_2022::spl_token_2022::instruction::initialize_mint2(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.mint.key(),
                &ctx.accounts.mint_authority_pda.key(),
                None, // No freeze authority
                9,    // Decimals
            )?,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
            mint_authority_signer,
        )?;

        // Initialize our own config
        let config = &mut ctx.accounts.config;
        config.admin = *ctx.accounts.admin.key;
        config.supply_controller = *ctx.accounts.supply_controller.key;
        config.asset_protection = *ctx.accounts.asset_protection.key;
        config.fee_controller = *ctx.accounts.fee_controller.key;
        config.mint = ctx.accounts.mint.key();
        config.gatekeeper_program = *ctx.accounts.gatekeeper_program.key;
        config.redemption_request_counter = 0;
        config.is_paused = false;
    
        // CPI to initialize the gatekeeper program
        let cpi_program = ctx.accounts.gatekeeper_program.to_account_info();
        let cpi_accounts = transfer_hook_gatekeeper::cpi::accounts::Initialize {
            payer: ctx.accounts.admin.to_account_info(),
            authority: ctx.accounts.asset_protection.to_account_info(),
            config: ctx.accounts.gatekeeper_config.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer_hook_gatekeeper::cpi::initialize(cpi_ctx)?;
    
        // Initialize the ExtraAccountMetaList for the transfer hook
        let cpi_accounts = transfer_hook_gatekeeper::cpi::accounts::InitializeExtraAccountMetaList {
            payer: ctx.accounts.admin.to_account_info(),
            extra_account_meta_list: ctx.accounts.extra_account_meta_list.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.gatekeeper_program.to_account_info(), cpi_accounts);
        transfer_hook_gatekeeper::cpi::initialize_extra_account_meta_list(cpi_ctx)?;
    
        emit!(TokenInitialized {
            mint: ctx.accounts.mint.key(),
            admin: *ctx.accounts.admin.key,
            gatekeeper_program: *ctx.accounts.gatekeeper_program.key,
        });
    
        Ok(())
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================
    
    pub fn update_supply_controller(ctx: Context<UpdateRole>, new_controller: Pubkey) -> Result<()> {
        let old_controller = ctx.accounts.config.supply_controller;
        ctx.accounts.config.supply_controller = new_controller;
        
        emit!(RoleUpdated {
            role: "supply_controller".to_string(),
            old_authority: old_controller,
            new_authority: new_controller,
        });
        
        Ok(())
    }

    pub fn update_asset_protection(ctx: Context<UpdateRole>, new_protection: Pubkey) -> Result<()> {
        let old_protection = ctx.accounts.config.asset_protection;
        ctx.accounts.config.asset_protection = new_protection;
        
        emit!(RoleUpdated {
            role: "asset_protection".to_string(),
            old_authority: old_protection,
            new_authority: new_protection,
        });
        
        Ok(())
    }

    pub fn update_fee_controller(ctx: Context<UpdateRole>, new_fee_controller: Pubkey) -> Result<()> {
        let old_fee_controller = ctx.accounts.config.fee_controller;
        ctx.accounts.config.fee_controller = new_fee_controller;
        
        emit!(RoleUpdated {
            role: "fee_controller".to_string(),
            old_authority: old_fee_controller,
            new_authority: new_fee_controller,
        });
        
        Ok(())
    }

    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.is_paused = !config.is_paused;
        
        emit!(PauseToggled {
            is_paused: config.is_paused,
            authority: *ctx.accounts.admin.key,
        });
        
        Ok(())
    }

    // ============================================
    // FEE CONTROLLER FUNCTIONS
    // ============================================

    /// @dev Updates the transfer fee configuration.
    /// 
    this is not needed at momemt keep it hard coded to 0.02%
    pub fn set_transfer_fee(
        ctx: Context<SetTransferFee>, 
        transfer_fee_basis_points: u16, 
        maximum_fee: u64
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused, GoldTokenError::ContractPaused);
        
        invoke_signed(
            &anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::instruction::set_transfer_fee(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.mint.key(),
                &ctx.accounts.fee_controller.key(),
                &[],
                transfer_fee_basis_points,
                maximum_fee,
            )?,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.fee_controller.to_account_info(),
            ],
            &[],
        )?;

        emit!(TransferFeeUpdated {
            mint: ctx.accounts.mint.key(),
            transfer_fee_basis_points,
            maximum_fee,
            authority: *ctx.accounts.fee_controller.key,
        });

        Ok(())
    }

    /// @dev Withdraws withheld fees from the mint account.
    pub fn withdraw_withheld_tokens_from_mint(
        ctx: Context<WithdrawWithheldTokensFromMint>
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused, GoldTokenError::ContractPaused);
        
        invoke_signed(
            &anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::instruction::withdraw_withheld_tokens_from_mint(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.mint.key(),
                &ctx.accounts.destination_token_account.key(),
                &ctx.accounts.fee_controller.key(),
                &[],
            )?,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.destination_token_account.to_account_info(),
                ctx.accounts.fee_controller.to_account_info(),
            ],
            &[],
        )?;

        emit!(WithheldTokensWithdrawn {
            mint: ctx.accounts.mint.key(),
            destination: ctx.accounts.destination_token_account.key(),
            authority: *ctx.accounts.fee_controller.key,
        });

        Ok(())
    }

    /// @dev Withdraws withheld fees from token accounts.
    pub fn withdraw_withheld_tokens_from_accounts(
        ctx: Context<WithdrawWithheldTokensFromAccounts>
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused, GoldTokenError::ContractPaused);
        
        // For simplicity, we'll limit this to a small number of source accounts
        // In practice, you might want to handle this differently based on your needs
        msg!("Withdraw withheld tokens from accounts functionality requires custom implementation for multiple accounts");
        
        emit!(WithheldTokensWithdrawnFromAccounts {
            mint: ctx.accounts.mint.key(),
            destination: ctx.accounts.destination_token_account.key(),
            source_accounts: vec![], // Empty for now - implement as needed
            authority: *ctx.accounts.fee_controller.key,
        });

        Ok(())
    }

    // ============================================
    // SUPPLY CONTROLLER FUNCTIONS
    // ============================================

    /// @dev Mints new tokens and creates associated token account if needed.
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64, recipient: Pubkey) -> Result<()> {
        require!(amount > 0, GoldTokenError::InvalidAmount);
        require!(!ctx.accounts.config.is_paused, GoldTokenError::ContractPaused);
        
        let seeds = &["mint_authority".as_bytes(), &[ctx.bumps.mint_authority_pda]];
        let signer = &[&seeds[..]];
        
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority_pda.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        emit!(TokensMinted {
            mint: ctx.accounts.mint.key(),
            to: ctx.accounts.recipient_token_account.key(),
            amount,
            authority: *ctx.accounts.supply_controller.key,
            recipient,
        });

        Ok(())
    }

    // ============================================
    // REDEMPTION REQUEST LIFECYCLE
    // ============================================

    /// @dev Creates a new redemption request and locks user tokens via delegation.
    lock those tokens for amount here 
    pub fn request_redemption(ctx: Context<RequestRedemption>, amount: u64) -> Result<()> {
        require!(amount > 0, GoldTokenError::InvalidAmount);
        require!(!ctx.accounts.config.is_paused, GoldTokenError::ContractPaused);
        require!(
            ctx.accounts.user_token_account.amount >= amount,
            GoldTokenError::InsufficientBalance
        );
        
        // Get the next request ID
        let request_id = ctx.accounts.config.redemption_request_counter
            .checked_add(1)
            .ok_or(GoldTokenError::CounterOverflow)?;
        
        // Initialize the request
        let request = &mut ctx.accounts.redemption_request;
        request.user = *ctx.accounts.user.key;
        request.amount = amount;
        request.status = RedemptionStatus::Pending;
        request.requested_at = Clock::get()?.unix_timestamp;
        request.completed_at = 0;
        request.request_id = request_id;
        request.redemption_pda_bump = ctx.bumps.redemption_pda;
        
        // Delegate tokens to the redemption PDA
        approve(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Approve {
                    to: ctx.accounts.user_token_account.to_account_info(),
                    delegate: ctx.accounts.redemption_pda.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // Update counter
        ctx.accounts.config.redemption_request_counter = request_id;

        emit!(RedemptionRequested {
            user: *ctx.accounts.user.key,
            request_id,
            amount,
            timestamp: request.requested_at,
        });

        Ok(())
    }

    /// @dev Fulfills a redemption request by burning the delegated tokens.
    pub fn fulfill_redemption(ctx: Context<FulfillRedemption>) -> Result<()> {
        let request = &mut ctx.accounts.redemption_request;
        require!(
            request.status == RedemptionStatus::Pending || request.status == RedemptionStatus::Processing,
            GoldTokenError::InvalidRequestStatus
        );
        
        let seeds = &[
            b"redemption_pda",
            request.user.as_ref(),
            &request.request_id.to_le_bytes(),
            &[request.redemption_pda_bump]
        ];
        let signer = &[&seeds[..]];
        
        burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.redemption_pda.to_account_info(),
                },
                signer,
            ),
            request.amount,
        )?;
        
        request.status = RedemptionStatus::Fulfilled;
        request.completed_at = Clock::get()?.unix_timestamp;

        emit!(RedemptionFulfilled {
            user: request.user,
            request_id: request.request_id,
            amount: request.amount,
            timestamp: request.completed_at,
        });

        Ok(())
    }


    add check to make sure the user cant cancel when the status is processing or fulfilled
    /// @dev Cancels a redemption request and returns token delegation.
    pub fn cancel_redemption(ctx: Context<CancelRedemption>) -> Result<()> {
        let request = &mut ctx.accounts.redemption_request;
        require!(request.status == RedemptionStatus::Pending, GoldTokenError::InvalidRequestStatus);
        
        revoke(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Revoke {
                source: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ))?;
        
        request.status = RedemptionStatus::Cancelled;
        request.completed_at = Clock::get()?.unix_timestamp;

        emit!(RedemptionCancelled {
            user: request.user,
            request_id: request.request_id,
            amount: request.amount,
            timestamp: request.completed_at,
        });

        Ok(())
    }

    /// @dev Sets a redemption request status to Processing.
    pub fn set_redemption_processing(ctx: Context<UpdateRedemptionStatus>) -> Result<()> {
        let request = &mut ctx.accounts.redemption_request;
        require!(request.status == RedemptionStatus::Pending, GoldTokenError::InvalidRequestStatus);
        request.status = RedemptionStatus::Processing;

        emit!(RedemptionStatusUpdated {
            user: request.user,
            request_id: request.request_id,
            old_status: RedemptionStatus::Pending,
            new_status: RedemptionStatus::Processing,
        });

        Ok(())
    }

    // ============================================
    // ASSET PROTECTION: BLACKLIST & WIPE
    // ============================================

    /// @dev Adds an address to the transfer blacklist by calling the gatekeeper program.
    pub fn add_to_blacklist(ctx: Context<UpdateBlacklist>) -> Result<()> {
        let cpi_program = ctx.accounts.gatekeeper_program.to_account_info();
        let cpi_accounts = transfer_hook_gatekeeper::cpi::accounts::AddToBlacklist {
            config: ctx.accounts.gatekeeper_config.to_account_info(),
            authority: ctx.accounts.asset_protection.to_account_info(),
            target_address: ctx.accounts.target_address.to_account_info(),
            blacklist_entry: ctx.accounts.blacklist_entry.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer_hook_gatekeeper::cpi::add_to_blacklist(cpi_ctx)?;

        emit!(AddressBlacklisted {
            address: *ctx.accounts.target_address.key,
            authority: *ctx.accounts.asset_protection.key,
        });

        Ok(())
    }

    /// @dev Removes an address from the transfer blacklist.
    pub fn remove_from_blacklist(ctx: Context<RemoveBlacklist>) -> Result<()> {
        let cpi_program = ctx.accounts.gatekeeper_program.to_account_info();
        let cpi_accounts = transfer_hook_gatekeeper::cpi::accounts::RemoveFromBlacklist {
            config: ctx.accounts.gatekeeper_config.to_account_info(),
            authority: ctx.accounts.asset_protection.to_account_info(),
            target_address: ctx.accounts.target_address.to_account_info(),
            blacklist_entry: ctx.accounts.blacklist_entry.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer_hook_gatekeeper::cpi::remove_from_blacklist(cpi_ctx)?;

        emit!(AddressUnblacklisted {
            address: *ctx.accounts.target_address.key,
            authority: *ctx.accounts.asset_protection.key,
        });

        Ok(())
    }

    /// @dev Wipes tokens from a blacklisted address using the Permanent Delegate power.
    pub fn wipe_blacklisted_address(ctx: Context<WipeAddress>, amount: u64) -> Result<()> {
        require!(amount > 0, GoldTokenError::InvalidAmount);
        require!(
            !ctx.accounts.blacklist_entry.data_is_empty(),
            GoldTokenError::AddressNotBlacklisted
        );
        require!(
            ctx.accounts.target_token_account.amount >= amount,
            GoldTokenError::InsufficientBalance
        );
        
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.target_token_account.to_account_info(),
                    authority: ctx.accounts.asset_protection.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(TokensWiped {
            target_user: *ctx.accounts.target_user.key,
            amount,
            authority: *ctx.accounts.asset_protection.key,
        });

        Ok(())
    }
}


#[derive(Accounts)]
#[instruction(name: String, symbol: String, uri: String, transfer_fee_basis_points: u16, maximum_fee: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: Authority account, constrained at mint creation.
    pub supply_controller: AccountInfo<'info>,
    /// Asset protection authority - must be signer for gatekeeper initialization
    pub asset_protection: Signer<'info>,
    /// CHECK: Authority account, constrained at mint creation.
    pub fee_controller: AccountInfo<'info>,
    pub gatekeeper_program: Program<'info, TransferHookGatekeeper>,

    #[account(
        init, 
        payer = admin, 
        space = 8 + 32*6 + 8 + 1,
        seeds = [b"config"], 
        bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: This is the config account for the gatekeeper program.
    #[account(mut)]
    pub gatekeeper_config: AccountInfo<'info>,

    /// CHECK: ExtraAccountMetaList account for the transfer hook
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        seeds::program = gatekeeper_program
    )]
    pub extra_account_meta_list: AccountInfo<'info>,

    /// CHECK: Mint account will be manually created with extensions
    #[account(mut)]
    pub mint: Signer<'info>,

    #[account(seeds = [b"mint_authority"], bump)]
    /// CHECK: This is a PDA.
    pub mint_authority_pda: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateRole<'info> {
    #[account(mut, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(mut, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetTransferFee<'info> {
    #[account(has_one = fee_controller)]
    pub config: Account<'info, Config>,
    pub fee_controller: Signer<'info>,
    #[account(mut, address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawWithheldTokensFromMint<'info> {
    #[account(has_one = fee_controller)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub fee_controller: Signer<'info>,
    #[account(mut, address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = fee_controller,
        associated_token::mint = mint,
        associated_token::authority = fee_controller,
        associated_token::token_program = token_program,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawWithheldTokensFromAccounts<'info> {
    #[account(has_one = fee_controller)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub fee_controller: Signer<'info>,
    #[account(mut, address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = fee_controller,
        associated_token::mint = mint,
        associated_token::authority = fee_controller,
        associated_token::token_program = token_program,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, recipient: Pubkey)]
pub struct MintTokens<'info> {
    #[account(has_one = supply_controller)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub supply_controller: Signer<'info>,
    #[account(mut, address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [b"mint_authority"], bump)]
    /// CHECK: PDA mint authority.
    pub mint_authority_pda: AccountInfo<'info>,
    
    /// The recipient who will own the tokens
    /// CHECK: Any valid Solana address can receive tokens
    pub recipient: AccountInfo<'info>,
    
    /// Associated Token Account for the recipient
    #[account(
        init_if_needed,
        payer = supply_controller,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRedemption<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(
        init, 
        payer = user, 
        space = 8 + 32 + 8 + 1 + 8 + 8 + 8 + 1, // discriminator + user + amount + status + timestamps + request_id + bump
        seeds = [b"redemption_request", user.key().as_ref(), &config.redemption_request_counter.checked_add(1).unwrap().to_le_bytes()], 
        bump
    )]
    pub redemption_request: Account<'info, RedemptionRequest>,
    #[account(mut, token::mint = mint, token::authority = user)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut, 
        seeds = [b"redemption_pda", user.key().as_ref(), &config.redemption_request_counter.checked_add(1).unwrap().to_le_bytes()], 
        bump
    )]
    /// CHECK: PDA to delegate token authority to.
    pub redemption_pda: AccountInfo<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillRedemption<'info> {
    #[account(has_one = supply_controller)]
    pub config: Account<'info, Config>,
    pub supply_controller: Signer<'info>,
    #[account(mut, close = supply_controller, has_one = user)]
    pub redemption_request: Account<'info, RedemptionRequest>,
    #[account(mut, address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: The user who made the request.
    pub user: AccountInfo<'info>,
    #[account(
        seeds = [b"redemption_pda", user.key().as_ref(), &redemption_request.request_id.to_le_bytes()], 
        bump = redemption_request.redemption_pda_bump
    )]
    /// CHECK: PDA that was delegated authority.
    pub redemption_pda: AccountInfo<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelRedemption<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, close = user, has_one = user)]
    pub redemption_request: Account<'info, RedemptionRequest>,
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct UpdateRedemptionStatus<'info> {
    #[account(has_one = supply_controller)]
    pub config: Account<'info, Config>,
    pub supply_controller: Signer<'info>,
    #[account(mut)]
    pub redemption_request: Account<'info, RedemptionRequest>,
}

#[derive(Accounts)]
pub struct UpdateBlacklist<'info> {
    #[account(has_one = asset_protection)]
    pub config: Account<'info, Config>,
    pub asset_protection: Signer<'info>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: The address to add to the blacklist.
    pub target_address: AccountInfo<'info>,
    /// CHECK: The PDA marker account for the blacklist entry.
    #[account(mut)]
    pub blacklist_entry: AccountInfo<'info>,
    pub gatekeeper_program: Program<'info, TransferHookGatekeeper>,
    /// CHECK: The config account for the gatekeeper program.
    #[account(mut)]
    pub gatekeeper_config: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveBlacklist<'info> {
    #[account(has_one = asset_protection)]
    pub config: Account<'info, Config>,
    pub asset_protection: Signer<'info>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: The address to remove from the blacklist.
    pub target_address: AccountInfo<'info>,
    /// CHECK: The PDA marker account for the blacklist entry.
    #[account(mut)]
    pub blacklist_entry: AccountInfo<'info>,
    pub gatekeeper_program: Program<'info, TransferHookGatekeeper>,
    /// CHECK: The config account for the gatekeeper program.
    #[account(mut)]
    pub gatekeeper_config: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WipeAddress<'info> {
    #[account(has_one = asset_protection)]
    pub config: Account<'info, Config>,
    pub asset_protection: Signer<'info>,
    #[account(mut, address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: The user whose tokens are being wiped.
    pub target_user: AccountInfo<'info>,
    #[account(mut, token::mint = mint, token::authority = target_user)]
    pub target_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        seeds = [b"blacklist", target_user.key().as_ref()], 
        bump, 
        seeds::program = config.gatekeeper_program
    )]
    /// CHECK: The PDA marker account for the blacklist entry.
    pub blacklist_entry: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ============================================
// DATA ACCOUNTS
// ============================================

#[account]
#[derive(Default)]
pub struct Config {
    pub admin: Pubkey,
    pub supply_controller: Pubkey,
    pub asset_protection: Pubkey,
    pub fee_controller: Pubkey,
    pub mint: Pubkey,
    pub gatekeeper_program: Pubkey,
    pub redemption_request_counter: u64,
    pub is_paused: bool,
}

#[account]
pub struct RedemptionRequest {
    pub user: Pubkey,
    pub amount: u64,
    pub status: RedemptionStatus,
    pub requested_at: i64,
    pub completed_at: i64,
    pub request_id: u64,
    pub redemption_pda_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum RedemptionStatus {
    Pending,
    Processing,
    Fulfilled,
    Cancelled,
}

#[event]
pub struct TokenInitialized {
    pub mint: Pubkey,
    pub admin: Pubkey,
    pub gatekeeper_program: Pubkey,
}

#[event]
pub struct RoleUpdated {
    pub role: String,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct PauseToggled {
    pub is_paused: bool,
    pub authority: Pubkey,
}

#[event]
pub struct TokensMinted {
    pub mint: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
    pub recipient: Pubkey,
}

#[event]
pub struct RedemptionRequested {
    pub user: Pubkey,
    pub request_id: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RedemptionFulfilled {
    pub user: Pubkey,
    pub request_id: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RedemptionCancelled {
    pub user: Pubkey,
    pub request_id: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RedemptionStatusUpdated {
    pub user: Pubkey,
    pub request_id: u64,
    pub old_status: RedemptionStatus,
    pub new_status: RedemptionStatus,
}

#[event]
pub struct AddressBlacklisted {
    pub address: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct AddressUnblacklisted {
    pub address: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct TokensWiped {
    pub target_user: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
}

#[event]
pub struct TransferFeeUpdated {
    pub mint: Pubkey,
    pub transfer_fee_basis_points: u16,
    pub maximum_fee: u64,
    pub authority: Pubkey,
}

#[event]
pub struct WithheldTokensWithdrawn {
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct WithheldTokensWithdrawnFromAccounts {
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub source_accounts: Vec<Pubkey>,
    pub authority: Pubkey,
}

// ============================================
// ERROR CODES
// ============================================

#[error_code]
pub enum GoldTokenError {
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Invalid redemption request status for this action.")]
    InvalidRequestStatus,
    #[msg("Address is not on the blacklist.")]
    AddressNotBlacklisted,
    #[msg("Counter overflow.")]
    CounterOverflow,
    #[msg("Insufficient token balance.")]
    InsufficientBalance,
    #[msg("Unauthorized access.")]
    Unauthorized,
    #[msg("Contract is paused.")]
    ContractPaused,
}