use aiken/collection/list
use cardano/address.{Address, Credential, VerificationKey}
use cardano/address/credential
use cardano/assets.{
  AssetName, PolicyId, from_asset, from_lovelace, lovelace_of, quantity_of,
}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
// Import shared types from lib/seatmint/types.ak
use seatmint/types.{
  GlobalSettings,
  StorefrontAction,
  TicketDatum,
  MarketStatus,
  Active,
  Inactive,
  // Import constructors explicitly
  Buy,
  Cancel,
  TransferTicket,
}

/// Storefront Validator (Secondary Market)
/// 
/// This validator manages peer-to-peer ticket resales between users.
/// It enforces anti-scalping rules, royalty payments, and platform fees.
/// 
/// Key Features:
/// - Anti-scalping: Caps resale prices (e.g., max 3x original price)
/// - Artist royalties: Ensures original creators get paid on resales
/// - Platform fees: Sustainable revenue model
/// - Seller protection: Only seller can cancel listings
/// - Market control: Admin can pause all resales
/// 
/// Parameters:
/// - settings_token: Reference to platform settings NFT
validator storefront(settings_token: PolicyId) {
  spend(
    datum_opt: Option<Data>,
    redeemer: Data,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    // Step 1: Get the ticket datum (listing details)
    expect Some(datum_raw) = datum_opt
    expect ticket: TicketDatum = datum_raw

    // Step 2: Decode redeemer
    expect action: StorefrontAction = redeemer

    // Step 3: Find platform settings via reference input
    expect Some(settings_input) =
      list.find(
        self.reference_inputs,
        fn(input: Input) {
          quantity_of(input.output.value, settings_token, "Settings") == 1
        },
      )

    // Step 4: Decode global settings
    expect InlineDatum(settings_raw) = settings_input.output.datum
    expect settings: GlobalSettings = settings_raw

    // Step 5: Validate action based on redeemer
    when action is {
      // BUY: Purchase a listed ticket
      Buy { buyer } -> validate_purchase(ticket, buyer, settings, self)
      // CANCEL: Remove listing (seller only)
      Cancel -> validate_cancellation(ticket, self)
      // TRANSFER: Direct peer-to-peer transfer (gift, no payment)
      TransferTicket { new_owner } -> validate_transfer(ticket, new_owner, self)
    }
  }

  else(_) {
    fail
  }
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/// Validate ticket purchase (Pillar 2: Storefront Trade Logic)
fn validate_purchase(
  ticket: TicketDatum,
  buyer: Address,
  settings: GlobalSettings,
  tx: Transaction,
) -> Bool {
  // 1. Market must be active (emergency stop check)
  let market_active = settings.is_market_active == Active

  // 2. Anti-Scalping: Enforce maximum resale price (Pillar 3)
  let max_price =
    calculate_max_price(
      ticket.original_mint_price,
      settings.max_resale_multiplier,
    )
  let price_valid = ticket.price <= max_price && ticket.price > 0

  // 3. Calculate payment splits
  let platform_fee =
    calculate_platform_fee(ticket.price, settings.platform_fee_bps)
  let artist_royalty = calculate_royalty(ticket.price, ticket.royalty_rate)
  let seller_payout = ticket.price - platform_fee - artist_royalty

  // 4. Verify all payments are made (Pillar 2: outputs check via list.any)
  let seller_paid = verify_payment(tx.outputs, ticket.seller, seller_payout)
  let artist_paid = verify_payment(tx.outputs, ticket.artist, artist_royalty)
  let treasury_paid =
    verify_payment(tx.outputs, settings.platform_treasury, platform_fee)

  // 5. Verify ticket NFT is transferred to buyer
  let ticket_transferred =
    verify_nft_transfer(
      tx.outputs,
      buyer,
      ticket.event_policy,
      ticket.token_name,
    )

  // 6. Buyer must sign transaction
  let buyer_signed = verify_address_signed(buyer, tx)

  // 7. Additional checks - no negative values
  let no_negative_values =
    seller_payout >= 0 && artist_royalty >= 0 && platform_fee >= 0

  // Trace for debugging
  trace @"purchase_validation": (
    market_active,
    price_valid,
    seller_paid,
    artist_paid,
    treasury_paid,
    ticket_transferred,
    buyer_signed,
  )

  // All checks must pass
  and {
    market_active,
    price_valid,
    seller_paid,
    artist_paid,
    treasury_paid,
    ticket_transferred,
    buyer_signed,
    no_negative_values,
  }
}

/// Validate listing cancellation (seller only)
fn validate_cancellation(ticket: TicketDatum, tx: Transaction) -> Bool {
  // Extract payment credential from seller address
  let Address { payment_credential: credential, .. } = ticket.seller

  // Seller must be a wallet (not a script) and must sign
  when credential is {
    VerificationKey(seller_pkh) -> {
      let seller_signed = list.has(tx.extra_signatories, seller_pkh)

      // Verify ticket NFT returns to seller
      let ticket_returned =
        verify_nft_transfer(
          tx.outputs,
          ticket.seller,
          ticket.event_policy,
          ticket.token_name,
        )

      seller_signed && ticket_returned
    }
    _ -> fail @"Seller must be a wallet, not a script"
  }
}

/// Validate direct transfer (gift/send to friend)
fn validate_transfer(
  ticket: TicketDatum,
  new_owner: Address,
  tx: Transaction,
) -> Bool {
  // Only current seller can transfer
  let Address { payment_credential: credential, .. } = ticket.seller

  when credential is {
    VerificationKey(seller_pkh) -> {
      let seller_signed = list.has(tx.extra_signatories, seller_pkh)

      // Verify ticket NFT goes to new owner (no payment required for gifts)
      let ticket_transferred =
        verify_nft_transfer(
          tx.outputs,
          new_owner,
          ticket.event_policy,
          ticket.token_name,
        )

      seller_signed && ticket_transferred
    }
    _ -> fail @"Only wallet holders can transfer tickets"
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/// Calculate maximum allowed resale price
fn calculate_max_price(original_price: Int, multiplier: Int) -> Int {
  // Multiplier is stored as basis points (e.g., 300 = 3x)
  original_price * multiplier / 100
}

/// Calculate platform fee
fn calculate_platform_fee(price: Int, fee_bps: Int) -> Int {
  // fee_bps is in basis points (e.g., 250 = 2.5%)
  price * fee_bps / 10000
}

/// Calculate artist royalty
fn calculate_royalty(price: Int, royalty_rate: Int) -> Int {
  // royalty_rate is in basis points (e.g., 1000 = 10%)
  price * royalty_rate / 10000
}

/// Verify a payment is made to an address
fn verify_payment(
  outputs: List<Output>,
  recipient: Address,
  amount: Int,
) -> Bool {
  list.any(
    outputs,
    fn(out: Output) {
      out.address == recipient && lovelace_of(out.value) >= amount
    },
  )
}

/// Verify NFT is transferred to specific address
fn verify_nft_transfer(
  outputs: List<Output>,
  recipient: Address,
  policy: PolicyId,
  token_name: AssetName,
) -> Bool {
  list.any(
    outputs,
    fn(out: Output) {
      out.address == recipient && quantity_of(out.value, policy, token_name) == 1
    },
  )
}

/// Verify an address has signed the transaction
fn verify_address_signed(address: Address, tx: Transaction) -> Bool {
  let Address { payment_credential: credential, .. } = address

  when credential is {
    VerificationKey(pkh) -> list.has(tx.extra_signatories, pkh)
    _ -> False
  }
}

// ============================================
// TEST HELPERS
// ============================================

fn mock_address(pkh: ByteArray) -> Address {
  Address(VerificationKey(pkh), None)
}

fn mock_settings(
  fee_bps: Int,
  treasury: Address,
  is_active: MarketStatus,
  max_resale: Int,
) -> GlobalSettings {
  GlobalSettings {
    platform_fee_bps: fee_bps,
    platform_treasury: treasury,
    is_market_active: is_active,
    current_max_supply: 1000,
    max_resale_multiplier: max_resale,
    admin_pkh: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }
}

fn mock_ticket(
  seller: Address,
  artist: Address,
  original_price: Int,
  current_price: Int,
  royalty: Int,
) -> TicketDatum {
  TicketDatum {
    event_policy: #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    token_name: #"4576656e742d303031",
    original_mint_price: original_price,
    price: current_price,
    artist,
    royalty_rate: royalty,
    seller,
    event_id: #"e1e2e3123456",
    seat_number: Some(42),
  }
}

fn mock_settings_input(
  settings_policy: PolicyId,
  settings: GlobalSettings,
) -> Input {
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
      datum: InlineDatum(settings),
      reference_script: None,
    },
  }
}

// ============================================
// UNIT TESTS
// ============================================

test purchase_succeeds_within_price_cap() {
  // Fixed test values (previously fuzz-generated)
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let multiplier = 2
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let buyer = mock_address(buyer_pkh)
  let treasury = mock_address(treasury_pkh)

  let original_price = 10_000_000
  // 10 ADA
  let resale_price = original_price * multiplier

  // 1x-3x
  let settings = mock_settings(250, treasury, Active, 300)
  // 2.5% fee, 3x max
  let ticket = mock_ticket(seller, artist, original_price, resale_price, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Buy { buyer }

  // 10% royalty
  let platform_fee = resale_price * 250 / 10000
  let artist_royalty = resale_price * 1000 / 10000
  let seller_payout = resale_price - platform_fee - artist_royalty

  let buyer_output =
    Output {
      address: buyer,
      value: from_asset(event_policy, #"4576656e742d303031", 1),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let seller_output =
    Output {
      address: seller,
      value: from_lovelace(seller_payout),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let artist_output =
    Output {
      address: artist,
      value: from_lovelace(artist_royalty),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let treasury_output =
    Output {
      address: treasury,
      value: from_lovelace(platform_fee),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [buyer_output, seller_output, artist_output, treasury_output],
    }

  storefront.spend(
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

test purchase_fails_exceeding_price_cap() {
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let buyer = mock_address(buyer_pkh)
  let treasury = mock_address(treasury_pkh)

  let original_price = 10_000_000
  let resale_price = original_price * 4

  // 4x exceeds 3x cap
  let settings = mock_settings(250, treasury, Active, 300)
  let ticket = mock_ticket(seller, artist, original_price, resale_price, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Buy { buyer }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [],
    }

  !storefront.spend(
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

test purchase_distributes_payments_correctly() {
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let buyer = mock_address(buyer_pkh)
  let treasury = mock_address(treasury_pkh)

  let price = 20_000_000

  // 20 ADA
  let settings = mock_settings(250, treasury, Active, 300)
  // 2.5% fee
  let ticket = mock_ticket(seller, artist, 10_000_000, price, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Buy { buyer }

  // 10% royalty
  // Calculate splits correctly: 20 ADA = 20,000,000 lovelace
  let platform_fee = price * 250 / 10000
  // 500,000 lovelace (0.5 ADA = 2.5% of 20)
  let artist_royalty = price * 1000 / 10000
  // 2,000,000 lovelace (2 ADA = 10% of 20)
  let seller_payout = price - platform_fee - artist_royalty

  // 17.5 ADA after fees
  let buyer_output =
    Output {
      address: buyer,
      value: from_asset(event_policy, #"4576656e742d303031", 1),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let seller_output =
    Output {
      address: seller,
      value: from_lovelace(seller_payout),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let artist_output =
    Output {
      address: artist,
      value: from_lovelace(artist_royalty),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let treasury_output =
    Output {
      address: treasury,
      value: from_lovelace(platform_fee),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [buyer_output, seller_output, artist_output, treasury_output],
    }

  storefront.spend(
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

test cancel_succeeds_with_seller_signature() {
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let treasury = mock_address(treasury_pkh)

  let settings = mock_settings(250, treasury, Active, 300)
  let ticket = mock_ticket(seller, artist, 10_000_000, 15_000_000, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Cancel

  let seller_output =
    Output {
      address: seller,
      value: from_asset(event_policy, #"4576656e742d303031", 1),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [seller_pkh],
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [seller_output],
    }

  storefront.spend(
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

test cancel_fails_without_seller_signature() {
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let treasury = mock_address(treasury_pkh)

  let settings = mock_settings(250, treasury, Active, 300)
  let ticket = mock_ticket(seller, artist, 10_000_000, 15_000_000, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Cancel

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [],
      // No signature
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [],
    }

  !storefront.spend(
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

test purchase_fails_when_market_inactive() {
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let buyer = mock_address(buyer_pkh)
  let treasury = mock_address(treasury_pkh)

  let settings = mock_settings(250, treasury, Inactive, 300)
  // Market inactive
  let ticket = mock_ticket(seller, artist, 10_000_000, 15_000_000, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Buy { buyer }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [],
    }

  !storefront.spend(
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

test transfer_succeeds_as_gift() {
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let recipient_pkh =
    #"3333333333333333333333333333333333333333333333333333333333"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let recipient = mock_address(recipient_pkh)
  let treasury = mock_address(treasury_pkh)

  let settings = mock_settings(250, treasury, Active, 300)
  let ticket = mock_ticket(seller, artist, 10_000_000, 15_000_000, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = TransferTicket { new_owner: recipient }

  let recipient_output =
    Output {
      address: recipient,
      value: from_asset(event_policy, #"4576656e742d303031", 1),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [seller_pkh],
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [recipient_output],
    }

  storefront.spend(
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
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let buyer = mock_address(buyer_pkh)
  let treasury = mock_address(treasury_pkh)

  let settings = mock_settings(250, treasury, Active, 300)
  let ticket = mock_ticket(seller, artist, 10_000_000, 15_000_000, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Buy { buyer }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [],
      // Buyer hasn't signed
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [],
    }

  !storefront.spend(
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

test purchase_fails_missing_nft_transfer() {
  let seller_pkh = #"5555555555555555555555555555555555555555555555555555555555"
  let artist_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let treasury_pkh =
    #"1111111111111111111111111111111111111111111111111111111111"
  let settings_policy = #"0000000000000000000000000000000000000000000000000000"

  let seller = mock_address(seller_pkh)
  let artist = mock_address(artist_pkh)
  let buyer = mock_address(buyer_pkh)
  let treasury = mock_address(treasury_pkh)

  let price = 15_000_000
  let settings = mock_settings(250, treasury, Active, 300)
  let ticket = mock_ticket(seller, artist, 10_000_000, price, 1000)
  let datum_data: Data = ticket
  let redeemer_data: Data = Buy { buyer }

  let platform_fee = price * 250 / 10000
  let artist_royalty = price * 1000 / 10000
  let seller_payout = price - platform_fee - artist_royalty

  // Payments correct but NFT not transferred
  let seller_output =
    Output {
      address: seller,
      value: from_lovelace(seller_payout),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let artist_output =
    Output {
      address: artist,
      value: from_lovelace(artist_royalty),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let treasury_output =
    Output {
      address: treasury,
      value: from_lovelace(platform_fee),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, settings)],
      outputs: [seller_output, artist_output, treasury_output],
    }

  !storefront.spend(
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
