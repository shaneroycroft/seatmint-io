use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite, Interval, IntervalBound}
use aiken/option
use aiken/primitive/bytearray
use cardano/address.{Address, Credential, VerificationKey}
use cardano/address/credential
use cardano/assets.{PolicyId, quantity_of, zero, from_lovelace, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, ValidityRange,
  placeholder,
}

// ============================================
// TYPE DEFINITIONS
// ============================================

/// Global platform settings
pub type GlobalSettings {
  is_market_active: Bool,
  current_max_supply: Int,
  platform_fee_bps: Int,
}

/// Time window for sales (presale, limited availability)
pub type TimeWindow {
  start_time: Int,
  end_time: Int,
}

/// Anti-scalping rules to prevent bulk buying
pub type AntiScalpingRules {
  max_per_transaction: Int,
  max_per_wallet: Int,
  cooldown_period: Int,
}

/// Whitelist for presales
pub type Whitelist {
  approved_addresses: List<VerificationKeyHash>,
}

/// Pricing strategies (extensible design)
pub type PricingStrategy {
  FixedPrice { price: Int }
  // Future: TimeBased, DemandBased, etc.
}

/// Sale configuration stored in UTXO datum
pub type SaleDatum {
  organizer_address: Address,
  base_price: Int,
  event_policy: PolicyId,
  // Optional features (None = feature disabled)
  sale_window: Option<TimeWindow>,
  anti_scalping_rules: Option<AntiScalpingRules>,
  whitelist: Option<Whitelist>,
  pricing_strategy: PricingStrategy,
}

/// Purchase action
pub type SaleRedeemer {
  quantity: Int,
  payment_amount: Int,
  buyer_pkh: VerificationKeyHash,
}

/// Primary Sale Validator (Box Office) - Extensible Design
/// 
/// This validator manages initial ticket sales with support for:
/// - ✅ MVP: Basic sales with market control
/// - 🔮 Future: Presales, anti-scalping, dynamic pricing, time windows
/// 
/// Architecture allows adding features without breaking existing sales
validator primary_sale(settings_token: PolicyId) {
  spend(
    datum_opt: Option<Data>,
    redeemer: Data,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    // Decode the datum (contains sale configuration)
    expect Some(datum_raw) = datum_opt
    expect sale_datum: SaleDatum = datum_raw

    // Decode the redeemer (purchase action)
    expect sale_redeemer: SaleRedeemer = redeemer

    // Get global platform settings
    expect Some(settings_input) =
      list.find(
        self.reference_inputs,
        fn(input: Input) {
          quantity_of(input.output.value, settings_token, "Settings") == 1
        },
      )

    expect InlineDatum(settings_raw) = settings_input.output.datum
    expect settings: GlobalSettings = settings_raw

    // ============================================
    // VALIDATION PIPELINE
    // Each check can be enabled/disabled per event
    // ============================================

    // 1. Platform-Level Check (Always Required)
    let market_active = validate_market_active(settings)

    // 2. Time Window Check (Optional - for presales/limited windows)
    let time_valid = validate_time_window(sale_datum, self)

    // 3. Anti-Scalping Check (Optional - prevent bulk buying)
    let anti_scalping =
      validate_purchase_limits(sale_datum, sale_redeemer, self)

    // 4. Whitelist Check (Optional - presale access control)
    let whitelist_valid = validate_whitelist(sale_datum, self)

    // 5. Pricing Validation (Always Required)
    let pricing_valid = validate_pricing(sale_datum, sale_redeemer)

    // 6. Payment Validation (Always Required)
    let payment_valid = validate_payment(sale_datum, sale_redeemer, self, settings)

    // 7. Buyer Authorization (Always Required)
    let buyer_authorized = list.has(self.extra_signatories, sale_redeemer.buyer_pkh)

    // 8. NFT Minting Check (Ensure ticket NFT is minted)
    let nft_minted = validate_nft_minting(sale_datum, sale_redeemer, self)

    // Combine all validations
    market_active && time_valid && anti_scalping && whitelist_valid && pricing_valid && payment_valid && buyer_authorized && nft_minted
  }

  else(_) {
    fail
  }
}

// ============================================
// VALIDATION FUNCTIONS
// Each feature is modular and can be toggled
// ============================================

/// 1. Market Active (MVP - Always On)
fn validate_market_active(settings: GlobalSettings) -> Bool {
  settings.is_market_active == True
}

/// 2. Time Window Validation (Optional Feature)
/// Checks if current time is within sale window
fn validate_time_window(datum: SaleDatum, tx: Transaction) -> Bool {
  when datum.sale_window is {
    // No time restriction - always valid
    None -> True
    // Time window defined - check bounds
    Some(window) -> {
      // Get transaction validity range
      let valid_range = tx.validity_range

      // Extract lower bound time (must be after start_time)
      let after_start =
        when valid_range.lower_bound is {
          IntervalBound { bound_type: Finite(time), .. } ->
            time >= window.start_time
          _ -> False
        }

      // Extract upper bound time (must be before end_time)
      let before_end =
        when valid_range.upper_bound is {
          IntervalBound { bound_type: Finite(time), .. } -> time <= window.end_time
          _ -> False
        }

      after_start && before_end
    }
  }
}

/// 3. Anti-Scalping Validation (Optional Feature)
/// Prevents bulk buying and enforces per-wallet limits
fn validate_purchase_limits(
  datum: SaleDatum,
  redeemer: SaleRedeemer,
  _tx: Transaction,
) -> Bool {
  when datum.anti_scalping_rules is {
    // No anti-scalping - always valid
    None -> True
    // Anti-scalping enabled
    Some(rules) -> {
      // Check quantity per transaction
      let within_tx_limit = redeemer.quantity <= rules.max_per_transaction
      // Additional checks (cooldown, wallet limit) would require
      // reference inputs to historical purchase state
      // For MVP, we only enforce per-transaction limit
      within_tx_limit
    }
  }
}

/// 4. Whitelist Validation (Optional Feature - Presales)
/// Only allows purchases from approved addresses
fn validate_whitelist(datum: SaleDatum, tx: Transaction) -> Bool {
  when datum.whitelist is {
    // No whitelist - public sale
    None -> True
    // Whitelist enabled - check buyer
    Some(whitelist) -> {
      // Get buyer's PKH from extra_signatories
      // The buyer must sign the transaction
      list.any(
        tx.extra_signatories,
        fn(pkh: VerificationKeyHash) {
          list.has(whitelist.approved_addresses, pkh)
        },
      )
    }
  }
}

/// 5. Pricing Validation (Always On)
/// Ensures correct price is paid based on strategy
fn validate_pricing(datum: SaleDatum, redeemer: SaleRedeemer) -> Bool {
  when datum.pricing_strategy is {
    // Fixed price - check against datum
    FixedPrice { price } -> {
      let expected_payment = price * redeemer.quantity
      redeemer.payment_amount >= expected_payment
    }
  }
}

/// 6. Payment Validation (MVP - Always On)
/// Ensures correct payment is sent to organizer
fn validate_payment(
  datum: SaleDatum,
  redeemer: SaleRedeemer,
  tx: Transaction,
  settings: GlobalSettings,
) -> Bool {
  // Find payment to organizer
  expect Some(organizer_output) =
    list.find(
      tx.outputs,
      fn(output: Output) { output.address == datum.organizer_address },
    )

  // Calculate expected payment
  let gross_payment = redeemer.payment_amount
  let platform_fee = ( gross_payment * settings.platform_fee_bps ) / 10000
  let net_to_organizer = gross_payment - platform_fee

  // Verify organizer receives correct amount
  let lovelace_received = assets.lovelace_of(organizer_output.value)

  lovelace_received >= net_to_organizer
}

/// 7. NFT Minting Validation (Always On)
/// Ensures ticket NFTs are actually minted
fn validate_nft_minting(
  datum: SaleDatum,
  redeemer: SaleRedeemer,
  tx: Transaction,
) -> Bool {
  // Check if the correct number of NFTs are minted
  let minted_tokens = assets.tokens(tx.mint, datum.event_policy)

  // Count total minted (should equal purchase quantity)
  let total_minted =
    dict.foldl(
      minted_tokens,
      0,
      fn(_name, qty, acc) { acc + qty },
    )

  total_minted == redeemer.quantity
}

// ============================================
// HELPER FUNCTIONS FOR TESTING
// ============================================

fn mock_address(pkh: ByteArray) -> Address {
  Address(VerificationKey(pkh), None)
}

fn mock_settings_input(
  settings_policy: PolicyId,
  is_active: Bool,
  fee_bps: Int,
) -> Input {
  let settings_datum =
    GlobalSettings {
      is_market_active: is_active,
      current_max_supply: 1000,
      platform_fee_bps: fee_bps,
    }

  Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    },
    output: Output {
      address: mock_address(
        #"0000000000000000000000000000000000000000000000000000000000",
      ),
      value: from_asset(settings_policy, "Settings", 1),
      datum: InlineDatum(settings_datum),
      reference_script: None,
    },
  }
}

fn mock_sale_datum(organizer_pkh: ByteArray, price: Int) -> SaleDatum {
  SaleDatum {
    organizer_address: mock_address(organizer_pkh),
    base_price: price,
    event_policy: #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    sale_window: None,
    anti_scalping_rules: None,
    whitelist: None,
    pricing_strategy: FixedPrice { price: price },
  }
}

// ============================================
// FUZZ TESTS
// ============================================

test basic_purchase_succeeds() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let quantity = 2
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let settings_policy = #"5555555555555555555555555555555555555555555555555555"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let price = 10_000_000
  let sale_datum = mock_sale_datum(organizer_pkh, price)
  let datum_data: Data = sale_datum
  let redeemer_data: Data =
    SaleRedeemer {
      quantity: quantity,
      payment_amount: price * quantity,
      buyer_pkh: buyer_pkh,
    }

  let organizer_output =
    Output {
      address: mock_address(organizer_pkh),
      value: from_lovelace(price * quantity - ( price * quantity * 250 ) / 10000),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, True, 250)],
      outputs: [organizer_output],
      mint: from_asset(event_policy, #"4576656e742d303031", quantity),
    }

  primary_sale.spend(
    settings_policy,
    Some(datum_data),
    redeemer_data,
    OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    tx,
  )
}

test purchase_fails_when_market_closed() {
  let organizer_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let buyer_pkh = #"2222222222222222222222222222222222222222222222222222222222"
  let settings_policy = #"5555555555555555555555555555555555555555555555555555"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let price = 10_000_000
  let sale_datum = mock_sale_datum(organizer_pkh, price)
  let datum_data: Data = sale_datum
  let redeemer_data: Data =
    SaleRedeemer { quantity: 1, payment_amount: price, buyer_pkh: buyer_pkh }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, False, 250)],
      outputs: [],
      mint: from_asset(event_policy, #"4576656e742d303031", 1),
    }

  !primary_sale.spend(
    settings_policy,
    Some(datum_data),
    redeemer_data,
    OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    tx,
  )
}

test purchase_fails_without_buyer_signature() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let settings_policy = #"5555555555555555555555555555555555555555555555555555"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let price = 10_000_000
  let sale_datum = mock_sale_datum(organizer_pkh, price)
  let datum_data: Data = sale_datum
  let redeemer_data: Data =
    SaleRedeemer { quantity: 1, payment_amount: price, buyer_pkh: buyer_pkh }

  // Calculate expected organizer payment (price - platform fee)
  let platform_fee = price * 250 / 10000
  let organizer_payment = price - platform_fee

  let organizer_output =
    Output {
      address: mock_address(organizer_pkh),
      value: from_lovelace(organizer_payment),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [],
      // Buyer hasn't signed!
      reference_inputs: [mock_settings_input(settings_policy, True, 250)],
      outputs: [organizer_output],
      mint: from_asset(event_policy, #"4576656e742d303031", 1),
    }

  !primary_sale.spend(
    settings_policy,
    Some(datum_data),
    redeemer_data,
    OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    tx,
  )
}

test anti_scalping_limits_quantity() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let settings_policy = #"5555555555555555555555555555555555555555555555555555"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let price = 10_000_000
  let sale_datum =
    SaleDatum {
      organizer_address: mock_address(organizer_pkh),
      base_price: price,
      event_policy: event_policy,
      sale_window: None,
      anti_scalping_rules: Some(
        AntiScalpingRules {
          max_per_transaction: 4,
          max_per_wallet: 10,
          cooldown_period: 3600,
        },
      ),
      whitelist: None,
      pricing_strategy: FixedPrice { price: price },
    }
  let datum_data: Data = sale_datum

  // Try to buy 5 tickets (exceeds max of 4)
  let redeemer_data: Data =
    SaleRedeemer {
      quantity: 5,
      payment_amount: price * 5,
      buyer_pkh: buyer_pkh,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, True, 250)],
      outputs: [],
      mint: from_asset(event_policy, #"4576656e742d303031", 5),
    }

  !primary_sale.spend(
    settings_policy,
    Some(datum_data),
    redeemer_data,
    OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    tx,
  )
}

test whitelist_blocks_non_approved() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let whitelisted_pkh = #"4444444444444444444444444444444444444444444444444444444444"
  let settings_policy = #"5555555555555555555555555555555555555555555555555555"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let price = 10_000_000
  let sale_datum =
    SaleDatum {
      organizer_address: mock_address(organizer_pkh),
      base_price: price,
      event_policy: event_policy,
      sale_window: None,
      anti_scalping_rules: None,
      whitelist: Some(Whitelist { approved_addresses: [whitelisted_pkh] }),
      pricing_strategy: FixedPrice { price: price },
    }
  let datum_data: Data = sale_datum

  // Non-whitelisted buyer tries to purchase
  let redeemer_data: Data =
    SaleRedeemer { quantity: 1, payment_amount: price, buyer_pkh: buyer_pkh }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, True, 250)],
      outputs: [],
      mint: from_asset(event_policy, #"4576656e742d303031", 1),
    }

  !primary_sale.spend(
    settings_policy,
    Some(datum_data),
    redeemer_data,
    OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    tx,
  )
}

test purchase_fails_insufficient_payment() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let settings_policy = #"5555555555555555555555555555555555555555555555555555"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let price = 10_000_000
  let sale_datum = mock_sale_datum(organizer_pkh, price)
  let datum_data: Data = sale_datum

  // Buyer only pays half the required amount
  let redeemer_data: Data =
    SaleRedeemer {
      quantity: 1,
      payment_amount: price / 2,
      buyer_pkh: buyer_pkh,
    }

  let organizer_output =
    Output {
      address: mock_address(organizer_pkh),
      value: from_lovelace(price / 2),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, True, 250)],
      outputs: [organizer_output],
      mint: from_asset(event_policy, #"4576656e742d303031", 1),
    }

  !primary_sale.spend(
    settings_policy,
    Some(datum_data),
    redeemer_data,
    OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    tx,
  )
}