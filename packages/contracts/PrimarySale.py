from opshin.prelude import *

@dataclass
class TicketDatum(PlutusData):
    CONSTR_ID = 1
    event_id: bytes
    ticket_id: bytes
    owner: PubKeyHash
    price: int

@dataclass
class BuyRedeemer(PlutusData):
    CONSTR_ID = 2
    action: bytes
    buyer: PubKeyHash

def validator(ctx: ScriptContext) -> None:
    # 3. Validator Signature: Using ctx: ScriptContext as the sole parameter.

    # 6. Context Access: Validate purpose is Spending
    purpose = ctx.purpose
    assert isinstance(purpose, Spending), "Script purpose must be Spending"
    spending_purpose: Spending = purpose # 4. Type Annotations
    own_tx_out_ref = spending_purpose.tx_out_ref

    # Find own input
    tx_inputs = [ 
        tx_in for tx_in in ctx.transaction.inputs
        if tx_in.out_ref.id == own_tx_out_ref.id and tx_in.out_ref.idx == own_tx_out_ref.idx
    ]
    assert len(tx_inputs) == 1, "Exactly one input must match spending purpose"
    own_input: TxInInfo = tx_inputs[0] # 4. Type Annotations

    # Extract script address from own input
    script_address: Address = own_input.resolved.address # 4. Type Annotations

    # Extract input datum
    input_datum_data: Datum = own_input.resolved.datum # 4. Type Annotations
    assert input_datum_data is not None, "Input datum missing"
    
    # DEBUG: The compiler rejects isinstance(Datum, Dataclass). We must check CONSTR_ID directly if we don't know the exact PlutusData type.
    # 2. Dataclass Definition & 8. Error Handling: Use CONSTR_ID check on Datum object.
    # We assert the CONSTR_ID matches the expected value (1) for TicketDatum.
    assert input_datum_data.CONSTR_ID == 1, "Input datum has incorrect constructor ID"
    ticket_datum_in: TicketDatum = cast(TicketDatum, input_datum_data) # Use cast after check
    
    # Validate redeemer
    redeemer_data: Datum = ctx.redeemer # 4. Type Annotations
    
    # DEBUG: The compiler rejects isinstance(Datum, Dataclass). We must check CONSTR_ID directly.
    # 2. Dataclass Definition & 8. Error Handling: Use CONSTR_ID check on Datum object.
    assert redeemer_data.CONSTR_ID == 2, "Redeemer has incorrect constructor ID" # Assuming BuyRedeemer is CONSTR_ID = 2
    buy_redeemer: BuyRedeemer = cast(BuyRedeemer, redeemer_data) # Use cast after check
    assert buy_redeemer.action == b"buy", "Invalid redeemer action"
    
    # 6. Context Access: Access signatories
    assert buy_redeemer.buyer in ctx.transaction.signatories, "Buyer signature missing"

    # Extract NFT from input value
    # 4. Type Annotations: Explicitly annotating value type.
    value: Dict[bytes, Dict[bytes, int]] = own_input.resolved.value
    
    # 7. Deterministic Logic: List comprehension for NFT candidates
    nft_candidates = [
        [pid, tname]
        for pid, tokens in value.items() if pid != b""
        for tname, amt in tokens.items() if amt == 1
    ]
    
    assert len(nft_candidates) == 1, "Exactly one NFT with amount 1 must be present in input"
    policy_id: bytes = nft_candidates[0][0] 
    token_name: bytes = nft_candidates[0][1] 

    # Find output with NFT at script address
    tx_outputs = [ 
        out for out in ctx.transaction.outputs
        if out.address == script_address and out.value.get(policy_id, {}).get(token_name, 0) == 1
    ]
    assert len(tx_outputs) == 1, "Exactly one output must contain the NFT at script address"
    output: TxOut = tx_outputs[0] # 4. Type Annotations
    
    # Extract output datum
    output_datum_data: Datum = output.datum # 4. Type Annotations
    assert output_datum_data is not None, "Output datum missing"
    
    # DEBUG: The compiler rejects isinstance(Datum, Dataclass). We must check CONSTR_ID directly.
    # 2. Dataclass Definition & 8. Error Handling: Use CONSTR_ID check on Datum object.
    assert output_datum_data.CONSTR_ID == 1, "Output datum has incorrect constructor ID"
    ticket_datum_out: TicketDatum = cast(TicketDatum, output_datum_data) # Use cast after check

    # 8. Error Handling: Validate output datum state changes
    assert ticket_datum_out.owner == buy_redeemer.buyer, "Output datum owner not updated to buyer"
    assert ticket_datum_out.event_id == ticket_datum_in.event_id, "Event ID mismatch"
    assert ticket_datum_out.ticket_id == ticket_datum_in.ticket_id, "Ticket ID mismatch"
    assert ticket_datum_out.price == ticket_datum_in.price, "Price mismatch" 

    # Payment verification
    payment_verified: bool = False # 4. Type Annotations
    required_amount: int = ticket_datum_in.price # 4. Type Annotations
    
    expected_pkh: PubKeyHash = ticket_datum_in.owner
    
    for out in ctx.transaction.outputs:
        out_value: Dict[bytes, Dict[bytes, int]] = out.value
        
        # Check if the output is a PubKeyCredential and the hash matches the owner
        if isinstance(out.address.credential, PubKeyCredential) and out.address.credential.pubkeyhash == expected_pkh:
            # Safe access for Lovelace (policy_id=b"")
            ada_map: Dict[bytes, int] = out_value.get(b"", {})
            lovelace: int = ada_map.get(b"", 0)
            
            if lovelace >= required_amount:
                payment_verified = True
                break
                
    # 8. Error Handling
    assert payment_verified, "Payment to owner missing or insufficient"