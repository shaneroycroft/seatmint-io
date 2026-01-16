import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  listTicketForResale,
  purchaseFromStorefront,
  cancelStorefrontListing,
  transferTicket,
} from '../services/ticketService';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_API_KEY
);

interface Ticket {
  id: string;
  event_id: string;
  event_name: string;
  tier_name: string;
  ticket_number: number;
  current_owner: string;
  original_price: number;
  resale_price: number | null;
  is_listed: boolean;
  event_date: string;
  venue: string;
  nft_asset_name: string;
  listing_utxo_ref: string | null;
  event_policy_id: string;
}

interface MarketplaceProps {
  lucid: any;
  userAddress: string;
}

export const TicketMarketplace: React.FC<MarketplaceProps> = ({ lucid, userAddress }) => {
  const [listings, setListings] = useState<Ticket[]>([]);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [activeTab, setActiveTab] = useState<'browse' | 'my-tickets'>('browse');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [userAddress]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load marketplace listings
      const { data: listingsData } = await supabase
        .from('tickets')
        .select(`
          *,
          events (event_name, event_date, venue_name),
          ticket_tiers (tier_name, price_lovelace)
        `)
        .eq('status', 'listed')
        .neq('current_owner_address', userAddress);

      // Load user's tickets
      const { data: myTicketsData } = await supabase
        .from('tickets')
        .select(`
          *,
          events (event_name, event_date, venue_name),
          ticket_tiers (tier_name, price_lovelace)
        `)
        .eq('current_owner_address', userAddress);

      setListings(formatTickets(listingsData || []));
      setMyTickets(formatTickets(myTicketsData || []));
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTickets = (data: any[]): Ticket[] => {
    return data.map(ticket => ({
      id: ticket.id,
      event_id: ticket.event_id,
      event_name: ticket.events?.event_name || 'Unknown Event',
      tier_name: ticket.ticket_tiers?.tier_name || 'General',
      ticket_number: ticket.ticket_number,
      current_owner: ticket.current_owner_address,
      original_price: (ticket.ticket_tiers?.price_lovelace || 0) / 1_000_000,
      resale_price: ticket.resale_price ? ticket.resale_price / 1_000_000 : null,
      is_listed: ticket.status === 'listed',
      event_date: ticket.events?.event_date || '',
      venue: ticket.events?.venue_name || '',
      nft_asset_name: ticket.nft_asset_name || '',
      listing_utxo_ref: ticket.listing_utxo_ref || null,
      event_policy_id: ticket.events?.event_policy_id || '',
    }));
  };

  const handleListTicketForSale = async (ticket: Ticket, priceAda: number) => {
    try {
      console.log('Listing ticket:', ticket.id, 'for', priceAda, 'ADA');

      const result = await listTicketForResale(lucid, {
        ticketAssetName: ticket.nft_asset_name,
        priceAda,
        eventId: ticket.event_id,
      });

      console.log('Listed successfully:', result);
      alert('✅ Ticket listed successfully!');
      loadData();
    } catch (err) {
      alert('❌ Failed to list ticket: ' + (err instanceof Error ? err.message : 'Unknown error'));
      console.error(err);
    }
  };

  const handleCancelListing = async (ticket: Ticket) => {
    try {
      if (!ticket.listing_utxo_ref) {
        throw new Error('No listing UTxO reference found');
      }

      console.log('Canceling listing:', ticket.id);

      const result = await cancelStorefrontListing(lucid, {
        listingUtxoRef: ticket.listing_utxo_ref,
        ticketId: ticket.id,
      });

      console.log('Canceled successfully:', result);
      alert('✅ Listing canceled');
      loadData();
    } catch (err) {
      alert('❌ Failed to cancel listing: ' + (err instanceof Error ? err.message : 'Unknown error'));
      console.error(err);
    }
  };

  const handlePurchaseTicket = async (ticket: Ticket) => {
    if (!ticket.resale_price) return;

    if (!confirm(`Purchase ${ticket.event_name} - ${ticket.tier_name} for ${ticket.resale_price} ADA?`)) {
      return;
    }

    try {
      if (!ticket.listing_utxo_ref) {
        throw new Error('No listing UTxO reference found');
      }

      console.log('Purchasing ticket:', ticket.id);

      const result = await purchaseFromStorefront(lucid, {
        listingUtxoRef: ticket.listing_utxo_ref,
        eventId: ticket.event_id,
      });

      console.log('Purchased successfully:', result);
      alert('✅ Ticket purchased! Check your wallet.');
      loadData();
    } catch (err) {
      alert('❌ Purchase failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      console.error(err);
    }
  };

  const handleTransferTicket = async (ticket: Ticket, recipientAddress: string) => {
    try {
      console.log('Transferring ticket:', ticket.id, 'to', recipientAddress);

      const result = await transferTicket(lucid, {
        ticketAssetName: ticket.nft_asset_name,
        recipientAddress,
        eventPolicyId: ticket.event_policy_id,
      });

      console.log('Transferred successfully:', result);
      alert('✅ Ticket transferred!');
      loadData();
    } catch (err) {
      alert('❌ Transfer failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', color: '#fff' }}>
        <p>Loading marketplace...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ color: '#fff', marginBottom: '30px' }}>🎫 Ticket Marketplace</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
        <button
          onClick={() => setActiveTab('browse')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'browse' ? '#4CAF50' : '#2a2a2a',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          🛒 Browse Listings ({listings.length})
        </button>
        <button
          onClick={() => setActiveTab('my-tickets')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'my-tickets' ? '#4CAF50' : '#2a2a2a',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          🎟️ My Tickets ({myTickets.length})
        </button>
      </div>

      {/* Browse Listings Tab */}
      {activeTab === 'browse' && (
        <div>
          {listings.length === 0 ? (
            <div style={{
              padding: '40px',
              textAlign: 'center',
              backgroundColor: '#2a2a2a',
              borderRadius: '8px',
              color: '#888'
            }}>
              <p style={{ fontSize: '48px', margin: 0 }}>🔍</p>
              <p style={{ fontSize: '18px' }}>No tickets listed for sale</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
              {listings.map(ticket => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  action="buy"
                  onAction={() => handlePurchaseTicket(ticket)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* My Tickets Tab */}
      {activeTab === 'my-tickets' && (
        <div>
          {myTickets.length === 0 ? (
            <div style={{
              padding: '40px',
              textAlign: 'center',
              backgroundColor: '#2a2a2a',
              borderRadius: '8px',
              color: '#888'
            }}>
              <p style={{ fontSize: '48px', margin: 0 }}>🎫</p>
              <p style={{ fontSize: '18px' }}>You don't own any tickets yet</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
              {myTickets.map(ticket => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  action={ticket.is_listed ? 'cancel' : 'list'}
                  onAction={() => {
                    if (ticket.is_listed) {
                      handleCancelListing(ticket);
                    } else {
                      const price = prompt('List price (ADA):');
                      if (price) handleListTicketForSale(ticket, parseFloat(price));
                    }
                  }}
                  onTransfer={() => {
                    const recipient = prompt('Recipient address:');
                    if (recipient) handleTransferTicket(ticket, recipient);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Ticket Card Component
interface TicketCardProps {
  ticket: Ticket;
  action: 'buy' | 'list' | 'cancel';
  onAction: () => void;
  onTransfer?: () => void;
}

const TicketCard: React.FC<TicketCardProps> = ({ ticket, action, onAction, onTransfer }) => {
  const maxResalePrice = ticket.original_price * 3; // Assume 3x cap
  const isPriceValid = !ticket.resale_price || ticket.resale_price <= maxResalePrice;

  return (
    <div style={{
      backgroundColor: '#2a2a2a',
      border: '1px solid #444',
      borderRadius: '8px',
      padding: '20px',
      position: 'relative'
    }}>
      {/* Ticket Number Badge */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        backgroundColor: '#4CAF50',
        color: 'white',
        padding: '5px 10px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 'bold'
      }}>
        #{ticket.ticket_number}
      </div>

      {/* Event Info */}
      <h3 style={{ color: '#fff', marginTop: 0, marginBottom: '10px', paddingRight: '60px' }}>
        {ticket.event_name}
      </h3>
      <p style={{ color: '#aaa', fontSize: '14px', margin: '5px 0' }}>
        📍 {ticket.venue}
      </p>
      <p style={{ color: '#aaa', fontSize: '14px', margin: '5px 0' }}>
        📅 {new Date(ticket.event_date).toLocaleDateString()}
      </p>
      <p style={{ color: '#4CAF50', fontSize: '14px', margin: '5px 0', fontWeight: 'bold' }}>
        🎫 {ticket.tier_name}
      </p>

      {/* Pricing */}
      <div style={{
        marginTop: '15px',
        paddingTop: '15px',
        borderTop: '1px solid #444'
      }}>
        {ticket.resale_price ? (
          <>
            <p style={{ color: '#fff', fontSize: '24px', fontWeight: 'bold', margin: 0 }}>
              ₳ {ticket.resale_price}
            </p>
            <p style={{ color: '#888', fontSize: '12px', margin: '5px 0' }}>
              Original: ₳ {ticket.original_price}
              {!isPriceValid && <span style={{ color: '#ff6b6b', marginLeft: '10px' }}>⚠️ Above cap</span>}
            </p>
          </>
        ) : (
          <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>
            Original Price: ₳ {ticket.original_price}
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
        {action === 'buy' && (
          <button
            onClick={onAction}
            disabled={!isPriceValid}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: isPriceValid ? '#4CAF50' : '#666',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isPriceValid ? 'pointer' : 'not-allowed',
              fontWeight: 'bold'
            }}
          >
            Buy Now
          </button>
        )}

        {action === 'list' && (
          <>
            <button
              onClick={onAction}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              List for Sale
            </button>
            {onTransfer && (
              <button
                onClick={onTransfer}
                style={{
                  padding: '10px 15px',
                  backgroundColor: '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
                title="Transfer to friend"
              >
                🎁
              </button>
            )}
          </>
        )}

        {action === 'cancel' && (
          <button
            onClick={onAction}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#ff6b6b',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Cancel Listing
          </button>
        )}
      </div>
    </div>
  );
};