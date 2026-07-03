"use client";

import React, { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';

/* ------------------------------------------------------------------
   Toast notification system — lightweight, no external deps.
   Usage:
     const { toast } = useToast();
     toast('✅ Summary copied to clipboard');
     toast('❌ Copy failed', { type: 'error' });
------------------------------------------------------------------ */

type ToastType = 'success' | 'error' | 'info';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextValue {
    toast: (message: string, opts?: { type?: ToastType }) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
    return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((message: string, opts?: { type?: ToastType }) => {
        const id = nextId++;
        const type: ToastType = opts?.type ?? 'success';
        setToasts(prev => [...prev, { id, message, type }]);
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    }, []);

    return (
        <ToastContext.Provider value={{ toast: addToast }}>
            {children}
            <div className="toast-container">
                {toasts.map(t => (
                    <div key={t.id} className={`toast toast-${t.type}`} role="status" aria-live="polite">
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}
