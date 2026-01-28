# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SeatMint** is a decentralized ticketing platform on Cardano using **Plutus V3** (Aiken >= v1.1.17) and **Lucid Evolution**.

- **Frontend**: React (TypeScript) + Vite + Tailwind CSS
- **Database**: Supabase (events, tickets, ticket_tiers, secondary_listings, platform_config tables)
- **Blockchain**: Cardano (Preprod/Preview)
- **Validation Logic**: Aiken Smart Contracts in `contracts/`
- **Transaction Building**: Lucid Evolution (Client-side in `src/services/`)

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

1. **Global Settings (NFT Pattern)**: A singleton UTxO containing platform config (fee %, treasury, max supply). This is NOT a spending validator—it's an NFT with inline datum that other validators `.readFrom()`. Never consume this UTxO during purchases.

2. **Event Mint Policy** (`event_mint.ak`): Parameterized minting policy for ticket NFTs. Parameters: `organizer_pkh`, `settings_token`, `box_office_hash`.

3. **Primary Sale Validator** (`primary_sale.ak`): Spending validator for initial ticket sales (box office). Payment flows: buyer pays, organizer receives revenue minus platform fee, treasury receives fee.

4. **Storefront Validator** (`storefront.ak`): Secondary market for resales. Enforces royalties, price caps, and platform fees on peer-to-peer sales.

### Key Files

- `src/services/ticketService.ts` - All blockchain interactions (create event, purchase, list, resale)
- `src/services/transactionBuilder.ts` - Lower-level transaction building utilities
- `src/utils/plutusScripts.ts` - Validator loading and parameter application
- `contracts/validators/types.ak` - Aiken type definitions (source of truth for datum/redeemer schemas)
- `contracts/lib/seatmint/types.ak` - Shared library types

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
| "Settings UTxO not found on chain" | DB points to spent UTxO | Delete `platform_config` row, re-run `initializePlatformSettings()` |
| "Script execution failed (Spend[0])" | Datum mismatch (usually Bool or Address) | Verify datum structure with `Data.from(datum, Schema)` before building |
| "Value Not Conserved" | Inputs ≠ Outputs + Fee | Convert ADA to lovelace: `BigInt(Math.floor(ada * 1_000_000))` |
| "Policy ID mismatch" | Wrong parameters applied to validator | Ensure organizer PKH matches event creator |

## Platform Initialization

Before any events can be created, platform settings must be initialized once:

```typescript
import { initializePlatformSettings } from './services/ticketService';
await initializePlatformSettings(lucid, { platformFeeBps: 250 });
```

This creates the Settings NFT that all validators reference. Settings are stored in Supabase `platform_config` table.

## Git Workflow

- Create feature branches for all non-trivial work
- Run `npm run lint` and `npm run build` before committing
- Ensure Aiken tests pass: `cd contracts && aiken check`
