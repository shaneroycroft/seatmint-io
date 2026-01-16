import { Data, Constr } from "@lucid-evolution/lucid";

// ============================================
// 1. GLOBAL SETTINGS (Governance)
// ============================================

export const GlobalSettingsSchema = Data.Object({
  platform_fee_bps: Data.Integer(),
  platform_treasury: Data.Bytes(), 
  is_market_active: Data.Boolean(),
  current_max_supply: Data.Integer(),
  max_resale_multiplier: Data.Integer(),
  admin_pkh: Data.Bytes(),
});

export type GlobalSettings = Data.Static<typeof GlobalSettingsSchema>;

// ============================================
// 2. MINTING POLICY (Factory)
// ============================================

export const MintActionSchema = Data.Enum([
  Data.Literal("Mint"), // Index 0
  Data.Literal("Burn"), // Index 1
]);

export type MintAction = Data.Static<typeof MintActionSchema>;

export const MintRedeemer = {
  Mint: new Constr(0, []),
  Burn: new Constr(1, []),
};

// ============================================
// 3. PRIMARY SALE (Box Office)
// ============================================

export const SaleDatumSchema = Data.Object({
  organizer_address: Data.Bytes(),
  base_price: Data.Integer(),
  event_policy: Data.Bytes(),
  sale_window: Data.Nullable(
    Data.Object({
      start_time: Data.Integer(),
      end_time: Data.Integer(),
    })
  ),
  anti_scalping_rules: Data.Nullable(
    Data.Object({
      max_per_transaction: Data.Integer(),
      max_per_wallet: Data.Integer(),
      cooldown_period: Data.Integer(),
    })
  ),
  whitelist: Data.Nullable(
    Data.Object({
      approved_addresses: Data.Array(Data.Bytes()),
    })
  ),
  pricing_strategy: Data.Enum([
    Data.Object({ FixedPrice: Data.Object({ price: Data.Integer() }) }), 
  ]),
});

export type SaleDatum = Data.Static<typeof SaleDatumSchema>;

// ============================================
// 4. STOREFRONT (Secondary Market)
// ============================================

export const TicketDatumSchema = Data.Object({
  event_policy: Data.Bytes(),
  token_name: Data.Bytes(),
  original_mint_price: Data.Integer(),
  price: Data.Integer(),
  artist: Data.Bytes(),
  royalty_rate: Data.Integer(),
  seller: Data.Bytes(),
  event_id: Data.Bytes(),
  seat_number: Data.Nullable(Data.Integer()),
});

export type TicketDatum = Data.Static<typeof TicketDatumSchema>;

export const StorefrontActionSchema = Data.Enum([
  Data.Object({ Buy: Data.Object({ buyer: Data.Bytes() }) }), 
  Data.Literal("Cancel"),                                     
  Data.Object({ TransferTicket: Data.Object({ new_owner: Data.Bytes() }) }), 
]);

/**
 * FIXES: 
 * 1. Removed unused LucidEvolution import.
 * 2. Fixed arrow function syntax for Transfer.
 * 3. Corrected inner Constr nesting for Aiken compatibility.
 */
export const StorefrontRedeemer = {
  Buy: (buyerPkh: string) => new Constr(0, [buyerPkh]),
  Cancel: new Constr(1, []),
  Transfer: (newOwnerPkh: string) => new Constr(2, [newOwnerPkh]),
};