use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}

// ============================================
// CORE PLATFORM TYPES
// ============================================

/// Market status enum - used instead of Bool for Lucid compatibility
/// Aiken's Bool is a CBOR primitive (f5/f4), but Lucid uses Constr wrappers.
pub type MarketStatus {
  Inactive  // Constr(0, []) = d87980
  Active    // Constr(1, []) = d87a80
}

/// Global platform settings stored in singleton UTxO
/// Referenced by all validators for consistent configuration
pub type GlobalSettings {
  // Platform economics (basis points for precision)
  platform_fee_bps: Int,
  // basis points (250 = 2.5%)
  platform_treasury: Address,
  // Platform controls
  is_market_active: MarketStatus,
  current_max_supply: Int,
  max_resale_multiplier: Int,
  // basis points (300 = 3x max resale)
  // Governance
  admin_pkh: VerificationKeyHash,
}

/// Settings update actions
pub type SettingsRedeemer {
  UpdateFee
  UpdateTreasury
  ToggleMarket
  UpdateSupply
  UpdateResaleMultiplier
  TransferAdmin
}

// ============================================
// MINTING TYPES
// ============================================

/// Event/ticket minting actions
pub type MintAction {
  Mint
  Burn
}

// ============================================
// PRIMARY SALE TYPES (Box Office)
// ============================================

/// Primary sale configuration stored in UTxO datum
/// Simplified for basic buy flow - additional features can be added later
pub type SaleDatum {
  organizer_address: Address,
  base_price: Int,
  event_policy: PolicyId,
}

/// Purchase action for primary sales
/// Payment is calculated as: base_price * quantity
pub type SaleRedeemer {
  quantity: Int,
  buyer_pkh: VerificationKeyHash,
}

// ============================================
// SECONDARY MARKET TYPES (Storefront)
// ============================================

/// Ticket listing datum for secondary market
pub type TicketDatum {
  // NFT identification
  event_policy: PolicyId,
  token_name: AssetName,
  // Pricing & anti-scalping
  original_mint_price: Int,
  // Original price from primary sale
  price: Int,
  // Current listing price in lovelace
  // Royalties & ownership
  artist: Address,
  // Event organizer (receives royalties)
  royalty_rate: Int,
  // basis points (1000 = 10%)
  seller: Address,
  // Current ticket holder
  // Optional metadata
  event_id: ByteArray,
  seat_number: Option<Int>,
}

/// Storefront actions for secondary market
pub type StorefrontAction {
  Buy { buyer: Address }
  Cancel
  TransferTicket { new_owner: Address }
}
