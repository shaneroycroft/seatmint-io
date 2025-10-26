from opshin.prelude import *

@dataclass
class ActionRedeemer(PlutusData):
    CONSTR_ID = 0
    action_type: int  # 1 = mint, 2 = burn

def validator(ctx: ScriptContext) -> None:
    signatory_hex = "00c00eb4bc7441e0c4b7b3b8e4924a88893788fd91bba1fd123f8978f1094ff83cb97ed83b48e733f0e7a8110483b8bed3fde56b8eea095557"
    required_signatory = PubKeyHash(bytes.fromhex(signatory_hex))
    
    # Access the script purpose
    purpose = ctx.purpose
    assert isinstance(purpose, Minting), "Script purpose must be Minting"
    
    # Get the policy ID from the Minting purpose
    policy_id = purpose.policy_id
    
    # Access signatories from ctx.transaction
    assert required_signatory in ctx.transaction.signatories, "Required signatory missing"
    
    # Access mint from ctx.transaction
    forged_tokens: Dict[bytes, int] = ctx.transaction.mint[policy_id]
    assert len(forged_tokens) == 1, "Exactly one token type must be forged"
    
    # Access redeemer from ctx
    redeemer: ActionRedeemer = ctx.redeemer
    
    for token_name, amount in forged_tokens.items():
        if redeemer.action_type == 1:
            assert amount == 1, "Must mint exactly one token"
        elif redeemer.action_type == 2:
            assert amount < 0, "Must burn tokens"
        else:
            assert False, "Invalid redeemer action"