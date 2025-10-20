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
    redeemer: BuyRedeemer = context.redeemer
    tx_info = context.transaction
    input_datum: TicketDatum = own_datum_unsafe(context)

    assert redeemer.action == b"buy", "Invalid redeemer action"
    assert input_datum.is_for_resale == 0, "Ticket is for resale, not primary sale"
    assert redeemer.buyer in tx_info.signatories, "Buyer signature missing"

    policy_id = context.own_policy_id
    token_name = context.own_token_name
    output_datum: TicketDatum = None
    for output in tx_info.outputs:
        if output.address == context.own_address and output.value.get(policy_id, {}).get(token_name, 0) == 1:
            output_datum = output.datum
            break
    assert output_datum is not None, "No valid output found"

    assert output_datum.owner == redeemer.buyer, "Output datum does not update owner to buyer"
    assert output_datum.event_id == input_datum.event_id, "Event ID mismatch"
    assert output_datum.ticket_id == input_datum.ticket_id, "Ticket ID mismatch"
    assert output_datum.price == input_datum.price, "Price mismatch"
    assert output_datum.is_for_resale == input_datum.is_for_resale, "Resale status mismatch"
    assert output_datum.royalty_address == input_datum.royalty_address, "Royalty address mismatch"
    assert output_datum.royalty_amount == input_datum.royalty_amount, "Royalty amount mismatch"

    payment_found = False
    for output in tx_info.outputs:
        if output.address == input_datum.owner:
            lovelace = output.value.get(b"", 0)
            if lovelace >= input_datum.price:
                payment_found = True
                break
    assert payment_found, "Payment to organizer not found or insufficient"