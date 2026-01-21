import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { purchaseTickets, purchaseFromStorefront } from '../services/ticketService';
import { useToast, TOAST_MESSAGES } from '../contexts/ToastContext';

// Types for Official Sales
interface TicketTier {
  id: string;
  tier_name: string;
  tier_description: string;
  price_lovelace: number;
  total_supply: number;
  remaining_supply: number;
  max_per_wallet: number;
}

interface Event {
  id: string;
  event_name: string;
  event_description: string;
  event_date: string;
  venue_name: string;
  event_location: string;
  banner_image_url: string | null;
  category: string;
  organizer_wallet_address: string;
  event_policy_id: string;
  ticket_tiers: TicketTier[];
}

// Types for Resale
interface ResaleListing {
  id: string;
  event_id: string;
  event_name: string;
  tier_name: string;
  ticket_number: number;
  seller_address: string;
  original_price: number;
  resale_price: number;
  event_date: string;
  venue: string;
  nft_asset_name: string;
  listing_utxo_ref: string;
  event_policy_id: string;
}

interface EventsPageProps {
  lucid: any;
  userAddress: string;
}

type MarketTab = 'official' | 'resale';

// Color scheme based on tier type
const TIER_GRADIENTS: Record<string, string> = {
  vip: 'from-purple-500 to-purple-700',
  backstage: 'from-red-500 to-red-700',
  premium: 'from-amber-500 to-amber-700',
  general: 'from-blue-500 to-blue-700',
  standard: 'from-slate-500 to-slate-700',
  default: 'from-emerald-500 to-emerald-700',
};

const TIER_COLORS: Record<string, string> = {
  vip: 'bg-purple-600',
  backstage: 'bg-red-600',
  premium: 'bg-amber-600',
  general: 'bg-blue-600',
  standard: 'bg-slate-600',
  default: 'bg-emerald-600',
};

const getTierGradient = (tierName: string): string => {
  const lower = tierName.toLowerCase();
  for (const [key, value] of Object.entries(TIER_GRADIENTS)) {
    if (lower.includes(key)) return value;
  }
  return TIER_GRADIENTS.default;
};

const getTierColor = (tierName: string): string => {
  const lower = tierName.toLowerCase();
  for (const [key, value] of Object.entries(TIER_COLORS)) {
    if (lower.includes(key)) return value;
  }
  return TIER_COLORS.default;
};

export const EventsPage: React.FC<EventsPageProps> = ({ lucid, userAddress }) => {
  const [activeTab, setActiveTab] = useState<MarketTab>('official');
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  // Official market state
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedTier, setSelectedTier] = useState<TicketTier | null>(null);
  const [quantity, setQuantity] = useState(1);

  // Resale market state
  const [listings, setListings] = useState<ResaleListing[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [selectedListing, setSelectedListing] = useState<ResaleListing | null>(null);

  // Shared state
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const platformFeePercent = 2;

  // Load data on mount and tab change
  useEffect(() => {
    if (activeTab === 'official') {
      loadEvents();
    } else {
      loadListings();
    }
  }, [activeTab, userAddress]);

  const loadEvents = async () => {
    setLoadingEvents(true);
    try {
      const { data, error } = await supabase
        .from('events')
        .select(`*, ticket_tiers (*)`)
        .eq('status', 'published')
        .order('event_date', { ascending: true });

      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('Failed to load events:', err);
      toast.error('Unable to Load Events', 'Please check your connection and try again.');
    } finally {
      setLoadingEvents(false);
    }
  };

  const loadListings = async () => {
    setLoadingListings(true);
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          *,
          events (event_name, event_date, venue_name, event_policy_id),
          ticket_tiers (tier_name, price_lovelace)
        `)
        .eq('status', 'listed')
        .neq('current_owner_address', userAddress);

      if (error) throw error;

      const formattedListings: ResaleListing[] = (data || []).map(ticket => ({
        id: ticket.id,
        event_id: ticket.event_id,
        event_name: ticket.events?.event_name || 'Unknown Event',
        tier_name: ticket.ticket_tiers?.tier_name || 'General',
        ticket_number: ticket.ticket_number,
        seller_address: ticket.current_owner_address,
        original_price: (ticket.ticket_tiers?.price_lovelace || 0) / 1_000_000,
        resale_price: ticket.resale_price ? ticket.resale_price / 1_000_000 : 0,
        event_date: ticket.events?.event_date || '',
        venue: ticket.events?.venue_name || '',
        nft_asset_name: ticket.nft_asset_name || '',
        listing_utxo_ref: ticket.listing_utxo_ref || '',
        event_policy_id: ticket.events?.event_policy_id || '',
      }));

      setListings(formattedListings);
    } catch (err) {
      console.error('Failed to load listings:', err);
      toast.error('Unable to Load Listings', 'Please check your connection and try again.');
    } finally {
      setLoadingListings(false);
    }
  };

  // Purchase handlers
  const handleOfficialPurchase = async () => {
    if (!selectedEvent || !selectedTier) return;

    setIsPurchasing(true);
    const pendingToastId = toast.pending(
      TOAST_MESSAGES.purchaseStarted.title,
      TOAST_MESSAGES.purchaseStarted.message
    );

    try {
      await purchaseTickets(lucid, {
        eventId: selectedEvent.id,
        tierId: selectedTier.id,
        quantity,
      });

      toast.dismissToast(pendingToastId);
      toast.success(
        TOAST_MESSAGES.purchaseSuccess.title,
        `${quantity} ticket${quantity > 1 ? 's' : ''} for ${selectedEvent.event_name} secured! Your ticket${quantity > 1 ? 's' : ''} will appear in My Tickets shortly.`
      );
      setSelectedEvent(null);
      setSelectedTier(null);
      setQuantity(1);
      setIsPanelOpen(false);
      loadEvents();
    } catch (err) {
      console.error('Purchase failed:', err);
      toast.dismissToast(pendingToastId);
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong';
      // Make error messages user-friendly
      const friendlyMessage = errorMessage.includes('user rejected') || errorMessage.includes('cancelled')
        ? 'You cancelled the transaction. No worries - you can try again when ready.'
        : errorMessage.includes('insufficient')
        ? 'Your wallet doesn\'t have enough ADA for this purchase.'
        : 'We couldn\'t complete your purchase. Please try again.';
      toast.error(TOAST_MESSAGES.purchaseFailed.title, friendlyMessage);
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleResalePurchase = async () => {
    if (!selectedListing || !selectedListing.listing_utxo_ref) return;

    setIsPurchasing(true);
    const pendingToastId = toast.pending(
      TOAST_MESSAGES.purchaseStarted.title,
      TOAST_MESSAGES.purchaseStarted.message
    );

    try {
      await purchaseFromStorefront(lucid, {
        listingUtxoRef: selectedListing.listing_utxo_ref,
        eventId: selectedListing.event_id,
      });

      toast.dismissToast(pendingToastId);
      toast.success(
        TOAST_MESSAGES.purchaseSuccess.title,
        `Your ticket for ${selectedListing.event_name} is on its way! Check My Tickets shortly.`
      );
      setSelectedListing(null);
      setIsPanelOpen(false);
      loadListings();
    } catch (err) {
      console.error('Purchase failed:', err);
      toast.dismissToast(pendingToastId);
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong';
      const friendlyMessage = errorMessage.includes('user rejected') || errorMessage.includes('cancelled')
        ? 'You cancelled the transaction. No worries - you can try again when ready.'
        : errorMessage.includes('insufficient')
        ? 'Your wallet doesn\'t have enough ADA for this purchase.'
        : 'We couldn\'t complete your purchase. Please try again.';
      toast.error(TOAST_MESSAGES.purchaseFailed.title, friendlyMessage);
    } finally {
      setIsPurchasing(false);
    }
  };

  // Computed values
  const purchaseBreakdown = useMemo(() => {
    if (!selectedListing) return null;
    const price = selectedListing.resale_price;
    const fee = (price * platformFeePercent) / 100;
    return { subtotal: price, fee, total: price + fee };
  }, [selectedListing]);

  const filteredEvents = events.filter(event =>
    event.event_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    event.venue_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    event.event_location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredListings = listings.filter(listing =>
    listing.event_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    listing.venue.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatPrice = (lovelace: number) => (lovelace / 1_000_000).toFixed(2);

  const handleTabChange = (tab: MarketTab) => {
    setActiveTab(tab);
    setSelectedEvent(null);
    setSelectedTier(null);
    setSelectedListing(null);
    setSearchQuery('');
    setIsPanelOpen(false);
  };

  const closePanel = () => {
    setIsPanelOpen(false);
    setSelectedEvent(null);
    setSelectedTier(null);
    setSelectedListing(null);
  };

  const isLoading = activeTab === 'official' ? loadingEvents : loadingListings;
  const hasSelection = activeTab === 'official' ? !!selectedEvent : !!selectedListing;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header with Tabs */}
      <div className="p-6 pb-0 border-b sticky top-0 bg-white z-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">
              Events
            </h2>
          </div>

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder={`Search ${activeTab === 'official' ? 'events' : 'listings'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full md:w-80 px-4 py-2 pl-10 bg-slate-100 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1">
          <button
            onClick={() => handleTabChange('official')}
            className={`px-6 py-3 font-bold text-sm rounded-t-xl transition-all ${
              activeTab === 'official'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Official
            {events.length > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeTab === 'official' ? 'bg-blue-500' : 'bg-slate-200'
              }`}>
                {events.length}
              </span>
            )}
          </button>
          <button
            onClick={() => handleTabChange('resale')}
            className={`px-6 py-3 font-bold text-sm rounded-t-xl transition-all ${
              activeTab === 'resale'
                ? 'bg-orange-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Resale
            {listings.length > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeTab === 'resale' ? 'bg-orange-500' : 'bg-slate-200'
              }`}>
                {listings.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Content Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-slate-500">Loading...</div>
            </div>
          ) : activeTab === 'official' ? (
            // Official Events Grid
            filteredEvents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
                  <h4 className="text-lg font-bold text-slate-800 mb-2">
                    {searchQuery ? 'No matching events' : 'No events available'}
                  </h4>
                  <p className="text-slate-400 text-sm">
                    {searchQuery ? 'Try a different search term' : 'Check back later for upcoming events'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredEvents.map((event) => (
                  <OfficialEventCard
                    key={event.id}
                    event={event}
                    isSelected={selectedEvent?.id === event.id}
                    onClick={() => {
                      setSelectedEvent(event);
                      setSelectedTier(event.ticket_tiers[0] || null);
                      setQuantity(1);
                      setIsPanelOpen(true);
                    }}
                  />
                ))}
              </div>
            )
          ) : (
            // Resale Listings Grid
            filteredListings.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
                  <h4 className="text-lg font-bold text-slate-800 mb-2">
                    {searchQuery ? 'No matching listings' : 'No tickets for resale'}
                  </h4>
                  <p className="text-slate-400 text-sm">
                    {searchQuery ? 'Try a different search term' : 'Check back later for resale listings'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredListings.map((listing) => (
                  <ResaleListingCard
                    key={listing.id}
                    listing={listing}
                    isSelected={selectedListing?.id === listing.id}
                    onClick={() => {
                      setSelectedListing(listing);
                      setIsPanelOpen(true);
                    }}
                  />
                ))}
              </div>
            )
          )}
        </div>

      </div>

      {/* Flyout Order Summary Panel */}
      {hasSelection && (
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 bg-black/30 z-40 transition-opacity ${
              isPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={closePanel}
          />

          {/* Slide-in Panel */}
          <aside
            className={`fixed top-0 right-0 h-full w-[400px] max-w-[90vw] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-out ${
              isPanelOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="h-full flex flex-col">
              {activeTab === 'official' && selectedEvent ? (
                // Official Purchase Panel
                <div className="flex flex-col h-full">
                  {/* Header */}
                  <div className="flex justify-between items-center p-6 border-b border-slate-200">
                    <h3 className="text-sm font-black uppercase tracking-[0.15em] text-slate-900">
                      Purchase Details
                    </h3>
                    <button
                      onClick={closePanel}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Event Summary */}
                    <div className="bg-slate-50 p-5 rounded-2xl">
                      <h4 className="font-black text-lg text-slate-900 mb-1">{selectedEvent.event_name}</h4>
                      <p className="text-slate-500 text-sm">{selectedEvent.venue_name}</p>
                      <p className="text-slate-400 text-xs">{formatDate(selectedEvent.event_date)}</p>
                    </div>

                    {/* Tier Selection */}
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">
                        Select Tier
                      </label>
                      <div className="space-y-2">
                        {selectedEvent.ticket_tiers.map((tier) => (
                          <button
                            key={tier.id}
                            onClick={() => { setSelectedTier(tier); setQuantity(1); }}
                            disabled={tier.remaining_supply === 0}
                            className={`w-full p-3 rounded-xl text-left transition-all text-sm ${
                              selectedTier?.id === tier.id
                                ? 'bg-blue-600 text-white shadow-lg'
                                : tier.remaining_supply === 0
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-white hover:bg-slate-50 text-slate-900 border border-slate-200'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="font-bold">{tier.tier_name}</p>
                                <p className={`text-xs ${selectedTier?.id === tier.id ? 'text-blue-200' : 'text-slate-400'}`}>
                                  {tier.remaining_supply} left
                                </p>
                              </div>
                              <p className="font-black">₳{formatPrice(tier.price_lovelace)}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Quantity */}
                    {selectedTier && selectedTier.remaining_supply > 0 && (
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">
                          Quantity
                        </label>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            className="w-10 h-10 bg-slate-200 hover:bg-slate-300 rounded-lg font-bold text-lg"
                          >
                            -
                          </button>
                          <span className="text-xl font-black w-8 text-center">{quantity}</span>
                          <button
                            onClick={() => setQuantity(Math.min(selectedTier.max_per_wallet, selectedTier.remaining_supply, quantity + 1))}
                            className="w-10 h-10 bg-slate-200 hover:bg-slate-300 rounded-lg font-bold text-lg"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Total */}
                    {selectedTier && (
                      <div className="bg-slate-50 p-4 rounded-2xl">
                        <div className="flex justify-between items-center text-sm mb-2">
                          <span className="text-slate-500">Unit price</span>
                          <span className="font-mono">₳{formatPrice(selectedTier.price_lovelace)}</span>
                        </div>
                        <div className="pt-3 border-t border-slate-200 flex justify-between items-end">
                          <span className="text-xs font-black uppercase text-slate-400">Total</span>
                          <span className="text-2xl font-black text-slate-900">
                            ₳{formatPrice(selectedTier.price_lovelace * quantity)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer with Purchase Button */}
                  <div className="p-6 border-t border-slate-200 bg-white">
                    {selectedTier && selectedTier.remaining_supply > 0 && (
                      <button
                        onClick={handleOfficialPurchase}
                        disabled={isPurchasing}
                        className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isPurchasing ? (
                          <>
                            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Processing...
                          </>
                        ) : (
                          `Buy ${quantity} Ticket${quantity > 1 ? 's' : ''}`
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ) : activeTab === 'resale' && selectedListing ? (
                // Resale Purchase Panel
                <div className="flex flex-col h-full">
                  {/* Header */}
                  <div className="flex justify-between items-center p-6 border-b border-slate-200">
                    <h3 className="text-sm font-black uppercase tracking-[0.15em] text-slate-900">
                      Order Summary
                    </h3>
                    <button
                      onClick={closePanel}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Listing Details */}
                    <div className="bg-slate-50 p-5 rounded-2xl relative overflow-hidden">
                      <div className={`absolute top-0 left-0 w-1.5 h-full ${getTierColor(selectedListing.tier_name)}`} />
                      <h4 className="font-black text-lg text-slate-900 mb-1 pl-2">{selectedListing.event_name}</h4>
                      <p className="text-slate-500 text-sm pl-2">{selectedListing.venue}</p>
                      <p className="text-slate-400 text-xs pl-2">{new Date(selectedListing.event_date).toLocaleDateString()}</p>
                      <p className="text-slate-600 text-sm font-semibold pl-2 mt-2">{selectedListing.tier_name}</p>
                    </div>

                    {/* Price Breakdown */}
                    {purchaseBreakdown && (
                      <div className="bg-slate-50 p-4 rounded-2xl">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-slate-400">Original price</span>
                          <span className="line-through text-slate-400">₳{selectedListing.original_price}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-slate-500">Resale price</span>
                          <span className="font-mono">₳{purchaseBreakdown.subtotal}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-3">
                          <span className="text-slate-500">Platform fee ({platformFeePercent}%)</span>
                          <span className="font-mono">₳{purchaseBreakdown.fee.toFixed(2)}</span>
                        </div>
                        <div className="pt-3 border-t-2 border-dashed border-slate-200 flex justify-between items-end">
                          <span className="text-xs font-black uppercase text-slate-400">Total</span>
                          <span className="text-2xl font-black text-slate-900">
                            ₳{purchaseBreakdown.total.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Seller Info */}
                    <div className="bg-slate-50 p-3 rounded-xl">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Seller</p>
                      <p className="text-xs font-mono text-slate-600 truncate">
                        {selectedListing.seller_address.slice(0, 16)}...{selectedListing.seller_address.slice(-6)}
                      </p>
                    </div>
                  </div>

                  {/* Footer with Purchase Button */}
                  <div className="p-6 border-t border-slate-200 bg-white">
                    <button
                      onClick={handleResalePurchase}
                      disabled={isPurchasing}
                      className="w-full bg-orange-600 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-orange-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isPurchasing ? (
                        <>
                          <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Processing...
                        </>
                      ) : (
                        'Buy from Resale'
                      )}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        </>
      )}
    </div>
  );
};

// Official Event Card Component
interface OfficialEventCardProps {
  event: Event;
  isSelected: boolean;
  onClick: () => void;
}

const OfficialEventCard: React.FC<OfficialEventCardProps> = ({ event, isSelected, onClick }) => {
  const lowestPrice = Math.min(...event.ticket_tiers.map(t => t.price_lovelace));
  const totalRemaining = event.ticket_tiers.reduce((sum, t) => sum + t.remaining_supply, 0);
  const isSoldOut = totalRemaining === 0;

  const dateInfo = (() => {
    const date = new Date(event.event_date);
    return {
      month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.getDate(),
    };
  })();

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all cursor-pointer ${
        isSelected ? 'ring-2 ring-blue-600' : ''
      } ${isSoldOut ? 'opacity-60' : ''}`}
    >
      <div className={`h-28 bg-gradient-to-br ${getTierGradient(event.ticket_tiers[0]?.tier_name || 'general')} p-4 flex justify-between items-start relative overflow-hidden`}>
        <div className="absolute -right-4 -bottom-4 opacity-10 text-7xl font-black text-white rotate-12">
          LIVE
        </div>
        <div className="bg-white/20 backdrop-blur-md px-3 py-2 rounded-lg text-white text-center">
          <p className="text-[10px] font-bold tracking-wider">{dateInfo.month}</p>
          <p className="text-xl font-black leading-none">{dateInfo.day}</p>
        </div>
        {isSoldOut ? (
          <div className="bg-red-500 px-2 py-1 rounded-lg text-white text-xs font-bold uppercase">
            Sold Out
          </div>
        ) : (
          <div className="bg-green-500 px-2 py-1 rounded-lg text-white text-xs font-bold uppercase">
            {totalRemaining} Left
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-black text-lg text-slate-900 mb-1 truncate">{event.event_name}</h3>
        <p className="text-slate-500 text-sm mb-2 truncate">{event.venue_name}</p>
        <div className="flex justify-between items-end">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">From</p>
            <p className="text-lg font-black text-slate-900">₳{(lowestPrice / 1_000_000).toFixed(0)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tiers</p>
            <p className="text-sm font-bold text-slate-600">{event.ticket_tiers.length}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Resale Listing Card Component
interface ResaleListingCardProps {
  listing: ResaleListing;
  isSelected: boolean;
  onClick: () => void;
}

const ResaleListingCard: React.FC<ResaleListingCardProps> = ({ listing, isSelected, onClick }) => {
  const priceChange = ((listing.resale_price - listing.original_price) / listing.original_price) * 100;

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all cursor-pointer ${
        isSelected ? 'ring-2 ring-orange-600' : ''
      }`}
    >
      <div className={`h-28 ${getTierColor(listing.tier_name)} p-4 flex flex-col justify-between text-white relative overflow-hidden`}>
        <div className="absolute -right-4 -bottom-4 opacity-10 text-6xl font-black rotate-12">
          RESALE
        </div>
        <div className="flex justify-between items-start">
          <div className="bg-white/20 backdrop-blur-md px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider">
            {listing.tier_name}
          </div>
          <div className={`px-2 py-1 rounded text-[10px] font-bold ${priceChange > 0 ? 'bg-red-500' : 'bg-green-500'}`}>
            {priceChange > 0 ? '+' : ''}{priceChange.toFixed(0)}%
          </div>
        </div>
        <h4 className="text-lg font-black leading-tight truncate">{listing.event_name}</h4>
      </div>
      <div className="p-4">
        <p className="text-slate-500 text-sm mb-2 truncate">{listing.venue}</p>
        <div className="flex justify-between items-end">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {new Date(listing.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
            <p className="text-sm text-slate-400 line-through">₳{listing.original_price}</p>
          </div>
          <p className="text-xl font-black text-slate-900">₳{listing.resale_price}</p>
        </div>
      </div>
    </div>
  );
};
