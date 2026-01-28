use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Address, Credential, Script, VerificationKey}
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, TransactionId,
  placeholder,
}
// Import shared types to ensure consistency across validators
use types.{GlobalSettings, MintAction, Mint, Burn, MarketStatus, Active, Inactive}

/// Event Minting Policy
/// 
/// This validator controls the minting and burning of event/ticket NFTs.
/// 
/// Parameters:
/// - organizer_pkh: The event organizer's public key hash
/// - settings_token: Reference to the platform settings NFT
/// - box_office_hash: Hash of the primary sale validator (box office)
/// 
/// Authorization hierarchy:
/// 1. Organizer can mint/burn directly
/// 2. Box office validator can mint (for automated sales)
/// 3. Platform settings must be active
validator seatmint_event(
  organizer_pkh: VerificationKeyHash,
  settings_token: PolicyId,
  box_office_hash: ByteArray,
) {
  mint(redeemer: MintAction, policy_id: PolicyId, self: Transaction) {
    // Check if organizer signed the transaction
    let organizer_signed = list.has(self.extra_signatories, organizer_pkh)

    // Find and validate the GlobalSettings UTXO from reference inputs
    expect Some(settings_input) =
      list.find(
        self.reference_inputs,
        fn(input: Input) {
          quantity_of(input.output.value, settings_token, "Settings") == 1
        },
      )

    // Extract and decode the settings datum
    expect InlineDatum(datum_raw) = settings_input.output.datum
    expect settings: GlobalSettings = datum_raw

    when redeemer is {
      // MINT: Create new event/ticket NFTs
      Mint -> {
        // Check if box office (primary sale validator) is authorizing this mint
        let box_office_authorized =
          list.any(
            self.inputs,
            fn(input: Input) {
              input.output.address.payment_credential == Script(
                box_office_hash,
              )
            },
          )

        // Get all tokens being minted with this policy
        let policy_tokens = tokens(self.mint, policy_id)

        // Validate all minted tokens and count total
        let (total_minted, all_valid) =
          dict.foldl(
            policy_tokens,
            (0, True),
            fn(name, qty, acc) {
              let (count_acc, logic_acc) = acc
              // Token name must start with "Event-" prefix
              // Note: bytearray.slice uses inclusive end index, so (0,5) gets 6 bytes
              let valid_prefix = bytearray.slice(name, 0, 5) == "Event-"
              // Each token must mint exactly 1 (NFT)
              let valid_qty = qty == 1
              // Name must be at least prefix length
              let valid_length = bytearray.length(name) >= 6
              (
                count_acc + qty,
                logic_acc && valid_prefix && valid_qty && valid_length,
              )
            },
          )

        // Check if we're actually minting something
        let has_mint = total_minted > 0

        // Platform must be active
        let market_open = settings.is_market_active == Active

        // Respect platform supply limits
        let within_supply_limit = total_minted <= settings.current_max_supply

        // Authorization: Organizer OR Box Office can mint
        let authorized = organizer_signed || box_office_authorized

        // All conditions must pass
        authorized && market_open && has_mint && all_valid && within_supply_limit
      }

      // BURN: Destroy existing tickets (refunds, cancellations)
      Burn -> {
        let policy_tokens = tokens(self.mint, policy_id)

        // Verify all quantities are negative (burning)
        let burning_only =
          dict.foldl(
            policy_tokens,
            True,
            fn(_name, qty, acc) { acc && qty < 0 },
          )

        // Only organizer can burn their event's tickets
        organizer_signed && burning_only
      }
    }
  }

  // Fallback: Deny all other operations
  else(_) {
    fail
  }
}

// HELPER FUNCTIONS FOR TESTING

fn mock_address(pkh: ByteArray) -> Address {
  Address(VerificationKey(pkh), None)
}

fn mock_script_address(script_hash: ByteArray) -> Address {
  Address(Script(script_hash), None)
}

fn mock_settings_input(
  settings_policy: PolicyId,
  is_active: MarketStatus,
  max_supply: Int,
) -> Input {
  let treasury_address = mock_address(#"1111111111111111111111111111111111111111111111111111111111")
  let admin_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_datum =
    GlobalSettings {
      platform_fee_bps: 250,
      platform_treasury: treasury_address,
      is_market_active: is_active,
      current_max_supply: max_supply,
      max_resale_multiplier: 300,
      admin_pkh: admin_pkh,
    }

  Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    },
    output: Output {
      address: mock_address(
        #"00000000000000000000000000000000000000000000000000000000",
      ),
      value: assets.from_asset(settings_policy, "Settings", 1),
      datum: InlineDatum(settings_datum),
      reference_script: None,
    },
  }
}

// UNIT TESTS

test mint_requires_authorization() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_policy = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let box_office_hash =
    #"1111111111111111111111111111111111111111111111111111111111111111"

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [],
      reference_inputs: [mock_settings_input(settings_policy, Active, 100)],
      inputs: [],
      mint: assets.from_asset(settings_policy, #"4576656e742d303031", 1),
    }

  // Should fail without organizer signature or box office input
  !seatmint_event.mint(
    organizer_pkh,
    settings_policy,
    box_office_hash,
    Mint,
    settings_policy,
    tx,
  )
}

test mint_with_organizer_succeeds() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_policy = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let box_office_hash =
    #"1111111111111111111111111111111111111111111111111111111111111111"

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [organizer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, Active, 100)],
      inputs: [],
      mint: assets.from_asset(settings_policy, #"4576656e742d303031", 1),
    }

  seatmint_event.mint(
    organizer_pkh,
    settings_policy,
    box_office_hash,
    Mint,
    settings_policy,
    tx,
  )
}

test mint_with_box_office_succeeds() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_policy = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let box_office_hash =
    #"2222222222222222222222222222222222222222222222222222222222222222"

  let box_office_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
        output_index: 0,
      },
      output: Output {
        address: mock_script_address(box_office_hash),
        value: assets.from_lovelace(2000000),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [],
      reference_inputs: [mock_settings_input(settings_policy, Active, 100)],
      inputs: [box_office_input],
      mint: assets.from_asset(settings_policy, #"4576656e742d303031", 1),
    }

  seatmint_event.mint(
    organizer_pkh,
    settings_policy,
    box_office_hash,
    Mint,
    settings_policy,
    tx,
  )
}

test burn_requires_organizer() {
  let organizer_pkh = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_policy = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let box_office_hash =
    #"1111111111111111111111111111111111111111111111111111111111111111"

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [],
      reference_inputs: [mock_settings_input(settings_policy, Active, 100)],
      inputs: [],
      mint: assets.from_asset(settings_policy, #"4576656e742d303031", -1),
    }

  !seatmint_event.mint(
    organizer_pkh,
    settings_policy,
    box_office_hash,
    Burn,
    settings_policy,
    tx,
  )
}

test mint_fails_when_market_closed() {
  let organizer_pkh =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_policy = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let box_office_hash =
    #"1111111111111111111111111111111111111111111111111111111111111111"

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [organizer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, Inactive, 100)],
      inputs: [],
      mint: assets.from_asset(settings_policy, #"4576656e742d303031", 1),
    }

  !seatmint_event.mint(
    organizer_pkh,
    settings_policy,
    box_office_hash,
    Mint,
    settings_policy,
    tx,
  )
}

test mint_fails_exceeding_supply() {
  let organizer_pkh =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_policy = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let box_office_hash =
    #"1111111111111111111111111111111111111111111111111111111111111111"

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [organizer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, Active, 0)],
      inputs: [],
      mint: assets.from_asset(settings_policy, #"4576656e742d303031", 1),
    }

  !seatmint_event.mint(
    organizer_pkh,
    settings_policy,
    box_office_hash,
    Mint,
    settings_policy,
    tx,
  )
}

test mint_fails_invalid_token_name() {
  let organizer_pkh =
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let settings_policy = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let box_office_hash =
    #"1111111111111111111111111111111111111111111111111111111111111111"

  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [organizer_pkh],
      reference_inputs: [mock_settings_input(settings_policy, Active, 100)],
      inputs: [],
      // Invalid prefix: "Ticket-" instead of "Event-"
      mint: assets.from_asset(settings_policy, #"5469636b65742d303031", 1),
    }

  !seatmint_event.mint(
    organizer_pkh,
    settings_policy,
    box_office_hash,
    Mint,
    settings_policy,
    tx,
  )
}
