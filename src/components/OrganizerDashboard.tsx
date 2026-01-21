import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CreateEvent } from './CreateEvent';
import { useToast } from '../contexts/ToastContext';

interface TicketTier {
  id: string;
  tier_name: string;
  tier_description?: string;
  price_lovelace: number;
  total_supply: number;
  remaining_supply: number;
}

interface Event {
  id: string;
  event_name: string;
  event_description: string;
  event_date: string;
  venue_name: string;
  event_location: string;
  category: string;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  event_policy_id: string;
  created_at: string;
  ticket_tiers: TicketTier[];
}

interface EditFormData {
  event_name: string;
  event_description: string;
  event_date: string;
  venue_name: string;
  event_location: string;
  tiers: { id: string; tier_name: string; tier_description: string }[];
}

interface OrganizerDashboardProps {
  lucid: any;
  userAddress: string;
}

type DashboardView = 'events' | 'create';

export const OrganizerDashboard: React.FC<OrganizerDashboardProps> = ({ lucid, userAddress }) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>('events');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditFormData | null>(null);
  const toast = useToast();

  useEffect(() => {
    loadEvents();
  }, [userAddress]);

  const loadEvents = async () => {
    setLoading(true);
    console.log('Loading events for organizer:', userAddress);
    try {
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          ticket_tiers (*)
        `)
        .eq('organizer_wallet_address', userAddress)
        .order('created_at', { ascending: false });

      console.log('Supabase response:', { data, error });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      setEvents(data || []);
      console.log('Loaded events:', data?.length || 0);
    } catch (err) {
      console.error('Failed to load events:', err);
      toast.error('Unable to Load Events', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (eventId: string, newStatus: 'published' | 'completed') => {
    setActionLoading(eventId);
    try {
      console.log('Updating event status:', { eventId, newStatus });
      const { data, error } = await supabase
        .from('events')
        .update({ status: newStatus })
        .eq('id', eventId)
        .select();

      console.log('Update response:', { data, error });

      if (error) {
        console.error('Supabase update error:', error);
        throw new Error(error.message || 'Unknown error');
      }

      // Refresh events
      await loadEvents();
      setSelectedEvent(null);
      const statusMessage = newStatus === 'published' ? 'Your event is now live!' : 'Sales have been ended for this event.';
      toast.success('Event Updated', statusMessage);
    } catch (err: any) {
      console.error('Failed to update event:', err);
      toast.error('Update Failed', 'We couldn\'t update your event. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event? This cannot be undone.')) {
      return;
    }

    setActionLoading(eventId);
    try {
      // First delete ticket tiers (foreign key constraint)
      const { error: tiersError } = await supabase
        .from('ticket_tiers')
        .delete()
        .eq('event_id', eventId);

      if (tiersError) {
        console.error('Failed to delete tiers:', tiersError);
      }

      // Then delete the event
      const { error: eventError } = await supabase
        .from('events')
        .delete()
        .eq('id', eventId);

      if (eventError) {
        throw new Error(eventError.message);
      }

      await loadEvents();
      setSelectedEvent(null);
      toast.success('Event Deleted', 'Your event has been removed.');
    } catch (err: any) {
      console.error('Failed to delete event:', err);
      toast.error('Delete Failed', 'We couldn\'t delete your event. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const startEditing = (event: Event) => {
    setEditForm({
      event_name: event.event_name,
      event_description: event.event_description || '',
      event_date: event.event_date.split('T')[0], // Format for date input
      venue_name: event.venue_name,
      event_location: event.event_location,
      tiers: event.ticket_tiers.map(t => ({
        id: t.id,
        tier_name: t.tier_name,
        tier_description: t.tier_description || '',
      })),
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditForm(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedEvent || !editForm) return;

    setActionLoading(selectedEvent.id);

    try {
      // Update event details
      const { error: eventError } = await supabase
        .from('events')
        .update({
          event_name: editForm.event_name,
          event_description: editForm.event_description,
          event_date: new Date(editForm.event_date).toISOString(),
          venue_name: editForm.venue_name,
          event_location: editForm.event_location,
        })
        .eq('id', selectedEvent.id);

      if (eventError) {
        throw new Error(eventError.message);
      }

      // Update tier details
      for (const tier of editForm.tiers) {
        const { error: tierError } = await supabase
          .from('ticket_tiers')
          .update({
            tier_name: tier.tier_name,
            tier_description: tier.tier_description,
          })
          .eq('id', tier.id);

        if (tierError) {
          console.error('Failed to update tier:', tierError);
        }
      }

      await loadEvents();
      setIsEditing(false);
      setEditForm(null);

      // Update selected event with new data
      const updatedEvent = events.find(e => e.id === selectedEvent.id);
      if (updatedEvent) {
        setSelectedEvent(updatedEvent);
      }
      toast.success('Changes Saved', 'Your event has been updated.');
    } catch (err: any) {
      console.error('Failed to save changes:', err);
      toast.error('Save Failed', 'We couldn\'t save your changes. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const getEventStats = (event: Event) => {
    const totalSupply = event.ticket_tiers.reduce((sum, t) => sum + t.total_supply, 0);
    const remaining = event.ticket_tiers.reduce((sum, t) => sum + t.remaining_supply, 0);
    const sold = totalSupply - remaining;
    const revenue = event.ticket_tiers.reduce((sum, t) => {
      const tierSold = t.total_supply - t.remaining_supply;
      return sum + (tierSold * t.price_lovelace);
    }, 0);

    return { totalSupply, remaining, sold, revenue };
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatAda = (lovelace: number) => {
    return (lovelace / 1_000_000).toFixed(2);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-amber-100 text-amber-700';
      case 'published': return 'bg-green-100 text-green-700';
      case 'completed': return 'bg-slate-100 text-slate-600';
      case 'cancelled': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-500">Loading your events...</div>
      </div>
    );
  }

  // Show Create Event view
  if (activeView === 'create') {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-6 border-b bg-white flex items-center gap-4">
          <button
            onClick={() => {
              setActiveView('events');
              loadEvents(); // Refresh after creating
            }}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-purple-600 font-bold text-xs uppercase tracking-[0.2em]">Organizer</p>
            <h2 className="text-2xl font-black text-slate-900">Create New Event</h2>
          </div>
        </div>

        {/* Create Event Form */}
        <div className="flex-1 overflow-y-auto">
          <CreateEvent lucid={lucid} walletAddress={userAddress} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white">
      {/* Main Content - Event List */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="p-8 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-purple-600 font-bold text-xs uppercase tracking-[0.2em] mb-1">
                Organizer Dashboard
              </p>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">
                Your Events
              </h2>
            </div>

            <button
              onClick={() => setActiveView('create')}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Event
            </button>
          </div>
        </div>

        {/* Events List */}
        {events.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-16">
            <div className="border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
              <h4 className="text-lg font-bold text-slate-800 mb-2">No events yet</h4>
              <p className="text-slate-400 text-sm mb-6">
                Create your first event to start selling tickets.
              </p>
              <button
                onClick={() => setActiveView('create')}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors"
              >
                Create Your First Event
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {events.map((event) => {
              const stats = getEventStats(event);
              const isSelected = selectedEvent?.id === event.id;

              return (
                <div
                  key={event.id}
                  onClick={() => setSelectedEvent(event)}
                  className={`bg-white border rounded-2xl p-6 cursor-pointer transition-all hover:shadow-lg ${
                    isSelected ? 'ring-2 ring-purple-600 shadow-lg' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Event Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-black text-xl text-slate-900">{event.event_name}</h3>
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold uppercase ${getStatusColor(event.status)}`}>
                          {event.status}
                        </span>
                      </div>
                      <p className="text-slate-500 text-sm">
                        {event.venue_name} &bull; {formatDate(event.event_date)}
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-6">
                      <div className="text-center">
                        <p className="text-2xl font-black text-slate-900">{stats.sold}</p>
                        <p className="text-xs text-slate-400 uppercase tracking-wider">Sold</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-black text-slate-900">{stats.remaining}</p>
                        <p className="text-xs text-slate-400 uppercase tracking-wider">Left</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-black text-emerald-600">₳{formatAda(stats.revenue)}</p>
                        <p className="text-xs text-slate-400 uppercase tracking-wider">Revenue</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sidebar - Event Details */}
      <aside className="w-full lg:w-[400px] bg-slate-50 p-8 flex flex-col shrink-0 border-l border-slate-100">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-6">
          Event Details
        </h3>

        {!selectedEvent ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
            <h4 className="text-lg font-bold text-slate-800 mb-2">Select an event</h4>
            <p className="text-slate-400 text-sm">
              Click an event to view details and manage its status.
            </p>
          </div>
        ) : isEditing && editForm ? (
          /* Edit Mode */
          <div className="flex-1 flex flex-col">
            <div className="bg-white p-6 rounded-2xl shadow-lg mb-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-black text-lg text-slate-900">Edit Event</h4>
                <button
                  onClick={cancelEditing}
                  className="text-slate-400 hover:text-slate-600 text-xl"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">
                    Event Name
                  </label>
                  <input
                    type="text"
                    value={editForm.event_name}
                    onChange={(e) => setEditForm({ ...editForm, event_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">
                    Description
                  </label>
                  <textarea
                    value={editForm.event_description}
                    onChange={(e) => setEditForm({ ...editForm, event_description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">
                    Event Date
                  </label>
                  <input
                    type="date"
                    value={editForm.event_date}
                    onChange={(e) => setEditForm({ ...editForm, event_date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">
                    Venue Name
                  </label>
                  <input
                    type="text"
                    value={editForm.venue_name}
                    onChange={(e) => setEditForm({ ...editForm, venue_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">
                    Location
                  </label>
                  <input
                    type="text"
                    value={editForm.event_location}
                    onChange={(e) => setEditForm({ ...editForm, event_location: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>

            {/* Edit Tiers */}
            <div className="bg-white p-6 rounded-2xl shadow-lg mb-6">
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                Ticket Tiers <span className="text-slate-300">(names only - prices are on-chain)</span>
              </h5>
              <div className="space-y-3">
                {editForm.tiers.map((tier, index) => (
                  <div key={tier.id} className="p-3 bg-slate-50 rounded-xl space-y-2">
                    <input
                      type="text"
                      value={tier.tier_name}
                      onChange={(e) => {
                        const newTiers = [...editForm.tiers];
                        newTiers[index] = { ...tier, tier_name: e.target.value };
                        setEditForm({ ...editForm, tiers: newTiers });
                      }}
                      placeholder="Tier name"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <input
                      type="text"
                      value={tier.tier_description}
                      onChange={(e) => {
                        const newTiers = [...editForm.tiers];
                        newTiers[index] = { ...tier, tier_description: e.target.value };
                        setEditForm({ ...editForm, tiers: newTiers });
                      }}
                      placeholder="Tier description"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Save/Cancel Buttons */}
            <div className="space-y-3 mt-auto">
              <button
                onClick={handleSaveEdit}
                disabled={actionLoading === selectedEvent.id}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-2xl font-bold shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading === selectedEvent.id ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
              <button
                onClick={cancelEditing}
                className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 py-3 rounded-xl font-medium transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* View Mode */
          <div className="flex-1 flex flex-col">
            {/* Event Summary Card */}
            <div className="bg-white p-6 rounded-2xl shadow-lg mb-6">
              <div className="flex items-start justify-between mb-4">
                <h4 className="font-black text-xl text-slate-900 flex-1 pr-4">{selectedEvent.event_name}</h4>
                <span className={`px-2 py-1 rounded-lg text-xs font-bold uppercase shrink-0 ${getStatusColor(selectedEvent.status)}`}>
                  {selectedEvent.status}
                </span>
              </div>

              <div className="space-y-2 text-sm text-slate-500 mb-4">
                <p>{selectedEvent.venue_name}</p>
                <p>{selectedEvent.event_location}</p>
                <p>{formatDate(selectedEvent.event_date)}</p>
              </div>

              {selectedEvent.event_description && (
                <p className="text-sm text-slate-600 border-t border-slate-100 pt-4">
                  {selectedEvent.event_description}
                </p>
              )}

              {/* Edit Button */}
              <button
                onClick={() => startEditing(selectedEvent)}
                className="mt-4 w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Event
              </button>
            </div>

            {/* Ticket Tiers */}
            <div className="bg-white p-6 rounded-2xl shadow-lg mb-6">
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Ticket Tiers</h5>
              <div className="space-y-3">
                {selectedEvent.ticket_tiers.map((tier) => (
                  <div key={tier.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                    <div>
                      <p className="font-bold text-slate-900">{tier.tier_name}</p>
                      <p className="text-xs text-slate-400">
                        {tier.total_supply - tier.remaining_supply} / {tier.total_supply} sold
                      </p>
                    </div>
                    <p className="font-black text-slate-900">₳{formatAda(tier.price_lovelace)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue Summary */}
            {(() => {
              const stats = getEventStats(selectedEvent);
              return (
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 rounded-2xl text-white mb-6">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-200 mb-1">Total Revenue</p>
                  <p className="text-4xl font-black">₳{formatAda(stats.revenue)}</p>
                  <p className="text-sm text-emerald-200 mt-2">
                    {stats.sold} tickets sold of {stats.totalSupply}
                  </p>
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div className="space-y-3 mt-auto">
              {selectedEvent.status === 'draft' && (
                <button
                  onClick={() => handleStatusChange(selectedEvent.id, 'published')}
                  disabled={actionLoading === selectedEvent.id}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-bold shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === selectedEvent.id ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Go Live
                    </>
                  )}
                </button>
              )}

              {selectedEvent.status === 'published' && (
                <button
                  onClick={() => handleStatusChange(selectedEvent.id, 'completed')}
                  disabled={actionLoading === selectedEvent.id}
                  className="w-full bg-slate-600 hover:bg-slate-700 text-white py-4 rounded-2xl font-bold shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === selectedEvent.id ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                      </svg>
                      End Sales
                    </>
                  )}
                </button>
              )}

              {selectedEvent.status === 'completed' && (
                <div className="text-center p-4 bg-slate-100 rounded-2xl">
                  <p className="text-slate-500 text-sm">This event is completed</p>
                </div>
              )}

              {/* Delete Button - always available */}
              <button
                onClick={() => handleDeleteEvent(selectedEvent.id)}
                disabled={actionLoading === selectedEvent.id}
                className="w-full mt-3 bg-red-100 hover:bg-red-200 text-red-600 py-3 rounded-xl font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                {actionLoading === selectedEvent.id ? (
                  'Deleting...'
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Event
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
