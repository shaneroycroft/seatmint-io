from dataclasses import dataclass
from opshin.prelude import *

@dataclass
class EventDatum(PlutusData):
    organizer: PubKeyHash
    event_id: bytes
    event_name: bytes
    total_tickets: int
    ticket_price: int
    royalty_percentage: int

@dataclass
class TicketDatum(PlutusData):
    event_id: bytes
    ticket_id: bytes
    owner: PubKeyHash
    price: int
    is_for_resale: int  # 0 for false, non-zero for true
    royalty_address: PubKeyHash
    royalty_amount: int

@dataclass
class MintRedeemer(PlutusData):
    action: bytes
    event_id: bytes

@dataclass
class BuyRedeemer(PlutusData):
    action: bytes
    buyer: PubKeyHash

@dataclass
class ResellRedeemer(PlutusData):
    action: bytes
    new_price: int

def validator(context: ScriptContext) -> None:
    redeemer: ResellRedeemer = context.redeemer
    tx_info = context.transaction
    input_datum: TicketDatum = own_datum_unsafe(context)

    policy_id = context.own_policy_id
    token_name = context.own_token_name
    output_datum: TicketDatum = None
    for output in tx_info.outputs:
        if output.address == context.own_address and output.value.get(policy_id, {}).get(token_name, 0) == 1:
            output_datum = output.datum
            break
    assert output_datum is not None, "No valid output found"

    if redeemer.action == b"list":
        assert input_datum.owner in tx_info.signatories, "Owner signature missing"
        assert output_datum.is_for_resale != 0, "Output datum must mark ticket for resale"
        assert output_datum.price == redeemer.new_price, "Output datum price mismatch"
        assert output_datum.owner == input_datum.owner, "Owner must not change during listing"
        assert output_datum.event_id == input_datum.event_id, "Event ID mismatch"
        assert output_datum.ticket_id == input_datum.ticket_id, "Ticket ID mismatch"
        assert output_datum.royalty_address == input_datum.royalty_address, "Royalty address mismatch"
        assert output_datum.royalty_amount == input_datum.royalty_amount, "Royalty amount mismatch"

    elif redeemer.action == b"buy":
        assert input_datum.is_for_resale != 0, "Ticket not marked for resale"
        assert any(tx_info.signatories), "Buyer signature missing"
        assert output_datum.is_for_resale == 0, "Output datum must clear resale status"
        assert output_datum.owner != input_datum.owner, "Owner must change during purchase"
        assert output_datum.event_id == input_datum.event_id, "Event ID mismatch"
        assert output_datum.ticket_id == input_datum.ticket_id, "Ticket ID mismatch"
        assert output_datum.price == input_datum.price, "Price mismatch"
        assert output_datum.royalty_address == input_datum.royalty_address, "Royalty address mismatch"
        assert output_datum.royalty_amount == input_datum.royalty_amount, "Royalty amount mismatch"
        seller_payment_found = False
        for output in tx_info.outputs:
            if output.address == input_datum.owner:
                lovelace = output.value.get(b"", 0)
                if lovelace >= input_datum.price:
                    seller_payment_found = True
                    break
        assert seller_payment_found, "Payment to seller not found or insufficient"
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