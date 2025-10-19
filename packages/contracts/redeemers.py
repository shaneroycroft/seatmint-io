from dataclasses import dataclass
from opshin.prelude import *

# MintRedeemer: Actions for minting tickets
@dataclass
class MintRedeemer:
    action: str  # "mint" for minting new tickets
    event_id: bytes  # Event ID to mint tickets for

# BuyRedeemer: Actions for purchasing tickets
@dataclass
class BuyRedeemer:
    action: str  # "buy" for primary or resale purchase
    buyer: PubKeyHash  # Buyer's public key hash

# ResellRedeemer: Actions for listing or updating resale
@dataclass
class ResellRedeemer:
    action: str  # "list" or "cancel" for resale
    new_price: int  # New resale price in lovelace