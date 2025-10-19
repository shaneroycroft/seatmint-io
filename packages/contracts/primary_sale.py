from dataclasses import dataclass
from opshin.prelude import *
from datums import TicketDatum
from redeemers import BuyRedeemer

def validator(context: ScriptContext) -> None:
    # Access redeemer and datum from ScriptContext (PlutusV3)
    redeemer: BuyRedeemer = context.redeemer
    tx_info = context.transaction  # PlutusV3: tx_info -> transaction
    input_datum: TicketDatum = own_datum_unsafe(context)

    # Verify redeemer action is "buy"
    assert redeemer.action == "buy", "Invalid redeemer action"

    # Verify the ticket is not for resale (primary sale only)
    assert not input_datum.is_for_resale, "Ticket is for resale, not primary sale"

    # Verify the buyer signed the transaction
    assert redeemer.buyer in tx_info.signatories, "Buyer signature missing"

    # Find the output continuing the script (must have same policy ID and token name)
    policy_id = context.own_policy_id
    token_name = context.own_token_name
    output_datum: TicketDatum = None
    for output in tx_info.outputs:
        if output.address == context.own_address and output.value.get(policy_id, {}).get(token_name, 0) == 1:
            output_datum = output.datum
            break
    assert output_datum is not None, "No valid output found"

    # Verify output datum updates ownership to buyer
    assert output_datum.owner == redeemer.buyer, "Output datum does not update owner to buyer"
    assert output_datum.event_id == input_datum.event_id, "Event ID mismatch"
    assert output_datum.ticket_id == input_datum.ticket_id, "Ticket ID mismatch"
    assert output_datum.price == input_datum.price, "Price mismatch"
    assert output_datum.is_for_resale == input_datum.is_for_resale, "Resale status mismatch"
    assert output_datum.royalty_address == input_datum.royalty_address, "Royalty address mismatch"
    assert output_datum.royalty_amount == input_datum.royalty_amount, "Royalty amount mismatch"

    # Verify payment to organizer
    payment_found = False
    for output in tx_info.outputs:
        if output.address == input_datum.owner:  # Organizer is the current owner
            lovelace = output.value.get(b"", 0)
            if lovelace >= input_datum.price:
                payment_found = True
                break
    assert payment_found, "Payment to organizer not found or insufficient"

    # All checks passed, primary sale is valid