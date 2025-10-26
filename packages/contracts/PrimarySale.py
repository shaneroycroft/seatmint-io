# build_primary_sale.py
from dataclasses import dataclass
from typing import Any, Optional, Tuple
from opshin.prelude import *

# --- Data Classes ---

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
    is_for_resale: int  # 0 = primary sale, non-zero = resale
    royalty_address: PubKeyHash
    royalty_amount: int

@dataclass
class BuyRedeemer(PlutusData):
    action: bytes
    buyer: PubKeyHash
    offered_price: int  # buyer-specified payment amount

# --- Helpers ---

def extract_lovelace(value: Any) -> int:
    """
    Safely extract lovelace amount from Opshin value shapes.
    Handles:
      - ints (some versions may represent lovelace directly)
      - nested mapping with b"" as lovelace key e.g. { b"": 1_000_000 }
      - unexpected shapes (return 0)
    """
    # Direct integer
    if isinstance(value, int):
        return value

    # Mapping-like value (commonly a dict)
    # Avoid using built-in type names as variable identifiers
    if isinstance(value, dict):
        lovelace_inner = value.get(b"")
        if isinstance(lovelace_inner, int):
            return lovelace_inner
        if lovelace_inner is not None:
            try:
                return int(lovelace_inner)
            except Exception:
                return 0

    return 0

def find_own_input(tx_inputs: list, script_address: bytes) -> Optional[Any]:
    """Return the first input resolved at the script's own address."""
    for tx_in in tx_inputs:
        if tx_in.resolved.address == script_address:
            return tx_in
    return None

def find_nft_in_value(value: Any) -> Optional[Tuple[bytes, bytes]]:
    """
    Attempt to find a policy_id and token_name for an NFT (amount == 1)
    in the provided value structure. Returns (policy_id, token_name) or None.
    """
    if not isinstance(value, dict):
        return None

    for policy_id, token_map in value.items():
        if policy_id == b"":  # skip ADA
            continue
        if not isinstance(token_map, dict):
            continue
        for token_name, amount in token_map.items():
            try:
                if int(amount) == 1:
                    return (policy_id, token_name)
            except Exception:
                continue
    return None

# --- Validator ---

def validator(context: ScriptContext) -> None:
    # Redeemer validation
    redeemer_obj = context.redeemer
    assert isinstance(redeemer_obj, BuyRedeemer), "Redeemer must be BuyRedeemer"
    assert redeemer_obj.action == b"buy", "Invalid redeemer action"
    assert redeemer_obj.buyer in context.transaction.signatories, "Buyer signature missing"

    # Input datum (safe)
    input_datum_opt = own_datum(context)
    assert input_datum_opt is not None, "Input datum missing"
    input_datum = TicketDatum.from_primitive(input_datum_opt)

    # Find script's own input UTXO
    own_input = find_own_input(context.transaction.inputs, context.own_address)
    assert own_input is not None, "No input found at script"

    # Extract NFT identifiers from the own input value
    nft_ident = find_nft_in_value(own_input.resolved.value)
    assert nft_ident is not None, "No NFT found in script input"
    policy_id, token_name = nft_ident

    # Find the output that keeps the NFT at script (ownership must move in datum)
    output_datum_obj: Optional[TicketDatum] = None
    for out in context.transaction.outputs:
        # check if NFT still present in this output
        token_count = 0
        if isinstance(out.value, dict):
            token_count = out.value.get(policy_id, {}).get(token_name, 0)
        if token_count == 1 and out.address == context.own_address:
            assert out.datum is not None, "Output datum missing on NFT output"
            output_datum_obj = TicketDatum.from_primitive(out.datum)
            break
    assert output_datum_obj is not None, "No valid output with NFT found at script"

    # Ownership updates and invariants
    assert output_datum_obj.owner == redeemer_obj.buyer, "Output datum owner not updated to buyer"
    assert output_datum_obj.event_id == input_datum.event_id, "Event ID mismatch"
    assert output_datum_obj.ticket_id == input_datum.ticket_id, "Ticket ID mismatch"
    # After purchase, ticket should no longer be flagged for resale
    assert output_datum_obj.is_for_resale == 0, "Ticket must leave script as non-resale after purchase"

    # Payment verification
    payment_verified = False

    # Primary sale path
    if input_datum.is_for_resale == 0:
        required_amount = int(input_datum.price)
        for out in context.transaction.outputs:
            if out.address == input_datum.owner:
                lovelace_amt = extract_lovelace(out.value.get(b"", 0))
                if lovelace_amt >= required_amount:
                    payment_verified = True
                    break

    # Resale path (royalty enforced)
    else:
        # buyer pays offered_price; royalty_amount must be sent to royalty_address,
        # and remainder to current owner.
        offered = int(redeemer_obj.offered_price)
        royalty_needed = int(input_datum.royalty_amount)
        owner_expected_min = offered - royalty_needed
        owner_payment_ok = False
        royalty_payment_ok = False

        for out in context.transaction.outputs:
            if out.address == input_datum.owner:
                lovelace_amt = extract_lovelace(out.value.get(b"", 0))
                if lovelace_amt >= owner_expected_min:
                    owner_payment_ok = True
            if out.address == input_datum.royalty_address:
                lovelace_amt = extract_lovelace(out.value.get(b"", 0))
                if lovelace_amt >= royalty_needed:
                    royalty_payment_ok = True

        payment_verified = owner_payment_ok and royalty_payment_ok

    assert payment_verified, "Payment to owner/royalty missing or insufficient"

# Expose the entrypoint expected by Opshin
# Many Opshin examples expect variables named `validator` to be present; which we have above.
# If your Opshin toolchain expects a different export name (e.g., mk_validator), adapt accordingly.
