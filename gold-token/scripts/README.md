# Gold Token Scripts

This folder contains individual scripts for each function of the Gold Token program. Each script is self-contained and can be run independently.

## Prerequisites

1. Make sure you have Anchor and Solana CLI installed
2. Set up your Solana CLI wallet: `solana-keygen new` (if you don't have one)
3. Set your cluster to localnet: `solana config set --url localhost`
4. Start local validator: `solana-test-validator`
5. Build the programs: `anchor build`
6. Deploy the programs: `anchor deploy`

## Script Overview

### Core Functions
- `01-initialize.ts` - Initialize the Gold Token with all extensions
- `02-mint-tokens.ts` - Mint tokens to a recipient
- `03-transfer-tokens.ts` - Transfer tokens between accounts (with transfer hook)

### Redemption Lifecycle
- `04-request-redemption.ts` - Create a redemption request
- `05-fulfill-redemption.ts` - Fulfill a redemption request (burn tokens)
- `06-cancel-redemption.ts` - Cancel a redemption request
- `16-set-redemption-processing.ts` - Set redemption status to processing

### Blacklist Management
- `07-add-to-blacklist.ts` - Add an address to the transfer blacklist
- `08-remove-from-blacklist.ts` - Remove an address from the blacklist
- `09-wipe-blacklisted-address.ts` - Wipe tokens from a blacklisted address

### Fee Management
- `10-withdraw-fees.ts` - Withdraw accumulated transfer fees

### Admin Functions
- `11-toggle-pause.ts` - Pause/unpause the contract
- `12-update-supply-controller.ts` - Update the supply controller role
- `13-update-asset-protection.ts` - Update the asset protection role
- `14-update-fee-controller.ts` - Update the fee controller role
- `15-update-admin.ts` - Update the admin role (use carefully!)

## Usage

### Running Scripts

```bash
# Run any script with:
npx ts-node scripts/01-initialize.ts

# Or with yarn:
yarn ts-node scripts/01-initialize.ts
```

### Recommended Order

1. **Initialize the token first:**
   ```bash
   npx ts-node scripts/01-initialize.ts
   ```

2. **Mint some tokens:**
   ```bash
   npx ts-node scripts/02-mint-tokens.ts
   ```

3. **Try a transfer:**
   ```bash
   npx ts-node scripts/03-transfer-tokens.ts
   ```

4. **Test other functions as needed**

## Key Files Generated

- `redemption-request.json` - Contains redemption request info
- `blacklist-info.json` - Contains blacklist entry info

## Key Files Used

- Mint address is read from the config struct (no separate file needed)
- Role update scripts use pre-existing keypairs from `new/new*.json` files

## Account Structure

The scripts use keypairs from the `new/` folder:
- `new/admin.json` - Admin keypair
- `new/supply.json` - Supply controller keypair
- `new/asset.json` - Asset protection keypair
- `new/fee.json` - Fee controller keypair
- `new/user2.json` - Test user keypair

### New Authority Keypairs (for role updates):
- `new/newsupply.json` - New supply controller keypair
- `new/newAsset.json` - New asset protection keypair
- `new/newfee.json` - New fee controller keypair

## Important Notes

1. **Initialize First**: Always run `01-initialize.ts` before any other scripts
2. **Fund Accounts**: Scripts automatically fund accounts with SOL when needed
3. **Role Updates**: Be careful with role update scripts (12-15) as they change authorities
4. **Admin Changes**: Script 15 changes the admin - save the new keypair!
5. **Blacklist Testing**: Scripts 7-9 work together for blacklist functionality
6. **Redemption Flow**: Scripts 4-6 and 16 handle the complete redemption lifecycle

## Error Handling

- Scripts include basic error handling and will show transaction signatures
- If a script fails, check the error message and ensure prerequisites are met
- Make sure the local validator is running and programs are deployed

## Customization

You can modify the scripts to:
- Change token amounts
- Use different recipient addresses
- Test with different scenarios
- Add more detailed logging

## Security Notes

- These scripts are for testing purposes
- In production, use proper key management
- Be careful with admin functions
- Always verify transactions on-chain