use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Transaction}
use seatmint/types.{Burn, GlobalSettings, Mint, MintAction}

validator seatmint_event(
  organizer_pkh: VerificationKeyHash,
  settings_token: PolicyId,
) {
  mint(redeemer: MintAction, policy_id: PolicyId, self: Transaction) {
    let organizer_signed = list.has(self.extra_signatories, organizer_pkh)

    // 1. Find the GlobalSettings UTXO via reference input
    expect Some(settings_input) =
      list.find(
        self.reference_inputs,
        fn(input) {
          assets.quantity_of(input.output.value, settings_token, "Settings") == 1
        },
      )

    // 2. UNWRAP INLINE DATUM (MANDATORY IN AIKEN v3)
    expect InlineDatum(datum_raw) = settings_input.output.datum

    // 3. Decode to shared GlobalSettings type
    expect settings: GlobalSettings = datum_raw

    when redeemer is {
      Mint -> {
        let policy_tokens = assets.tokens(self.mint, policy_id)

        let (total_minted, all_valid) =
          dict.foldl(
            policy_tokens,
            (0, True),
            fn(name, qty, acc) {
              let (count_acc, logic_acc) = acc

              let valid_prefix = bytearray.slice(name, 0, 6) == #"4576656e742d"

              let valid_qty = qty == 1

              (count_acc + qty, logic_acc && valid_prefix && valid_qty)
            },
          )

        let has_mint = total_minted > 0

        organizer_signed && has_mint && all_valid && total_minted <= settings.current_max_supply
      }

      Burn -> {
        let policy_tokens = assets.tokens(self.mint, policy_id)

        let burning_only =
          dict.foldl(
            policy_tokens,
            True,
            fn(_name, qty, acc) { acc && qty < 0 },
          )

        organizer_signed && burning_only
      }
    }
  }

  else(_) {
    fail
  }
}
