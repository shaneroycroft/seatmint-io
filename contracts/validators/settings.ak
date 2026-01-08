use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}
// Import the shared type from your library
use seatmint/types.{GlobalSettings}

validator settings(admin_pkh: VerificationKeyHash) {
  spend(
    _datum: Option<GlobalSettings>,
    _redeemer: Data,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    // Only the Admin Portal (holding the secret key) can update these settings
    list.has(self.extra_signatories, admin_pkh)
  }

  else(_) {
    fail
  }
}
