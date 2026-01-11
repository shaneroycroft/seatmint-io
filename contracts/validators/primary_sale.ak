use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use seatmint/types.{GlobalSettings}

validator primary_sale(settings_token: PolicyId) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    // 1. Locate Global Settings via Reference Input
    expect Some(settings_input) =
      list.find(
        self.reference_inputs,
        fn(input) {
          assets.quantity_of(input.output.value, settings_token, "Settings") == 1
        },
      )

    // 2. Decode Global Settings
    expect InlineDatum(datum_raw) = settings_input.output.datum
    expect settings: GlobalSettings = datum_raw

    // 3. Enforce "Market Active" Rule
    // If GlobalSettings says market is closed, this validator locks down.
    settings.is_market_active
  }

  else(_) {
    fail
  }
}
