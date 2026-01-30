# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SeatMint** is a decentralized ticketing platform on Cardano using **Plutus V3** (Aiken v1.1.21) and **Lucid Evolution v0.4.29**.

- **Frontend**: React (TypeScript) + Vite + Tailwind CSS v4
- **Database**: Supabase (events, tickets, ticket_tiers, secondary_listings, platform_config tables)
- **Blockchain**: Cardano Preview Testnet
- **Validation Logic**: Aiken Smart Contracts in `contracts/`
- **Transaction Building**: Lucid Evolution (Client-side in `src/services/`)
- **3D Visualization**: Three.js (SeatVisualizer venue designer)

## Environment Variables

Required in `.env`:
```
VITE_BLOCKFROST_API_KEY=<your-preview-key>
VITE_NETWORK=Preview
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_API_KEY=<your-supabase-anon-key>
```

## Development Commands

```bash
# Frontend
npm run dev          # Start Vite dev server
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint check
npm run preview      # Preview production build

# Contracts (run from contracts/ directory)
cd contracts
aiken build          # Compile validators, outputs to contracts/plutus.json
aiken check          # Run Aiken tests
aiken check -m foo   # Run tests matching "foo"
aiken docs           # Generate HTML documentation
```

**Important**: After `aiken build`, copy `contracts/plutus.json` to `src/plutus.json` to sync validators with the frontend.

## Architecture

### The 3-Pillar System

1. **Global Settings (NFT Pattern)** (`settings.ak`): A singleton UTxO containing platform config (fee %, treasury, max supply). The minting policy ensures only one Settings NFT can exist. This is NOT a spending validator—it's an NFT with inline datum that other validators `.readFrom()`. Never consume this UTxO during purchases.

2. **Event Mint Policy** (`event_mint.ak`): Parameterized minting policy for ticket NFTs. Parameters: `organizer_pkh`, `settings_token`, `box_office_hash`.

3. **Primary Sale Validator** (`primary_sale.ak`): Spending validator for initial ticket sales (box office). Payment flows: buyer pays, organizer receives revenue minus platform fee, treasury receives fee.

4. **Storefront Validator** (`storefront.ak`): Secondary market for resales. Enforces royalties, price caps, and platform fees on peer-to-peer sales. Sellers lock their ticket NFT at the storefront address with a `TicketDatum`; buyers consume that UTxO and the validator ensures proper payment distribution.

### NFT Metadata (CIP-68)

Ticket NFTs use the CIP-68 standard for updatable metadata. This allows organizers to update ticket artwork or information post-mint without changing the token's policy ID.

### Key Files

- `src/services/ticketService.ts` - All blockchain interactions (create event, purchase, list, resale, wallet sync)
- `src/services/transactionBuilder.ts` - Lower-level transaction building utilities
- `src/utils/plutusScripts.ts` - Validator loading and parameter application
- `src/hooks/useLucid.ts` - Wallet connection hook with change detection (Nami, Eternl, Lace, etc.)
- `src/hooks/useGenesis.ts` - Platform initialization hook
- `src/constants.ts` - Brand config
- `src/components/SeatVisualizer.tsx` - Three.js 3D venue designer
- `contracts/validators/types.ak` - Aiken type definitions (source of truth for datum/redeemer schemas)
- `contracts/lib/seatmint/types.ak` - Shared library types

### Navigation Architecture

The app uses internal tab-based navigation (not react-router). Tabs are defined in `Header.tsx`:
- **Primary tabs**: Setup, Events, My Tickets (all users)
- **Secondary tabs** (organizer-only): Organizer, Venue, Settings

Tab visibility is controlled by `checkOrganizerAccess()` which checks if the wallet contains the Settings NFT. Only the wallet holding the Settings NFT sees organizer tabs.

### Wallet Change Detection

The `useLucid` hook polls for wallet address changes every 2 seconds. When detected:
- `walletChanged` flag is set to `true`
- App redirects to Setup tab
- Organizer status is reset and rechecked
- Toast notification informs user

### Type Definitions Alignment

Types are defined in Aiken (`contracts/validators/types.ak`) and must be mirrored in TypeScript using Lucid Evolution's `Data` schemas. Key types:

| Aiken Type | TypeScript Schema | Purpose |
|------------|------------------|---------|
| `GlobalSettings` | `GlobalSettingsSchema` | Platform configuration |
| `SaleDatum` | `SaleDatumSchema` | Primary sale UTxO datum |
| `TicketDatum` | `TicketDatumSchema` | Secondary market listing datum |
| `MarketStatus` | `MarketStatusSchema` | Active/Inactive enum (not bool!) |

## Coding Standards (Plutus V3 + Lucid Evolution)

### Data Serialization Rules

**NEVER** manually assemble `new Constr(index, fields)` for complex types. Instead:
- Define a `Data.Object` or `Data.Enum` schema
- Use `Data.to(jsObject, Schema)` to serialize
- Use `Data.from(cbor, Schema)` to deserialize

**Exception**: Simple enum actions (MintAction, StorefrontAction) can use `new Constr(0, [])` directly.

### Boolean Encoding (Critical)

Aiken `Bool` is a CBOR primitive (`f5`/`f4`), but Lucid Evolution encodes booleans as Constr. This mismatch causes script failures.

**Solution**: Use `MarketStatus` enum instead of `Bool`:
```aiken
pub type MarketStatus {
  Inactive  // Constr(0, []) = d87980
  Active    // Constr(1, []) = d87a80
}
```

### Option Types

Aiken `Option<T>` maps to `Data.Nullable(T)`:
- `None` → `null` in TypeScript → `Constr(1, [])` in CBOR
- `Some(value)` → `value` in TypeScript → `Constr(0, [value])` in CBOR

### Address Structure

Aiken expects: `Address { payment_credential: Credential, stake_credential: Option<Credential> }`

Use the `pkhToAikenAddress(pkh)` helper in `ticketService.ts` to build proper address Constrs. Never manually parse bech32 address headers.

## Transaction Building Patterns

### Thin Client Philosophy

Do not replicate validator logic in TypeScript. Build the transaction, wrap in `try/catch`, and trust the validator to reject invalid transactions.

### Settings Reference Pattern

```typescript
const { utxo: settingsUTxO, settingsPolicyId } = await getSettingsUTxO(lucid);
// ...
tx.readFrom([settingsUTxO])  // Reference, never spend
```

### Batch Minting

Generate N unique asset names, add all to one `mintAssets` dictionary, submit as a single transaction.

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| "Settings UTxO not found on chain" | DB points to spent/missing UTxO (ghost reference) | Call `resetPlatformSettings()` then `initializePlatformSettings()` |
| "Script execution failed (Spend[0])" | Datum mismatch (usually Bool or Address) | Verify datum structure with `Data.from(datum, Schema)` before building |
| "Script execution failed (Spend[1])" | Multiple script inputs, second one failing | Check wallet UTxOs aren't at script addresses; filter with `!utxo.datum` |
| "Value Not Conserved" | Inputs ≠ Outputs + Fee | Convert ADA to lovelace: `BigInt(Math.floor(ada * 1_000_000))` |
| "Policy ID mismatch" | Wrong parameters applied to validator | Ensure organizer PKH matches event creator |
| Repeated 404s from awaitTx | Transaction rejected (double-spend or validation failure) | Check if UTxO was already spent; refresh UTxO set before building |
| Supabase 406 Not Acceptable | Using `.single()` when 0 or >1 rows | Use `.maybeSingle()` for queries that may return no results |
| ticket_number NOT NULL constraint | Insert missing ticket_number field | Query max ticket_number for tier, increment by 1 |

### Ghost Reference Pattern

When the database's `platform_config.settings_utxo_ref` points to a UTxO that no longer exists on-chain (e.g., after testnet reset), the fix is:

```typescript
// In PlatformSettings.tsx handleResetAndReinitialize
try {
  await burnSettingsNft(lucid);
} catch (err) {
  if (err.message.includes('not found on chain')) {
    await resetPlatformSettings();  // Clear stale DB reference
  }
}
await initializePlatformSettings(lucid, {...});
```

### Database/Chain Desync

The `awaitTx()` call can timeout/fail even if the transaction succeeded on-chain. To prevent desync, record purchases **optimistically** after `submit()` but before `awaitTx()`:

```typescript
const txHash = await signedTx.submit();
await recordTicketPurchase(params, ticketNames, txHash, buyerAddress);  // Optimistic
await lucid.awaitTx(txHash);  // May fail but tx might be on-chain
```

## Platform Initialization

Before any events can be created, platform settings must be initialized once:

```typescript
import { initializePlatformSettings } from './services/ticketService';
await initializePlatformSettings(lucid, { platformFeeBps: 250 });
```

This creates the Settings NFT that all validators reference. Settings are stored in Supabase `platform_config` table.

## Sale UTxO Selection

Multiple events share the same `primary_sale` script address. When purchasing, find the correct sale UTxO by matching the `event_policy` field in the datum:

```typescript
const saleUTxOs = await lucid.utxosAt(saleAddress);
const saleUTxO = saleUTxOs.find(utxo => {
  const decoded = Data.from(utxo.datum);
  return decoded.fields[2] === tier.events.event_policy_id;  // event_policy is 3rd field
});
```

## Database Schema Notes

- **tickets.current_owner_address**: Must exactly match the connected wallet's bech32 address for "My Tickets" queries
- **tickets.ticket_number**: Required NOT NULL field; use `maybeSingle()` to find max, then increment
- **ticket_tiers.remaining_supply**: Decremented on purchase; use RPC `decrement_tier_supply` or direct update fallback
- **platform_config**: Singleton row (id='main') storing settings_policy_id and settings_utxo_ref

## Wallet Sync Pattern (DB as Cache)

The database is a cache; on-chain state is the source of truth. Use `syncWalletTickets()` to reconcile:

```typescript
import { syncWalletTickets, deduplicateTickets } from './services/ticketService';
const result = await syncWalletTickets(lucid, userAddress);
// result: { discovered: 2, updated: 1, alreadySynced: 5, missingFromWallet: 1, duplicatesRemoved: 0 }
```

**Behavior**:
- First runs deduplication to remove duplicate ticket records (same `nft_asset_name`)
- Scans wallet UTxOs for NFTs matching known event policy IDs
- Creates DB records for tickets found in wallet but not in DB (discovered)
- Updates ownership for tickets transferred to this wallet (updated)
- Marks tickets in DB that are NOT in wallet as 'transferred' (missingFromWallet)

**Ticket Status Flow**:
- `minted` → User owns ticket, it's in their wallet
- `listed` → Ticket is on storefront for resale (set by `listTicketForResale`)
- `transferred` → Ticket left wallet without proper DB update (caught by sync)

**When to sync**: Auto-syncs on TicketMarketplace load; manual sync button available.

## SeatVisualizer (Three.js Venue Designer)

Located at `src/components/SeatVisualizer.tsx`. Organizer-only tool for designing venue layouts.

**Features**:
- Design mode: Configure tiers (Orchestra, Mezzanine), stage width, obstructions
- Preview mode: Click seats to view from that position (POV camera)
- Venue templates: Stadium, Club, Amphitheater presets
- Instanced meshes for performance with large seat counts

**Integration notes**:
- Requires parent container with explicit height: `style={{ height: 'calc(100vh - 4rem)' }}` (accounting for header)
- Component has retry logic for 0-dimension container (waits for layout to complete)
- Uses WebGL; check for browser support if rendering issues occur
- Currently standalone; future work to connect seat metadata with ticket NFTs

## Toast Notifications

Use the toast context for user feedback on transactions:

```typescript
import { useToast } from './contexts/ToastContext';
const toast = useToast();

// Transaction flow
const id = toast.pending('Purchasing tickets...');
try {
  await purchaseTickets(...);
  toast.updateToast(id, { type: 'success', title: 'Purchase complete!' });
} catch (err) {
  toast.updateToast(id, { type: 'error', title: 'Purchase failed', message: err.message });
}
```

## Git Workflow

- Create feature branches for all non-trivial work
- Run `npm run lint` and `npm run build` before committing
- Ensure Aiken tests pass: `cd contracts && aiken check`
