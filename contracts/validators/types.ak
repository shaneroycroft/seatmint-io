use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}

// ============================================
// CORE PLATFORM TYPES
// ============================================

/// Global platform settings stored in singleton UTxO
/// Referenced by all validators for consistent configuration
pub type GlobalSettings {
  // Platform economics (basis points for precision)
  platform_fee_bps: Int,
  // basis points (250 = 2.5%)
  platform_treasury: Address,
  // Platform controls
  is_market_active: Bool,
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
/// Extensible design allows features to be enabled/disabled per event
pub type SaleDatum {
  // Core identification
  organizer_address: Address,
  base_price: Int,
  // Price in lovelace
  event_policy: PolicyId,
  // Policy ID for minting NFTs
  // Optional features (None = feature disabled)
  sale_window: Option<TimeWindow>,
  anti_scalping_rules: Option<AntiScalpingRules>,
  whitelist: Option<Whitelist>,
  pricing_strategy: PricingStrategy,
}

/// Time-based sale windows (presales, early access, limited availability)
pub type TimeWindow {
  start_time: Int,
  // POSIXTime in milliseconds
  end_time: Int,
}

// POSIXTime in milliseconds

/// Whitelist for presales and early access
pub type Whitelist {
  approved_addresses: List<VerificationKeyHash>,
}

/// Anti-scalping configuration to prevent bulk buying
pub type AntiScalpingRules {
  max_per_transaction: Int,
  // Limit per tx (e.g., 4 tickets)
  max_per_wallet: Int,
  // Total limit per address (future: requires state tracking)
  cooldown_period: Int,
}

// Seconds between purchases (future: requires state tracking)

/// Pricing strategies (extensible for future features)
pub type PricingStrategy {
  FixedPrice { price: Int }
}

// Future: TimeBased, DemandBased, Tiered, etc.

/// Purchase action for primary sales
pub type SaleRedeemer {
  quantity: Int,
  payment_amount: Int,
  // Total payment in lovelace
  buyer_pkh: VerificationKeyHash,
}

// Buyer's public key hash

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
// ============================================
// FUTURE ENHANCEMENT TYPES (Commented for reference)
// ============================================

// /// Window types for different sale phases
// pub type WindowType {
//   Presale           // Whitelist-only early access
//   EarlyBird         // Discounted pricing for early buyers
//   GeneralSale       // Open to everyone
//   LastChance        // Final hours before event
// }

// /// Merkle proof for gas-efficient large whitelists
// pub type MerkleProof {
//   leaf: ByteArray,
//   siblings: List<ByteArray>,
// }

// /// Time-based dynamic pricing
// pub type TimePricingStrategy {
//   base_price: Int,
//   early_bird_price: Int,
//   early_bird_deadline: Int,      // POSIXTime
//   surge_price: Int,
//   surge_threshold: Int,           // Hours before event
// }

// /// Demand-based pricing (surge pricing)
// pub type DemandPricingStrategy {
//   base_price: Int,
//   max_price: Int,
//   surge_multiplier: Int,          // e.g., 150 = 1.5x price
//   velocity_threshold: Int,        // Sales per hour to trigger surge
// }

// /// Tiered pricing (volume discounts)
// pub type TieredPricingStrategy {
//   tiers: List<PriceTier>,
// }

// pub type PriceTier {
//   quantity_threshold: Int,        // Buy 5+ tickets
//   price_per_ticket: Int,          // Get discounted price
// }

// ============================================
// OFF-CHAIN TYPES (For analytics/tracking)
// ============================================

// These types are primarily for off-chain use and can be stored
// in databases or used for reporting/analytics

// /// Sale analytics for tracking and reporting
// pub type SaleAnalytics {
//   total_sold: Int,
//   revenue_generated: Int,
//   unique_buyers: Int,
//   average_purchase_size: Int,
//   peak_sale_velocity: Int,        // Tickets sold per hour
//   last_purchase_time: Int,        // POSIXTime
// }

// /// Pre-configured sale templates for easy event creation
// pub type SalePreset {
//   StandardSale              // Basic fixed-price sale
//   PresaleWithWhitelist      // Whitelist + time window
//   AntiScalpingEnabled       // Purchase limits + cooldown
//   DynamicPricing            // Time-based or demand-based
//   VIPAccess                 // Tiered pricing with early access
// }

// ============================================
// TYPE ALIASES (For clarity)
// ============================================

// Note: These are just documentation - Aiken doesn't have type aliases
// Use Int directly in code, these comments explain the meaning

// Lovelace = Int           // Amount in lovelace (1 ADA = 1,000,000 lovelace)
// BasisPoints = Int        // Percentage in basis points (250 = 2.5%, 1000 = 10%)
// POSIXTime = Int          // Unix timestamp in milliseconds
// Quantity = Int           // Number of tickets/items
