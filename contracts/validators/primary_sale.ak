use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address, Credential, VerificationKey}
use cardano/assets.{PolicyId, quantity_of, from_lovelace, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use types.{GlobalSettings, SaleDatum, SaleRedeemer, MarketStatus, Active, Inactive}

/// Primary Sale Validator (Box Office) - Simplified for MVP
///
/// Basic buy flow:
/// 1. Market must be active
/// 2. Buyer must sign transaction
/// 3. Correct payment to organizer (minus platform fee)
/// 4. Correct number of NFTs minted
validator primary_sale(settings_token: PolicyId) {
  spend(
    datum_opt: Option<Data>,
    redeemer: Data,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    trace @"1_start": True

    // Decode the datum (contains sale configuration)
    expect Some(datum_raw) = datum_opt
    trace @"2_datum_some": True

    expect sale_datum: SaleDatum = datum_raw
    trace @"3_sale_datum_decoded": True

    // Decode the redeemer (purchase action)
    expect sale_redeemer: SaleRedeemer = redeemer
    trace @"4_redeemer_decoded": True

    // Get global platform settings from reference input
    trace @"5_looking_for_settings": True
    trace @"5a_ref_input_count": list.length(self.reference_inputs)

    expect Some(settings_input) =
      list.find(
        self.reference_inputs,
        fn(input: Input) {
          quantity_of(input.output.value, settings_token, "Settings") == 1
        },
      )
    trace @"6_settings_found": True

    expect InlineDatum(settings_raw) = settings_input.output.datum
    trace @"7_settings_inline": True

    expect settings: GlobalSettings = settings_raw
    trace @"8_settings_decoded": True

    // 1. Market must be active
    let market_active = settings.is_market_active == Active
    trace @"9_market_active": market_active

    // 2. Buyer must sign transaction
    let buyer_signed = list.has(self.extra_signatories, sale_redeemer.buyer_pkh)
    trace @"10_buyer_signed": buyer_signed

    // 3. Calculate and validate payment
    let total_payment = sale_datum.base_price * sale_redeemer.quantity
    let platform_fee = (total_payment * settings.platform_fee_bps) / 10000
    let net_to_organizer = total_payment - platform_fee
    trace @"11_payment_calc": net_to_organizer

    let payment_valid =
      when
        list.find(
          self.outputs,
          fn(output: Output) { output.address == sale_datum.organizer_address },
        )
      is {
        None -> {
          trace @"12_no_organizer_output": False
          False
        }
        Some(organizer_output) -> {
          let lovelace_received = assets.lovelace_of(organizer_output.value)
          trace @"12_lovelace_received": lovelace_received
          lovelace_received >= net_to_organizer
        }
      }
    trace @"13_payment_valid": payment_valid

    // 4. Verify correct NFTs are minted
    let minted_tokens = assets.tokens(self.mint, sale_datum.event_policy)
    let total_minted =
      dict.foldl(minted_tokens, 0, fn(_name, qty, acc) { acc + qty })
    trace @"14_total_minted": total_minted
    let nft_minted = total_minted == sale_redeemer.quantity
    trace @"15_nft_minted": nft_minted

    // All conditions must pass
    let result = market_active && buyer_signed && payment_valid && nft_minted
    trace @"16_final_result": result
    result
  }

  else(_) {
    fail
  }
}

// ============================================
// HELPER FUNCTIONS FOR TESTING
// ============================================

fn mock_address(pkh: ByteArray) -> Address {
  Address(VerificationKey(pkh), None)
}

fn mock_settings_input(
  settings_policy: PolicyId,
  is_active: MarketStatus,
  fee_bps: Int,
) -> Input {
  let treasury_address = mock_address(#"1111111111111111111111111111111111111111111111111111111111")
  let admin_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_datum =
    GlobalSettings {
      platform_fee_bps: fee_bps,
      platform_treasury: treasury_address,
      is_market_active: is_active,
      current_max_supply: 1000,
      max_resale_multiplier: 300,
      admin_pkh: admin_pkh,
    }

  Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    },
    output: Output {
      address: mock_address(#"0000000000000000000000000000000000000000000000000000000000"),
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
  }
}

// ============================================
// UNIT TESTS
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
      buyer_pkh: buyer_pkh,
    }

  // Calculate expected payment: (price * quantity) - platform fee
  let total_payment = price * quantity
  let platform_fee = (total_payment * 250) / 10000
  let net_to_organizer = total_payment - platform_fee

  let organizer_output =
    Output {
      address: mock_address(organizer_pkh),
      value: from_lovelace(net_to_organizer),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, Active, 250)],
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
    SaleRedeemer { quantity: 1, buyer_pkh: buyer_pkh }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [buyer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, Inactive, 250)],
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
    SaleRedeemer { quantity: 1, buyer_pkh: buyer_pkh }

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
      extra_signatories: [],  // Buyer hasn't signed!
      reference_inputs: [mock_settings_input(settings_policy, Active, 250)],
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

test purchase_fails_insufficient_payment() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let buyer_pkh = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let settings_policy = #"5555555555555555555555555555555555555555555555555555"
  let event_policy = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  let price = 10_000_000
  let sale_datum = mock_sale_datum(organizer_pkh, price)
  let datum_data: Data = sale_datum
  let redeemer_data: Data =
    SaleRedeemer { quantity: 1, buyer_pkh: buyer_pkh }

  // Pay only half the required amount
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
      reference_inputs: [mock_settings_input(settings_policy, Active, 250)],
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
