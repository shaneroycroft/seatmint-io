use aiken/collection/list
use cardano/address.{Address, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
// Imported from your shared library
use seatmint/types.{Buy, Cancel, GlobalSettings, StorefrontAction, TicketDatum}

validator storefront(settings_token: PolicyId) {
  spend(
    datum_opt: Option<TicketDatum>,
    redeemer: StorefrontAction,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    // 1. Get the ticket datum for the UTXO being spent
    expect Some(ticket) = datum_opt

    // 2. Find the platform's Global Settings via Reference Input
    expect Some(settings_input) =
      list.find(
        self.reference_inputs,
        fn(input) {
          assets.quantity_of(input.output.value, settings_token, "Settings") == 1
        },
      )

    // 3. UNWRAP: Extract raw data from the InlineDatum
    expect InlineDatum(settings_raw) = settings_input.output.datum
    expect settings: GlobalSettings = settings_raw

    when redeemer is {
      Buy -> {
        // RULE: Emergency Stop (Pillar 3)
        expect settings.is_market_active == True

        // RULE: Anti-Scalper Protection (Dynamic Multiplier)
        let max_price =
          ticket.original_mint_price * settings.max_resale_multiplier / 100
        expect ticket.price <= max_price

        // FEE LOGIC: Calculation using platform-wide settings
        let platform_fee = ticket.price * settings.platform_fee_percent / 1000
        let artist_royalty = ticket.price * ticket.royalty_rate / 1000
        let seller_payout = ticket.price - platform_fee - artist_royalty

        // VERIFY PAYMENTS: Ensure all three stakeholders are paid
        let seller_paid =
          list.any(
            self.outputs,
            fn(out) {
              out.address == ticket.seller && assets.lovelace_of(out.value) >= seller_payout
            },
          )
        let artist_paid =
          list.any(
            self.outputs,
            fn(out) {
              out.address == ticket.artist && assets.lovelace_of(out.value) >= artist_royalty
            },
          )
        let treasury_paid =
          list.any(
            self.outputs,
            fn(out) {
              out.address == settings.platform_treasury && assets.lovelace_of(
                out.value,
              ) >= platform_fee
            },
          )

        seller_paid && artist_paid && treasury_paid
      }

      Cancel -> {
        // FIX: Use named destructuring for clarity (Aiken preference)
        let Address { payment_credential: credential, .. } = ticket.seller

        // Match on 'VerificationKey'
        when credential is {
          VerificationKey(h) -> list.has(self.extra_signatories, h)
          _ -> fail @"Seller must be a wallet (VKey), not a script."
        }
      }
    }
  }

  else(_) {
    fail
  }
}
