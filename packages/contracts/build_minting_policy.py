from dataclasses import dataclass
from opshin.prelude import *

@dataclass
class EventDatum(PlutusData):
    CONSTR_ID = 0
    organizer: PubKeyHash
    event_id: bytes
    event_name: bytes
    total_tickets: int
    ticket_price: int
    royalty_percentage: int

@dataclass
class TicketDatum(PlutusData):
    CONSTR_ID = 1
    event_id: bytes
    ticket_id: bytes
    owner: PubKeyHash
    price: int
    is_for_resale: int
    royalty_address: PubKeyHash
    royalty_amount: int

@dataclass
class MintRedeemer(PlutusData):
    CONSTR_ID = 0
    action: bytes
    event_id: bytes

@dataclass
class BuyRedeemer(PlutusData):
    CONSTR_ID = 1
    action: bytes
    buyer: PubKeyHash

@dataclass
class ResellRedeemer(PlutusData):
    CONSTR_ID = 2
    action: bytes
    new_price: int

def validator(event_datum: EventDatum, context: ScriptContext) -> None:
    tx_info = context.transaction
    redeemer = context.redeemer
    assert isinstance(redeemer, MintRedeemer), "Invalid redeemer type"
    assert redeemer.action == b"mint", "Invalid redeemer action"

    purpose = context.purpose
    assert purpose.CONSTR_ID == 0, "Not a minting purpose"
    assert isinstance(purpose, Minting), "Purpose is not Minting"
    policy_id = purpose.policy_id

    assert redeemer.event_id == event_datum.event_id, "Invalid event ID"
    assert event_datum.organizer in tx_info.signatories, "Organizer signature missing"

    minted = tx_info.mint
    token_amounts = {} if policy_id not in minted else minted[policy_id]

    total_minted = 0
    for token_name, amount in token_amounts.items():
        assert token_name.startswith(redeemer.event_id), "Invalid token name"
        assert amount == 1, "Each ticket must be a unique NFT"
        total_minted += amount

    assert total_minted <= event_datum.total_tickets, "Exceeds total tickets allowed"
    assert len(minted) == 1, "Other currencies not allowed"