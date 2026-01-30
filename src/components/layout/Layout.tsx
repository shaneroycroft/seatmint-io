import React from 'react';
import { Header } from './Header';

interface LayoutProps {
  children: React.ReactNode;
  isConnected: boolean;
  address?: string;
  onDisconnect: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isPlatformReady: boolean;
  isOrganizer?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  isConnected,
  address,
  onDisconnect,
  activeTab,
  onTabChange,
  isPlatformReady,
  isOrganizer = false,
}) => {
  return (
    <div className="h-screen bg-warm-50 flex flex-col font-sans text-warm-900 overflow-hidden">
      <Header
        isConnected={isConnected}
        address={address}
        onDisconnect={onDisconnect}
        activeTab={activeTab}
        onTabChange={onTabChange}
        isPlatformReady={isPlatformReady}
        isOrganizer={isOrganizer}
      />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
};
