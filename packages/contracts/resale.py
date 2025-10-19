from dataclasses import dataclass
from opshin.prelude import *
from datums import TicketDatum
from redeemers import ResellRedeemer

def validator(context: ScriptContext) -> None:
    # Access redeemer and datum from ScriptContext (PlutusV3)
    redeemer: ResellRedeemer = context.redeemer
    tx_info = context.transaction  # PlutusV3: tx_info -> transaction
    input_datum: TicketDatum = own_datum_unsafe(context)

    # Find the output continuing the script (must have same policy ID and token name)
    policy_id = context.own_policy_id
    token_name = context.own_token_name
    output_datum: TicketDatum = None
    for output in tx_info.outputs:
        if output.address == context.own_address and output.value.get(policy_id, {}).get(token_name, 0) == 1:
            output_datum = output.datum
            break
    assert output_datum is not None, "No valid output found"

    if redeemer.action == "list":
        # Action: List ticket for resale
        # Verify the owner signed the transaction
        assert input_datum.owner in tx_info.signatories, "Owner signature missing"
        # Verify output datum updates resale status and price
        assert output_datum.is_for_resale, "Output datum must mark ticket for resale"
        assert output_datum.price == redeemer.new_price, "Output datum price mismatch"
        assert output_datum.owner == input_datum.owner, "Owner must not change during listing"
        assert output_datum.event_id == input_datum.event_id, "Event ID mismatch"
        assert output_datum.ticket_id == input_datum.ticket_id, "Ticket ID mismatch"
        assert output_datum.royalty_address == input_datum.royalty_address, "Royalty address mismatch"
        assert output_datum.royalty_amount == input_datum.royalty_amount, "Royalty amount mismatch"

    elif redeemer.action == "buy":
        # Action: Buy a resold ticket
        # Verify the ticket is marked for resale
        assert input_datum.is_for_resale, "Ticket not marked for resale"
        # Verify the buyer signed the transaction
        assert any(tx_info.signatories), "Buyer signature missing"
        # Verify output datum updates ownership and clears resale status
        assert not output_datum.is_for_resale, "Output datum must clear resale status"
        assert output_datum.owner != input_datum.owner, "Owner must change during purchase"
        assert output_datum.event_id == input_datum.event_id, "Event ID mismatch"
        assert output_datum.ticket_id == input_datum.ticket_id, "Ticket ID mismatch"
        assert output_datum.price == input_datum.price, "Price mismatch"
        assert output_datum.royalty_address == input_datum.royalty_address, "Royalty address mismatch"
        assert output_datum.royalty_amount == input_datum.royalty_amount, "Royalty amount mismatch"
        # Verify payment to seller (current owner)
        seller_payment_found = False
        for output in tx_info.outputs:
            if output.address == input_datum.owner:
                lovelace = output.value.get(b"", 0)
                if lovelace >= input_datum.price:
                    seller_payment_found = True
                    break
        assert seller_payment_found, "Payment to seller not found or insufficient"
        # Verify royalty payment to organizer
        royalty_payment_found = False
        for output in tx_info.outputs:
            if output.address == input_datum.royalty_address:
                lovelace = output.value.get(b"", 0)
                if lovelace >= input_datum.royalty_amount:
                    royalty_payment_found = True
                    break
        assert royalty_payment_found, "Royalty payment to organizer not found or insufficient"

    else:
        assert False, "Invalid redeemer action"

    # All checks passed, resale action is valid