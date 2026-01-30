import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CreateEvent } from './CreateEvent';
import { PlatformSettings } from './PlatformSettings';
import { SeatVisualizer } from './SeatVisualizer';
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

type OrganizerSection = 'events' | 'venue' | 'settings';
type DashboardView = 'events' | 'create';

// Reusable section nav component to avoid duplication
interface OrganizerNavProps {
  activeSection: OrganizerSection;
  setActiveSection: (section: OrganizerSection) => void;
  rightContent?: React.ReactNode;
  sticky?: boolean;
}

const OrganizerNav: React.FC<OrganizerNavProps> = ({ activeSection, setActiveSection, rightContent, sticky = false }) => (
  <div className={`px-6 pt-4 pb-0 border-b shrink-0 ${sticky ? 'sticky top-0 bg-white/95 backdrop-blur-sm z-10' : 'bg-white'}`}>
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-6">
        <h2 className="text-lg font-semibold text-warm-900">Organizer</h2>
        <nav className="flex gap-1">
          {(['events', 'venue', 'settings'] as OrganizerSection[]).map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeSection === section
                  ? 'bg-terracotta-100 text-terracotta-700'
                  : 'text-warm-500 hover:bg-warm-100'
              }`}
            >
              {section.charAt(0).toUpperCase() + section.slice(1)}
            </button>
          ))}
        </nav>
      </div>
      {rightContent}
    </div>
  </div>
);

export const OrganizerDashboard: React.FC<OrganizerDashboardProps> = ({ lucid, userAddress }) => {
  const [activeSection, setActiveSection] = useState<OrganizerSection>('events');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>('events');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditFormData | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    action: 'publish' | 'complete' | 'delete' | null;
    eventId: string | null;
    eventName: string | null;
  }>({ isOpen: false, action: null, eventId: null, eventName: null });
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
      case 'draft': return 'bg-sand-100 text-sand-700';
      case 'published': return 'bg-forest-100 text-forest-700';
      case 'completed': return 'bg-warm-100 text-warm-600';
      case 'cancelled': return 'bg-terracotta-100 text-terracotta-700';
      default: return 'bg-warm-100 text-warm-600';
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-warm-500">Loading your events...</div>
      </div>
    );
  }

  // Handle event created - navigate to it
  const handleEventCreated = async (eventId: string) => {
    // Refresh the events list
    await loadEvents();
    // Switch back to events view
    setActiveView('events');
    // Find and select the new event
    const { data: newEvent } = await supabase
      .from('events')
      .select(`*, ticket_tiers (*)`)
      .eq('id', eventId)
      .single();
    if (newEvent) {
      setSelectedEvent(newEvent);
    }
  };

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
            className="p-2 hover:bg-warm-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-warm-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <p className="text-terracotta-600 font-semibold text-xs uppercase tracking-[0.2em]">Organizer</p>
            <h2 className="text-2xl font-black text-warm-900">Create New Event</h2>
          </div>
        </div>

        {/* Create Event Form */}
        <div className="flex-1 overflow-y-auto">
          <CreateEvent
            lucid={lucid}
            walletAddress={userAddress}
            onEventCreated={handleEventCreated}
          />
        </div>
      </div>
    );
  }

  // Render Venue Designer section
  if (activeSection === 'venue') {
    return (
      <div className="h-full flex flex-col bg-white overflow-hidden">
        <OrganizerNav activeSection={activeSection} setActiveSection={setActiveSection} />
        <div className="flex-1 min-h-0">
          <SeatVisualizer onSeatSelect={(seat) => console.log('Seat selected:', seat)} />
        </div>
      </div>
    );
  }

  // Render Settings section
  if (activeSection === 'settings') {
    return (
      <div className="h-full flex flex-col bg-white">
        <OrganizerNav activeSection={activeSection} setActiveSection={setActiveSection} />
        <div className="flex-1 overflow-y-auto">
          <PlatformSettings lucid={lucid} adminAddress={userAddress} />
        </div>
      </div>
    );
  }

  const newEventButton = (
    <button
      onClick={() => setActiveView('create')}
      className="px-4 py-2 bg-terracotta-600 hover:bg-terracotta-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      New Event
    </button>
  );

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white">
      {/* Main Content - Event List */}
      <div className="flex-1 overflow-y-auto">
        <OrganizerNav
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          rightContent={newEventButton}
          sticky
        />

        {/* Events List */}
        {events.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
            <div className="border-2 border-dashed border-warm-200 rounded-xl p-8 bg-white/50">
              <h4 className="text-sm font-semibold text-warm-700 mb-1">No events yet</h4>
              <p className="text-warm-400 text-xs mb-4">
                Create your first event to start selling tickets.
              </p>
              <button
                onClick={() => setActiveView('create')}
                className="px-4 py-2 bg-terracotta-600 hover:bg-terracotta-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Create Your First Event
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            {events.map((event) => {
              const stats = getEventStats(event);
              const isSelected = selectedEvent?.id === event.id;

              return (
                <div
                  key={event.id}
                  onClick={() => setSelectedEvent(event)}
                  className={`bg-white border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md ${
                    isSelected ? 'ring-2 ring-terracotta-600 shadow-md' : 'border-warm-200'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    {/* Event Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-base text-warm-900">{event.event_name}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${getStatusColor(event.status)}`}>
                          {event.status}
                        </span>
                      </div>
                      <p className="text-warm-500 text-xs">
                        {event.venue_name} &bull; {formatDate(event.event_date)}
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-5">
                      <div className="text-center">
                        <p className="text-lg font-semibold text-warm-900">{stats.sold}</p>
                        <p className="text-[10px] text-warm-400 uppercase tracking-wider">Sold</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-semibold text-warm-900">{stats.remaining}</p>
                        <p className="text-[10px] text-warm-400 uppercase tracking-wider">Left</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-semibold text-forest-600">₳{formatAda(stats.revenue)}</p>
                        <p className="text-[10px] text-warm-400 uppercase tracking-wider">Revenue</p>
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
      <aside className="w-full lg:w-[340px] bg-warm-50 p-5 flex flex-col shrink-0 border-l border-warm-200">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-4">
          Event Details
        </h3>

        {!selectedEvent ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-warm-200 rounded-xl p-6 bg-white/50">
            <p className="text-sm font-medium text-warm-600 mb-1">Select an event</p>
            <p className="text-warm-400 text-xs">
              Click an event to view details and manage its status.
            </p>
          </div>
        ) : isEditing && editForm ? (
          /* Edit Mode */
          <div className="flex-1 flex flex-col">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-warm-200 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-base text-warm-900">Edit Event</h4>
                <button
                  onClick={cancelEditing}
                  className="text-warm-400 hover:text-warm-600 text-lg leading-none"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-warm-500 mb-1 block">
                    Event Name
                  </label>
                  <input
                    type="text"
                    value={editForm.event_name}
                    onChange={(e) => setEditForm({ ...editForm, event_name: e.target.value })}
                    className="w-full px-3 py-2 bg-warm-50 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-warm-500 mb-1 block">
                    Description
                  </label>
                  <textarea
                    value={editForm.event_description}
                    onChange={(e) => setEditForm({ ...editForm, event_description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 bg-warm-50 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-warm-500 mb-1 block">
                    Event Date
                  </label>
                  <input
                    type="date"
                    value={editForm.event_date}
                    onChange={(e) => setEditForm({ ...editForm, event_date: e.target.value })}
                    className="w-full px-3 py-2 bg-warm-50 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-warm-500 mb-1 block">
                    Venue Name
                  </label>
                  <input
                    type="text"
                    value={editForm.venue_name}
                    onChange={(e) => setEditForm({ ...editForm, venue_name: e.target.value })}
                    className="w-full px-3 py-2 bg-warm-50 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-warm-500 mb-1 block">
                    Location
                  </label>
                  <input
                    type="text"
                    value={editForm.event_location}
                    onChange={(e) => setEditForm({ ...editForm, event_location: e.target.value })}
                    className="w-full px-3 py-2 bg-warm-50 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
                  />
                </div>
              </div>
            </div>

            {/* Edit Tiers */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-warm-200 mb-4">
              <h5 className="text-[11px] font-medium uppercase tracking-wider text-warm-400 mb-3">
                Ticket Tiers <span className="text-warm-300">(names only)</span>
              </h5>
              <div className="space-y-2">
                {editForm.tiers.map((tier, index) => (
                  <div key={tier.id} className="p-2.5 bg-warm-50 rounded-lg space-y-2">
                    <input
                      type="text"
                      value={tier.tier_name}
                      onChange={(e) => {
                        const newTiers = [...editForm.tiers];
                        newTiers[index] = { ...tier, tier_name: e.target.value };
                        setEditForm({ ...editForm, tiers: newTiers });
                      }}
                      placeholder="Tier name"
                      className="w-full px-2.5 py-1.5 bg-white border border-warm-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
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
                      className="w-full px-2.5 py-1.5 bg-white border border-warm-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Save/Cancel Buttons */}
            <div className="space-y-2 mt-auto">
              <button
                onClick={handleSaveEdit}
                disabled={actionLoading === selectedEvent.id}
                className="w-full bg-terracotta-600 hover:bg-terracotta-700 text-white py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading === selectedEvent.id ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
              <button
                onClick={cancelEditing}
                className="w-full bg-warm-200 hover:bg-warm-300 text-warm-700 py-2 rounded-lg text-sm font-medium transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* View Mode */
          <div className="flex-1 flex flex-col">
            {/* Event Summary Card */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-warm-200 mb-4">
              <div className="flex items-start justify-between mb-3">
                <h4 className="font-semibold text-base text-warm-900 flex-1 pr-3">{selectedEvent.event_name}</h4>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${getStatusColor(selectedEvent.status)}`}>
                  {selectedEvent.status}
                </span>
              </div>

              <div className="space-y-1 text-xs text-warm-500 mb-3">
                <p>{selectedEvent.venue_name}</p>
                <p>{selectedEvent.event_location}</p>
                <p>{formatDate(selectedEvent.event_date)}</p>
              </div>

              {selectedEvent.event_description && (
                <p className="text-xs text-warm-600 border-t border-warm-100 pt-3">
                  {selectedEvent.event_description}
                </p>
              )}

              {/* Edit Button */}
              <button
                onClick={() => startEditing(selectedEvent)}
                className="mt-3 w-full bg-warm-100 hover:bg-warm-200 text-warm-700 py-2 rounded-lg font-medium text-xs transition-all flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Event
              </button>
            </div>

            {/* Ticket Tiers */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-warm-200 mb-4">
              <h5 className="text-[11px] font-medium uppercase tracking-wider text-warm-400 mb-3">Ticket Tiers</h5>
              <div className="space-y-2">
                {selectedEvent.ticket_tiers.map((tier) => (
                  <div key={tier.id} className="flex justify-between items-center p-2.5 bg-warm-50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm text-warm-900">{tier.tier_name}</p>
                      <p className="text-[10px] text-warm-400">
                        {tier.total_supply - tier.remaining_supply} / {tier.total_supply} sold
                      </p>
                    </div>
                    <p className="font-semibold text-sm text-warm-900">₳{formatAda(tier.price_lovelace)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue Summary */}
            {(() => {
              const stats = getEventStats(selectedEvent);
              return (
                <div className="bg-gradient-to-br from-forest-500 to-forest-600 p-4 rounded-xl text-white mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-forest-200 mb-0.5">Total Revenue</p>
                  <p className="text-2xl font-semibold">₳{formatAda(stats.revenue)}</p>
                  <p className="text-xs text-forest-200 mt-1">
                    {stats.sold} tickets sold of {stats.totalSupply}
                  </p>
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div className="space-y-2 mt-auto">
              {selectedEvent.status === 'draft' && (
                <button
                  onClick={() => setConfirmModal({
                    isOpen: true,
                    action: 'publish',
                    eventId: selectedEvent.id,
                    eventName: selectedEvent.event_name
                  })}
                  disabled={actionLoading === selectedEvent.id}
                  className="w-full bg-forest-600 hover:bg-forest-700 text-white py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {actionLoading === selectedEvent.id ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Go Live
                    </>
                  )}
                </button>
              )}

              {selectedEvent.status === 'published' && (
                <button
                  onClick={() => setConfirmModal({
                    isOpen: true,
                    action: 'complete',
                    eventId: selectedEvent.id,
                    eventName: selectedEvent.event_name
                  })}
                  disabled={actionLoading === selectedEvent.id}
                  className="w-full bg-warm-600 hover:bg-warm-700 text-white py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {actionLoading === selectedEvent.id ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                      </svg>
                      End Sales
                    </>
                  )}
                </button>
              )}

              {selectedEvent.status === 'completed' && (
                <div className="text-center p-4 bg-warm-100 rounded-2xl">
                  <p className="text-warm-500 text-sm">This event is completed</p>
                </div>
              )}

              {/* Delete Button - always available */}
              <button
                onClick={() => setConfirmModal({
                  isOpen: true,
                  action: 'delete',
                  eventId: selectedEvent.id,
                  eventName: selectedEvent.event_name
                })}
                disabled={actionLoading === selectedEvent.id}
                className="w-full mt-3 bg-terracotta-100 hover:bg-terracotta-200 text-terracotta-600 py-3 rounded-xl font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
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

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-warm-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
              confirmModal.action === 'publish' ? 'bg-forest-100' :
              confirmModal.action === 'delete' ? 'bg-terracotta-100' : 'bg-sand-100'
            }`}>
              {confirmModal.action === 'publish' ? (
                <svg className="w-7 h-7 text-forest-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : confirmModal.action === 'delete' ? (
                <svg className="w-7 h-7 text-terracotta-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              ) : (
                <svg className="w-7 h-7 text-sand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
            </div>

            <h3 className="text-xl font-semibold text-warm-900 text-center mb-2">
              {confirmModal.action === 'publish' ? 'Go Live with Event?' :
               confirmModal.action === 'delete' ? 'Delete Event?' : 'End Ticket Sales?'}
            </h3>

            <p className="text-warm-500 text-sm text-center mb-2">
              <span className="font-semibold text-warm-700">{confirmModal.eventName}</span>
            </p>

            <p className="text-warm-500 text-sm text-center mb-6">
              {confirmModal.action === 'publish'
                ? 'This will make your event visible to buyers and enable ticket purchases. Make sure all details are correct.'
                : confirmModal.action === 'delete'
                ? 'This will permanently delete this event and all its ticket tiers. This action cannot be undone.'
                : 'This will stop all ticket sales for this event. Existing tickets will remain valid but no new purchases can be made.'}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal({ isOpen: false, action: null, eventId: null, eventName: null })}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-warm-600 bg-warm-100 hover:bg-warm-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (confirmModal.eventId && confirmModal.action) {
                    setConfirmModal({ isOpen: false, action: null, eventId: null, eventName: null });
                    if (confirmModal.action === 'delete') {
                      await handleDeleteEvent(confirmModal.eventId);
                    } else {
                      const status = confirmModal.action === 'publish' ? 'published' : 'completed';
                      await handleStatusChange(confirmModal.eventId, status);
                    }
                  }
                }}
                className={`flex-1 px-4 py-3 rounded-xl font-semibold text-white transition ${
                  confirmModal.action === 'publish' ? 'bg-forest-600 hover:bg-forest-700' :
                  confirmModal.action === 'delete' ? 'bg-terracotta-600 hover:bg-terracotta-700' :
                  'bg-sand-600 hover:bg-sand-700'
                }`}
              >
                {confirmModal.action === 'publish' ? 'Yes, Go Live' :
                 confirmModal.action === 'delete' ? 'Yes, Delete' : 'Yes, End Sales'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
