import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { ToastContainer, ToastData, ToastType } from '../components/ui/Toast';

interface ToastContextValue {
  // Show a toast notification
  showToast: (toast: Omit<ToastData, 'id'>) => string;

  // Convenience methods with user-friendly defaults
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;

  // For transaction flows - returns ID to update later
  pending: (title: string, message?: string) => string;

  // Update an existing toast (useful for pending -> success/error)
  updateToast: (id: string, updates: Partial<Omit<ToastData, 'id'>>) => void;

  // Dismiss a toast
  dismissToast: (id: string) => void;

  // Dismiss all toasts
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Default durations (in ms)
const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  error: 8000,
  info: 5000,
  pending: 0, // Persistent until manually dismissed
};

interface ToastProviderProps {
  children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const generateId = () => `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const showToast = useCallback((toast: Omit<ToastData, 'id'>): string => {
    const id = generateId();
    const duration = toast.duration ?? DEFAULT_DURATIONS[toast.type];

    setToasts((prev) => [...prev, { ...toast, id, duration }]);
    return id;
  }, []);

  const success = useCallback((title: string, message?: string): string => {
    return showToast({ type: 'success', title, message });
  }, [showToast]);

  const error = useCallback((title: string, message?: string): string => {
    return showToast({ type: 'error', title, message });
  }, [showToast]);

  const info = useCallback((title: string, message?: string): string => {
    return showToast({ type: 'info', title, message });
  }, [showToast]);

  const pending = useCallback((title: string, message?: string): string => {
    return showToast({ type: 'pending', title, message, duration: 0 });
  }, [showToast]);

  const updateToast = useCallback((id: string, updates: Partial<Omit<ToastData, 'id'>>) => {
    setToasts((prev) =>
      prev.map((toast) => {
        if (toast.id !== id) return toast;

        const updated = { ...toast, ...updates };

        // If changing from pending to another type, set a duration
        if (toast.type === 'pending' && updates.type && updates.type !== 'pending') {
          updated.duration = updates.duration ?? DEFAULT_DURATIONS[updates.type];
        }

        return updated;
      })
    );
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const value: ToastContextValue = {
    showToast,
    success,
    error,
    info,
    pending,
    updateToast,
    dismissToast,
    dismissAll,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

// Hook for using toast in components
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Predefined user-friendly messages (no crypto jargon)
export const TOAST_MESSAGES = {
  // Wallet
  walletConnected: {
    title: 'Wallet Connected',
    message: 'You can now browse and purchase tickets.',
  },
  walletDisconnected: {
    title: 'Wallet Disconnected',
    message: 'Connect your wallet to continue.',
  },

  // Purchase flow
  purchaseStarted: {
    title: 'Processing Your Order',
    message: 'Please confirm in your wallet. This may take a moment.',
  },
  purchaseSuccess: {
    title: 'Ticket Secured!',
    message: 'Your ticket will appear in My Tickets shortly.',
  },
  purchaseFailed: {
    title: 'Purchase Failed',
    message: 'Something went wrong. Please try again.',
  },

  // Listing flow
  listingStarted: {
    title: 'Creating Your Listing',
    message: 'Please confirm in your wallet.',
  },
  listingSuccess: {
    title: 'Ticket Listed!',
    message: 'Your ticket is now available on the marketplace.',
  },
  listingFailed: {
    title: 'Listing Failed',
    message: 'We couldn\'t list your ticket. Please try again.',
  },
  listingCanceled: {
    title: 'Listing Removed',
    message: 'Your ticket has been removed from the marketplace.',
  },

  // Transfer flow
  transferStarted: {
    title: 'Transferring Ticket',
    message: 'Please confirm in your wallet.',
  },
  transferSuccess: {
    title: 'Ticket Sent!',
    message: 'The recipient will see it in their wallet shortly.',
  },
  transferFailed: {
    title: 'Transfer Failed',
    message: 'We couldn\'t send your ticket. Please try again.',
  },

  // Event creation
  eventCreating: {
    title: 'Creating Your Event',
    message: 'Setting up your event on the blockchain...',
  },
  eventCreated: {
    title: 'Event Created!',
    message: 'Your event is ready. You can now publish it.',
  },

  // Generic
  networkSlow: {
    title: 'Network is Busy',
    message: 'This is taking longer than usual. Please wait.',
  },
  copySuccess: {
    title: 'Copied!',
    message: 'Address copied to clipboard.',
  },
} as const;

export default ToastContext;
