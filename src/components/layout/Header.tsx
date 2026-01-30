import React, { useState } from 'react';
import { BRAND } from '../../constants';

interface HeaderProps {
  isConnected: boolean;
  address?: string;
  onDisconnect: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isPlatformReady: boolean;
  isOrganizer?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  isConnected,
  address,
  onDisconnect,
  activeTab,
  onTabChange,
  isPlatformReady,
  isOrganizer = false,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Simplified navigation - organizer features consolidated into one area
  const tabs = [
    { id: 'setup', label: 'Setup', alwaysEnabled: true },
    { id: 'events', label: 'Events', requiresReady: true },
    { id: 'my-tickets', label: 'My Tickets', requiresReady: true },
    ...(isOrganizer ? [
      { id: 'organizer', label: 'Organizer', requiresReady: true, isOrganizer: true },
    ] : []),
  ];

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 shadow-sm">
      {/* Logo & Brand */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
          {BRAND.name.charAt(0)}
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight text-slate-900">{BRAND.name}</h1>
          <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
            Preview Testnet
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="flex items-center gap-1">
        {tabs.map((tab) => {
          const isDisabled = tab.requiresReady && !isPlatformReady;
          const isActive = activeTab === tab.id ||
            (tab.id === 'organizer' && ['organizer', 'venue-designer', 'settings'].includes(activeTab));

          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && onTabChange(tab.id)}
              disabled={isDisabled}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${tab.isOrganizer
                  ? isActive
                    ? 'bg-purple-600 text-white'
                    : 'text-purple-600 hover:bg-purple-50'
                  : isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }
                ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Profile / Wallet Status */}
      <div className="flex items-center gap-3 relative">
        {isConnected ? (
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                {address?.slice(0, 2)}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-medium text-slate-900">My Wallet</p>
                <p className="text-[10px] font-mono text-slate-500">
                  {address?.slice(0, 8)}...{address?.slice(-4)}
                </p>
              </div>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${showProfileMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Profile Dropdown */}
            {showProfileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Wallet Address</p>
                    <p className="text-xs font-mono text-slate-600 break-all">{address}</p>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(address || '');
                        setShowProfileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy Address
                    </button>

                    {isOrganizer && (
                      <div className="px-4 py-2 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold uppercase rounded">
                          Organizer
                        </span>
                        <span className="text-xs text-slate-500">Event creation enabled</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 pt-1">
                    <button
                      onClick={() => {
                        onDisconnect();
                        setShowProfileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Disconnect Wallet
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-2 h-2 bg-amber-500 rounded-full" />
            <span className="text-sm text-slate-500">Not connected</span>
          </div>
        )}
      </div>
    </header>
  );
};
