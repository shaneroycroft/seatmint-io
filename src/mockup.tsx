import React, { useState, useMemo } from "react";

// --- TYPES & INTERFACES ---
interface Ticket {
  id: string;
  title: string;
  organizer: string;
  priceLovelace: bigint;
  assetName: string;
  type: 'Standard' | 'VIP' | 'Backstage';
  date: string;
  venue: string;
  color: string;
}

// --- SUB-COMPONENTS ---

const TicketMarketplace: React.FC = () => {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);

  // Mock Data using BigInt constructor for compatibility
  const [tickets] = useState<Ticket[]>([
    { 
      id: "T-882", 
      title: "Midnight Jazz Festival", 
      organizer: "JazzCo", 
      priceLovelace: BigInt(45000000), 
      assetName: "JazzTix01", 
      type: 'VIP',
      date: "Oct 24, 2026",
      venue: "Blue Note Hall",
      color: "bg-purple-600"
    },
    { 
      id: "T-102", 
      title: "Blockchain Summit 2026", 
      organizer: "Cardano Foundation", 
      priceLovelace: BigInt(120000000), 
      assetName: "SummitTix", 
      type: 'Standard',
      date: "Nov 12, 2026",
      venue: "Dubai World Trade Centre",
      color: "bg-blue-600"
    },
    { 
      id: "T-449", 
      title: "The Weeknd - After Hours", 
      organizer: "LiveNation", 
      priceLovelace: BigInt(85000000), 
      assetName: "WeekndTix", 
      type: 'Backstage',
      date: "Dec 05, 2026",
      venue: "Rogers Centre",
      color: "bg-red-600"
    },
  ]);

  const platformFeePercent = 2;
  
  const purchaseBreakdown = useMemo(() => {
    if (!selectedTicket) return null;
    const price = Number(selectedTicket.priceLovelace) / 1_000_000;
    const fee = (price * platformFeePercent) / 100;
    return {
      subtotal: price,
      fee: fee,
      total: price + fee
    };
  }, [selectedTicket]);

  const handleBuy = () => {
    if (!selectedTicket) return;
    setIsPurchasing(true);
    setTimeout(() => {
      setIsPurchasing(false);
      setSelectedTicket(null);
      // No alert() as per instructions, using console log for mock
      console.log("Mock Purchase Complete");
    }, 1500);
  };

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white">
      <div className="flex-1 overflow-y-auto border-r border-slate-100">
        <div className="p-8 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10 flex justify-between items-end">
          <div>
            <p className="text-blue-600 font-bold text-xs uppercase tracking-[0.2em] mb-1">Live Marketplace</p>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Available Tickets</h2>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-100">
          {tickets.map((ticket) => (
            <div 
              key={ticket.id}
              onClick={() => setSelectedTicket(ticket)}
              className={`bg-white p-6 flex flex-col cursor-pointer transition-all duration-300 hover:z-20 hover:shadow-2xl ${selectedTicket?.id === ticket.id ? 'ring-2 ring-blue-600 z-10' : ''}`}
            >
              <div className={`w-full aspect-[16/9] ${ticket.color} rounded-2xl mb-5 p-4 flex flex-col justify-between text-white relative overflow-hidden shadow-lg`}>
                <div className="absolute top-0 right-0 p-8 opacity-10 scale-150 rotate-12 text-9xl font-black select-none">TICKET</div>
                <div className="flex justify-between items-start relative z-10">
                  <div className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest italic">
                    {ticket.type}
                  </div>
                </div>
                <div className="relative z-10">
                  <h4 className="text-xl font-black leading-tight mb-1 truncate">{ticket.title}</h4>
                  <p className="text-xs font-medium opacity-80 uppercase tracking-wider">{ticket.venue}</p>
                </div>
              </div>

              <div className="flex justify-between items-end">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{ticket.date}</p>
                  <p className="text-sm font-bold text-slate-700">{ticket.organizer}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-slate-900 tracking-tighter">₳{Number(ticket.priceLovelace) / 1_000_000}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside className="w-full lg:w-[400px] bg-slate-50 p-8 flex flex-col shrink-0">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-8">Order Summary</h3>

        {!selectedTicket ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
            <h4 className="text-lg font-bold text-slate-800 mb-2">Select a ticket</h4>
            <p className="text-slate-400 text-sm">Review contract details and finalize purchase.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="bg-white p-8 rounded-[32px] shadow-xl border border-white mb-6 relative overflow-hidden">
               <div className={`absolute top-0 left-0 w-2 h-full ${selectedTicket.color}`}></div>
               <div className="flex justify-between items-start mb-6">
                <h4 className="font-black text-2xl text-slate-900 leading-tight">{selectedTicket.title}</h4>
                <button onClick={() => setSelectedTicket(null)} className="text-slate-400 hover:text-slate-900">✕</button>
              </div>
              
              <div className="space-y-4 py-6 border-t border-slate-50">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Price</span>
                  <span className="font-mono font-bold text-slate-900">₳{purchaseBreakdown?.subtotal}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Fee ({platformFeePercent}%)</span>
                  <span className="font-mono font-bold text-slate-900">₳{purchaseBreakdown?.fee.toFixed(2)}</span>
                </div>
              </div>

              <div className="pt-6 border-t-2 border-dashed border-slate-100 flex justify-between items-end">
                <span className="text-xs font-black uppercase text-slate-400 tracking-widest">Total</span>
                <span className="text-4xl font-black text-slate-900 tracking-tighter">₳{purchaseBreakdown?.total.toFixed(2)}</span>
              </div>
            </div>

            <button 
              onClick={handleBuy}
              disabled={isPurchasing}
              className="w-full bg-slate-900 text-white py-6 rounded-2xl font-black text-lg shadow-xl hover:bg-black transition-all disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isPurchasing ? "Signing..." : "Confirm & Buy Ticket"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
};

// --- MAIN APP ---

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">S</div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Seatmint</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Mockup Environment</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <TicketMarketplace />
      </main>
    </div>
  );
}