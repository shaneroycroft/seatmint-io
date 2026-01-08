use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{Lovelace}

pub type GlobalSettings {
  platform_fee_percent: Int,
  platform_treasury: Address,
  current_max_supply: Int,
  max_resale_multiplier: Int,
  is_market_active: Bool,
  admin_pkh: VerificationKeyHash,
}

pub type TicketDatum {
  price: Lovelace,
  seller: Address,
  artist: Address,
  royalty_rate: Int,
  original_mint_price: Lovelace,
}

// Added for anti-scalper check

pub type StorefrontAction {
  Buy
  Cancel
}

pub type MintAction {
  Mint
  Burn
}
