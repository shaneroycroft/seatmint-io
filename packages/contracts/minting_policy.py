from dataclasses import dataclass
from opshin.prelude import *
from datums import EventDatum
from redeemers import MintRedeemer

def validator(context: ScriptContext) -> None:
    # Access redeemer from ScriptContext (PlutusV3)
    redeemer: MintRedeemer = context.redeemer
    tx_info = context.transaction  # PlutusV3: tx_info -> transaction

    # Verify redeemer action is "mint"
    assert redeemer.action == "mint", "Invalid redeemer action"

    # Get event datum from the minting policy's datum (if present)
    # For minting policies, datum may be attached to outputs
    event_datum: EventDatum = own_datum_unsafe(context)
    
    # Verify event_id matches
    assert redeemer.event_id == event_datum.event_id, "Invalid event ID"

    # Verify the transaction is signed by the organizer
    assert event_datum.organizer in tx_info.signatories, "Organizer signature missing"

    # Verify minted tokens
    minted = tx_info.mint
    policy_id = context.own_policy_id
    expected_token_prefix = redeemer.event_id  # Token names start with event_id

    # Check that all minted tokens belong to this policy and match event_id
    for token_name, amount in minted.items():
        assert token_name.startswith(expected_token_prefix), "Invalid token name"
        assert amount == 1, "Must mint exactly one token per NFT"

    # All checks passed, minting is valid