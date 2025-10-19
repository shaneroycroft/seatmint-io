from dataclasses import dataclass
from opshin.prelude import *

# EventDatum: Stores event metadata for minting and validation
@dataclass
class EventDatum:
    organizer: PubKeyHash  # Event organizer's public key hash
    event_id: bytes  # Unique event identifier (e.g., UUID as bytes)
    event_name: bytes  # Event name (UTF-8 encoded)
    total_tickets: int  # Total number of tickets for the event
    ticket_price: int  # Price per ticket in lovelace
    royalty_percentage: int  # Royalty percentage for resale (e.g., 500 for 5%)

# TicketDatum: Stores ticket-specific data for sales and resale
@dataclass
class TicketDatum:
    event_id: bytes  # Links ticket to event
    ticket_id: bytes  # Unique ticket identifier
    owner: PubKeyHash  # Current owner of the ticket
    price: int  # Current price in lovelace (for primary or resale)
    is_for_resale: bool  # True if ticket is listed for resale
    royalty_address: PubKeyHash  # Address to receive royalties
    royalty_amount: int  # Royalty amount in lovelace for resale